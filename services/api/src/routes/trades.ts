import { createHash } from "node:crypto";
import { Router } from "express";
import { keccak256, toUtf8Bytes } from "ethers";
import { z } from "zod";
import type { Prisma, Trade as PrismaTrade, User } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { requireAuth, requireRole } from "../auth";
import {
  asyncHandler,
  badRequest,
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
} from "../errors";
import * as chain from "../services/chain";
import * as escrow from "../services/escrow";

export const tradesRouter = Router();

type TradeContext = PrismaTrade & {
  offer: { id: string; facilityId: string; facility: { ownerId: string; owner: User } };
  request: { id: string; buyerId: string; buyer: User };
  evidenceBundles: Array<{
    id: string;
    evidenceHash: string;
    recordReferences: string;
    attestationStatus: string;
    attestedBy: string | null;
    attestedAt: Date | null;
    createdAt: Date;
  }>;
  rewardEvents: Array<{
    id: string;
    recipient: string;
    amount: string;
    reason: string;
    chainTxHash: string | null;
    createdAt: Date;
  }>;
};

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function tradeJson(trade: PrismaTrade): Record<string, unknown> {
  return {
    id: trade.id,
    offerId: trade.offerId,
    requestId: trade.requestId,
    agreedKwh: trade.agreedKwh,
    pricePerKwh: trade.pricePerKwh,
    state: trade.state,
    evidenceHash: trade.evidenceHash,
    discrepancyPct: trade.discrepancyPct,
    chainTradeId: trade.chainTradeId,
    chainTxHash: trade.chainTxHash,
    settlementTxHash: trade.settlementTxHash,
    escrowEnabled: trade.escrowEnabled,
    escrowRequired: trade.escrowRequired,
    escrowState: trade.escrowState,
    settlementToken: trade.settlementToken,
    settlementTokenSymbol: trade.settlementTokenSymbol,
    settlementTokenDecimals: trade.settlementTokenDecimals,
    tradeValueUnits: trade.tradeValueUnits,
    consumerPaymentUnits: trade.consumerPaymentUnits,
    consumerCollateralUnits: trade.consumerCollateralUnits,
    producerCollateralUnits: trade.producerCollateralUnits,
    consumerPaymentFundedUnits: trade.consumerPaymentFundedUnits,
    consumerCollateralFundedUnits: trade.consumerCollateralFundedUnits,
    producerCollateralFundedUnits: trade.producerCollateralFundedUnits,
    fundingDeadline: trade.fundingDeadline?.toISOString() ?? null,
    deliveryDeadline: trade.deliveryDeadline?.toISOString() ?? null,
    settlementOutcome: trade.settlementOutcome,
    verifiedDeliveredKwh: trade.verifiedDeliveredKwh,
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
  };
}

async function loadTradeContext(id: string): Promise<TradeContext | null> {
  return prisma.trade.findUnique({
    where: { id },
    include: {
      offer: { include: { facility: { include: { owner: true } } } },
      request: { include: { buyer: true } },
      evidenceBundles: true,
      rewardEvents: true,
    },
  }) as Promise<TradeContext | null>;
}

function partyForTrade(trade: TradeContext, user: User): "producer" | "consumer" | null {
  if (trade.offer.facility.ownerId === user.id) return "producer";
  if (trade.request.buyerId === user.id) return "consumer";
  return null;
}

function requireParty(trade: TradeContext, user: User, expected?: "producer" | "consumer"): string {
  const party = partyForTrade(trade, user);
  if (!party) throw forbidden("only an assigned trade participant may perform this action");
  if (expected && party !== expected) throw forbidden(`only the trade ${expected} may perform this action`);
  const wallet = party === "producer" ? trade.offer.facility.owner.walletAddress : trade.request.buyer.walletAddress;
  if (!wallet) throw forbidden(`the trade ${party} must sign in with a wallet before escrow actions`);
  return wallet;
}

function escrowUnavailableMessage(): string {
  return (
    "This trade requires mutual escrow, but the settlement chain is unavailable. " +
    "No on-chain transfer was attempted and the trade was not marked as settled."
  );
}

function requireEscrowReady(trade: PrismaTrade): void {
  if (trade.escrowRequired && !trade.escrowEnabled) {
    throw serviceUnavailable(
      "Escrow registration is incomplete for this trade. Re-run matching after the settlement chain is available; " +
        "the trade cannot be settled off-chain.",
    );
  }
}

function requireEscrow(trade: PrismaTrade): void {
  if (!trade.escrowEnabled || trade.chainTradeId === null) {
    throw badRequest("this trade is not an escrow-backed trade");
  }
}

function toBytes32(value: string | undefined, fallback: string): string {
  if (!value) return keccak256(toUtf8Bytes(fallback));
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  return keccak256(toUtf8Bytes(value));
}

function rewardAmount(trade: PrismaTrade, deliveredKwhMilli?: string): string {
  if (deliveredKwhMilli !== undefined) {
    return ((BigInt(deliveredKwhMilli) * 10n ** 18n) / 1000n).toString();
  }
  return (BigInt(Math.floor(trade.agreedKwh * 1e6)) * 10n ** 12n).toString();
}

async function ensureRewardEvent(
  trade: TradeContext,
  reason: string,
  amount: string,
  txHash: string | null,
): Promise<void> {
  const existing = await prisma.rewardEvent.findFirst({ where: { tradeId: trade.id, reason } });
  if (existing) return;
  const recipient =
    trade.offer.facility.owner.walletAddress ?? chain.userAddressFromId(trade.offer.facility.ownerId);
  await prisma.rewardEvent.create({
    data: { tradeId: trade.id, recipient, amount, reason, chainTxHash: txHash },
  });
}

async function syncIfEscrow(trade: PrismaTrade): Promise<PrismaTrade> {
  if (!trade.escrowEnabled || trade.chainTradeId === null) return trade;
  if (!(await chain.isReadable())) return trade;
  try {
    return (await escrow.syncEscrowTrade(trade.id)) ?? trade;
  } catch (err) {
    console.warn(`[escrow] sync failed for trade ${trade.id}:`, err);
    return trade;
  }
}

tradesRouter.get(
  "/trades",
  asyncHandler(async (_req, res) => {
    const trades = await prisma.trade.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ trades: trades.map(tradeJson) });
  }),
);

tradesRouter.get(
  "/trades/:id",
  asyncHandler(async (req, res) => {
    let trade = await loadTradeContext(req.params.id);
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    if (trade.escrowEnabled) {
      await syncIfEscrow(trade);
      trade = await loadTradeContext(req.params.id);
      if (!trade) throw notFound(`trade ${req.params.id} not found`);
    }
    res.json({
      ...tradeJson(trade),
      escrow: escrow.escrowJson(trade),
      evidenceBundles: trade.evidenceBundles.map((b) => ({
        id: b.id,
        evidenceHash: b.evidenceHash,
        recordReferences: JSON.parse(b.recordReferences) as string[],
        attestationStatus: b.attestationStatus,
        attestedBy: b.attestedBy,
        attestedAt: b.attestedAt?.toISOString() ?? null,
        createdAt: b.createdAt.toISOString(),
      })),
      rewardEvents: trade.rewardEvents.map((r) => ({
        id: r.id,
        recipient: r.recipient,
        amount: r.amount,
        reason: r.reason,
        chainTxHash: r.chainTxHash,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  }),
);

const evidenceSchema = z.object({
  producerExportKwh: z.number().nonnegative().optional(),
  consumerImportKwh: z.number().nonnegative().optional(),
  notes: z.string().optional(),
  recordReferences: z.array(z.string()).optional(),
});

tradesRouter.post(
  "/trades/:id/evidence",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = evidenceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const body = parsed.data;
    if (body.producerExportKwh === undefined && body.consumerImportKwh === undefined) {
      throw badRequest("producerExportKwh or consumerImportKwh required");
    }

    let trade = await loadTradeContext(req.params.id);
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    requireEscrowReady(trade);

    const party = partyForTrade(trade, req.user!);
    const maySubmit =
      party === "producer" || req.user!.role === "verifier" || req.user!.role === "admin";
    if (!maySubmit) throw forbidden("only the producer or an authorized verifier may submit delivery evidence");

    if (trade.escrowEnabled) {
      await syncIfEscrow(trade);
      trade = await loadTradeContext(req.params.id);
      if (!trade) throw notFound(`trade ${req.params.id} not found`);
    }

    const expectedState = trade.escrowEnabled ? "DELIVERY_ACTIVE" : "MATCHED";
    if (trade.state !== expectedState) {
      throw conflict(
        trade.escrowEnabled
          ? `evidence requires a fully funded escrow in DELIVERY_ACTIVE state (current: ${trade.state}, escrow: ${trade.escrowState})`
          : `evidence can only be attached to MATCHED trades (current: ${trade.state})`,
      );
    }

    const measured = body.producerExportKwh ?? body.consumerImportKwh ?? 0;
    const discrepancyPct = round4((Math.abs(measured - trade.agreedKwh) / trade.agreedKwh) * 100);
    const withinTolerance = discrepancyPct <= config.DELIVERY_TOLERANCE_PCT;

    const recordReferences = body.recordReferences ?? [];
    const canonical = stableStringify({
      tradeId: trade.id,
      producerExportKwh: body.producerExportKwh ?? null,
      consumerImportKwh: body.consumerImportKwh ?? null,
      notes: body.notes ?? null,
      recordReferences,
    });
    const evidenceHash = `0x${createHash("sha256").update(canonical).digest("hex")}`;

    let chainTxHash: string | null = null;
    if (withinTolerance && trade.chainTradeId !== null) {
      try {
        if (await chain.isAvailable()) {
          chainTxHash = await chain.submitEvidenceOnChain(trade.chainTradeId, evidenceHash);
        }
      } catch (err) {
        console.warn(`[chain] submitEvidenceOnChain failed for trade ${trade.id}:`, err);
      }
    }

    if (trade.escrowEnabled && withinTolerance && !chainTxHash) {
      throw serviceUnavailable(
        "Delivery evidence could not be recorded on the escrow contract, so the trade was not advanced. " +
          "Fix the chain connection and retry; the database was not marked as evidence-submitted.",
      );
    }

    const updated = await prisma.trade.update({
      where: { id: trade.id },
      data: {
        state: withinTolerance ? "EVIDENCE_SUBMITTED" : "REVIEW_REQUIRED",
        escrowState: trade.escrowEnabled
          ? withinTolerance
            ? "EVIDENCE_SUBMITTED"
            : "REVIEW_REQUIRED"
          : trade.escrowState,
        evidenceHash,
        discrepancyPct,
        deliveryEvidence: JSON.stringify(body),
      },
    });

    await prisma.evidenceBundle.create({
      data: {
        tradeId: trade.id,
        recordReferences: JSON.stringify(recordReferences),
        evidenceHash,
        attestationStatus: "PENDING",
      },
    });

    res.json({
      trade: tradeJson(updated),
      discrepancyPct,
      withinTolerance,
      chainTxHash,
      escrow: escrow.escrowJson(updated),
    });
  }),
);

tradesRouter.post(
  "/trades/:id/attest",
  requireRole("verifier", "admin"),
  asyncHandler(async (req, res) => {
    let trade = await loadTradeContext(req.params.id);
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    requireEscrowReady(trade);

    if (trade.escrowEnabled) {
      if (!(await chain.isReadable())) throw serviceUnavailable(escrowUnavailableMessage());
      const snapshot = await chain.getEscrowOnChain(trade.chainTradeId!);
      if (!snapshot) throw serviceUnavailable(escrowUnavailableMessage());

      if (snapshot.outcome !== 0) {
        if (snapshot.outcome === 1) {
          const synced = await syncIfEscrow(trade);
          await ensureRewardEvent(
            trade,
            "verified-delivery",
            rewardAmount(trade, snapshot.deliveredKwhMilli),
            synced.finalSettlementTxHash ?? synced.settlementTxHash,
          );
          const refreshed = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
          res.json({
            trade: tradeJson(refreshed),
            settlementTxHash: refreshed.finalSettlementTxHash ?? refreshed.settlementTxHash,
            chainDisabled: false,
            alreadySettled: true,
            escrow: escrow.escrowJson(refreshed),
          });
          return;
        }
        throw conflict("this escrow trade has already been resolved with a different outcome");
      }

      if (trade.state !== "EVIDENCE_SUBMITTED") {
        throw conflict(`trade must be in EVIDENCE_SUBMITTED state to attest (current: ${trade.state})`);
      }
      if (!(await chain.isAvailable())) throw serviceUnavailable(escrowUnavailableMessage());

      let settlementTxHash: string;
      try {
        const tx = await chain.attestAndSettleOnChain(trade.chainTradeId!);
        if (!tx) throw new Error("attestor wallet unavailable");
        settlementTxHash = tx;
      } catch (err) {
        console.warn(`[chain] attestAndSettleOnChain failed for escrow trade ${trade.id}:`, err);
        throw serviceUnavailable(escrowUnavailableMessage());
      }

      const after = await chain.getEscrowOnChain(trade.chainTradeId!);
      if (!after || after.outcome !== 1) {
        throw serviceUnavailable(
          "Settlement transaction was submitted but the contract did not report a successful escrow outcome. " +
            "The database was left unchanged; retry or reconcile the trade.",
        );
      }
      const updated = await escrow.applyEscrowSnapshot(trade.id, after, {
        settlementTxHash,
        finalSettlementTxHash: settlementTxHash,
      });
      await prisma.evidenceBundle.updateMany({
        where: { tradeId: trade.id, attestationStatus: "PENDING" },
        data: { attestationStatus: "ATTESTED", attestedBy: req.user!.id, attestedAt: new Date() },
      });
      await ensureRewardEvent(
        trade,
        "verified-delivery",
        rewardAmount(trade, after.deliveredKwhMilli),
        settlementTxHash,
      );
      const reward = await prisma.rewardEvent.findFirst({
        where: { tradeId: trade.id, reason: "verified-delivery" },
      });

      res.json({
        trade: tradeJson(updated),
        settlementTxHash,
        chainDisabled: false,
        escrow: escrow.escrowJson(updated),
        reward: reward
          ? {
              recipient: reward.recipient,
              amount: reward.amount,
              reason: reward.reason,
              chainTxHash: reward.chainTxHash,
            }
          : null,
      });
      return;
    }

    if (trade.state !== "EVIDENCE_SUBMITTED") {
      throw conflict(`trade must be in EVIDENCE_SUBMITTED state to attest (current: ${trade.state})`);
    }

    let chainDisabled = false;
    let settlementTxHash: string | null = null;
    if (trade.chainTradeId !== null) {
      try {
        if (await chain.isAvailable()) {
          settlementTxHash = await chain.attestAndSettleOnChain(trade.chainTradeId);
        } else {
          chainDisabled = true;
        }
      } catch (err) {
        console.warn(`[chain] attestAndSettleOnChain failed for trade ${trade.id}:`, err);
        chainDisabled = true;
      }
    } else {
      chainDisabled = true;
    }

    const updated = await prisma.trade.update({
      where: { id: trade.id },
      data: {
        state: "SETTLED",
        ...(settlementTxHash ? { settlementTxHash } : {}),
      },
    });

    await prisma.evidenceBundle.updateMany({
      where: { tradeId: trade.id, attestationStatus: "PENDING" },
      data: { attestationStatus: "ATTESTED", attestedBy: req.user!.id, attestedAt: new Date() },
    });

    const amount = rewardAmount(trade);
    await ensureRewardEvent(trade, "verified-delivery", amount, settlementTxHash);
    const reward = await prisma.rewardEvent.findFirstOrThrow({
      where: { tradeId: trade.id, reason: "verified-delivery" },
    });

    res.json({
      trade: tradeJson(updated),
      settlementTxHash,
      chainDisabled,
      escrow: null,
      reward: {
        recipient: reward.recipient,
        amount: reward.amount,
        reason: reward.reason,
        chainTxHash: reward.chainTxHash,
      },
    });
  }),
);

const partialSchema = z.object({
  deliveredKwh: z.number().positive(),
  note: z.string().optional(),
});

tradesRouter.post(
  "/trades/:id/partial-settlement",
  requireRole("verifier", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = partialSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("deliveredKwh is required and must be positive");
    const trade = await loadTradeContext(req.params.id);
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    requireEscrowReady(trade);
    requireEscrow(trade);
    if (parsed.data.deliveredKwh >= trade.agreedKwh) {
      throw badRequest("deliveredKwh must be less than agreedKwh; use /attest for full delivery");
    }
    if (trade.state !== "EVIDENCE_SUBMITTED") {
      throw conflict(`partial delivery requires EVIDENCE_SUBMITTED state (current: ${trade.state})`);
    }
    if (!(await chain.isAvailable())) throw serviceUnavailable(escrowUnavailableMessage());

    const deliveredMilli = escrow.kwhToMilli(parsed.data.deliveredKwh);
    if (deliveredMilli <= 0n) throw badRequest("deliveredKwh rounds to zero milli-kWh");
    if (deliveredMilli >= escrow.kwhToMilli(trade.agreedKwh)) {
      throw badRequest("deliveredKwh rounds to the full agreed quantity; use /attest for full delivery");
    }

    let settlementTxHash: string;
    try {
      const tx = await chain.attestPartialDeliveryOnChain(trade.chainTradeId!, deliveredMilli);
      if (!tx) throw new Error("attestor wallet unavailable");
      settlementTxHash = tx;
    } catch (err) {
      console.warn(`[chain] attestPartialDelivery failed for trade ${trade.id}:`, err);
      throw serviceUnavailable(escrowUnavailableMessage());
    }

    const after = await chain.getEscrowOnChain(trade.chainTradeId!);
    if (!after || after.outcome !== 2) {
      throw serviceUnavailable(
        "Partial-settlement transaction was submitted but the contract did not report a partial outcome. " +
          "The database was left unchanged; retry or reconcile the trade.",
      );
    }
    const updated = await escrow.applyEscrowSnapshot(trade.id, after, {
      settlementTxHash,
      finalSettlementTxHash: settlementTxHash,
    });
    await prisma.evidenceBundle.updateMany({
      where: { tradeId: trade.id, attestationStatus: "PENDING" },
      data: { attestationStatus: "ATTESTED", attestedBy: req.user!.id, attestedAt: new Date() },
    });
    await ensureRewardEvent(
      trade,
      "verified-partial-delivery",
      rewardAmount(trade, after.deliveredKwhMilli),
      settlementTxHash,
    );

    res.json({
      trade: tradeJson(updated),
      settlementTxHash,
      chainDisabled: false,
      escrow: escrow.escrowJson(updated),
    });
  }),
);

const defaultSchema = z.object({
  reason: z.string().min(1).default("verified non-delivery"),
  evidenceHash: z.string().optional(),
});

tradesRouter.post(
  "/trades/:id/resolve-default",
  requireRole("verifier", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = defaultSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("invalid default resolution body");
    const trade = await loadTradeContext(req.params.id);
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    requireEscrowReady(trade);
    requireEscrow(trade);

    if (trade.deliveryDeadline) {
      const closeAt =
        trade.deliveryDeadline.getTime() + (trade.deliveryGracePeriodSeconds ?? 0) * 1000;
      if (Date.now() < closeAt) {
        throw conflict(
          `producer default cannot be resolved before the delivery deadline plus grace period (${new Date(closeAt).toISOString()})`,
        );
      }
    }
    if (!["DELIVERY_ACTIVE", "EVIDENCE_SUBMITTED"].includes(trade.state)) {
      throw conflict(
        `default resolution requires DELIVERY_ACTIVE or EVIDENCE_SUBMITTED (current: ${trade.state}); ` +
          "use /disputes/resolve for a disputed trade",
      );
    }
    if (!(await chain.isAvailable())) throw serviceUnavailable(escrowUnavailableMessage());

    const evidenceHash = toBytes32(parsed.data.evidenceHash, parsed.data.reason);
    let settlementTxHash: string;
    try {
      const tx = await chain.resolveProducerDefaultOnChain(trade.chainTradeId!, evidenceHash);
      if (!tx) throw new Error("attestor wallet unavailable");
      settlementTxHash = tx;
    } catch (err) {
      console.warn(`[chain] resolveProducerDefault failed for trade ${trade.id}:`, err);
      throw serviceUnavailable(escrowUnavailableMessage());
    }

    const after = await chain.getEscrowOnChain(trade.chainTradeId!);
    if (!after || after.outcome !== 3) {
      throw serviceUnavailable(
        "Default-resolution transaction was submitted but the contract did not report producer default. " +
          "The database was left unchanged; retry or reconcile the trade.",
      );
    }
    const updated = await escrow.applyEscrowSnapshot(trade.id, after, {
      settlementTxHash,
      finalSettlementTxHash: settlementTxHash,
      disputeResolutionOutcome: "PRODUCER_DEFAULT",
      disputeResolutionReason: parsed.data.reason,
      disputeResolutionEvidenceHash: evidenceHash,
      disputeResolutionTxHash: settlementTxHash,
    });
    await prisma.evidenceBundle.updateMany({
      where: { tradeId: trade.id, attestationStatus: "PENDING" },
      data: { attestationStatus: "REJECTED", attestedBy: req.user!.id, attestedAt: new Date() },
    });

    res.json({
      trade: tradeJson(updated),
      settlementTxHash,
      chainDisabled: false,
      escrow: escrow.escrowJson(updated),
    });
  }),
);

const disputeSchema = z.object({
  reason: z.string().min(1).default("disputed by verifier"),
});

tradesRouter.post(
  "/trades/:id/dispute",
  requireRole("verifier", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = disputeSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("invalid dispute body");
    const { reason } = parsed.data;

    const trade = await loadTradeContext(req.params.id);
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    requireEscrowReady(trade);
    if (!["MATCHED", "DELIVERY_ACTIVE", "EVIDENCE_SUBMITTED", "REVIEW_REQUIRED"].includes(trade.state)) {
      throw conflict(`trade cannot be disputed from state ${trade.state}`);
    }
    if (trade.escrowEnabled && ["MATCHED", "REVIEW_REQUIRED"].includes(trade.state)) {
      throw conflict("an unfunded escrow must be cancelled or funded, not disputed");
    }

    let chainTxHash: string | null = null;
    if (trade.escrowEnabled) {
      if (!(await chain.isAvailable())) throw serviceUnavailable(escrowUnavailableMessage());
      try {
        chainTxHash = await chain.disputeOnChain(trade.chainTradeId!, reason);
      } catch (err) {
        console.warn(`[chain] disputeOnChain failed for trade ${trade.id}:`, err);
        throw serviceUnavailable(escrowUnavailableMessage());
      }
    } else if (trade.chainTradeId !== null) {
      try {
        if (await chain.isAvailable()) {
          chainTxHash = await chain.disputeOnChain(trade.chainTradeId, reason);
        }
      } catch (err) {
        console.warn(`[chain] disputeOnChain failed for trade ${trade.id}:`, err);
      }
    }

    let updated: PrismaTrade;
    if (trade.escrowEnabled) {
      updated = await escrow.applyEscrowSnapshot(
        trade.id,
        (await chain.getEscrowOnChain(trade.chainTradeId!))!,
        {
          state: "DISPUTED",
          escrowState: "DISPUTED",
          disputeRaisedBy: req.user!.id,
          disputeReason: reason,
          disputeTxHash: chainTxHash,
        },
      );
    } else {
      updated = await prisma.trade.update({
        where: { id: trade.id },
        data: { state: "DISPUTED", deliveryEvidence: JSON.stringify({ disputeReason: reason }) },
      });
    }

    res.json({ trade: tradeJson(updated), chainTxHash, escrow: escrow.escrowJson(updated) });
  }),
);

const participantDisputeSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

tradesRouter.post(
  "/trades/:id/escrow/dispute",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = participantDisputeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("reason and a valid transaction hash are required");
    const trade = await loadTradeContext(req.params.id);
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    requireEscrowReady(trade);
    requireEscrow(trade);
    const wallet = requireParty(trade, req.user!);
    if (trade.state === "DISPUTED" && trade.disputeTxHash === parsed.data.txHash) {
      res.json({ trade: tradeJson(trade), escrow: escrow.escrowJson(trade), alreadyDisputed: true });
      return;
    }
    if (trade.state !== "DELIVERY_ACTIVE" && trade.state !== "EVIDENCE_SUBMITTED") {
      throw conflict(`trade cannot be disputed from state ${trade.state}`);
    }
    if (!(await chain.isReadable())) throw serviceUnavailable(escrowUnavailableMessage());

    try {
      await chain.verifyEscrowDisputeTx(
        parsed.data.txHash,
        trade.chainTradeId!,
        wallet,
        parsed.data.reason,
      );
    } catch (err) {
      throw conflict(
        `dispute transaction could not be verified: ${err instanceof Error ? err.message : String(err)}`,
        "CHAIN_ERROR",
      );
    }
    const snapshot = await chain.getEscrowOnChain(trade.chainTradeId!);
    if (!snapshot) throw serviceUnavailable(escrowUnavailableMessage());
    const updated = await escrow.applyEscrowSnapshot(trade.id, snapshot, {
      state: "DISPUTED",
      escrowState: "DISPUTED",
      disputeRaisedBy: req.user!.id,
      disputeReason: parsed.data.reason,
      disputeTxHash: parsed.data.txHash,
    });
    res.json({ trade: tradeJson(updated), escrow: escrow.escrowJson(updated) });
  }),
);

const resolveDisputeSchema = z.object({
  outcome: z.enum(["full_delivery", "partial_delivery", "producer_default"]),
  deliveredKwh: z.number().positive().optional(),
  reason: z.string().trim().min(1),
  evidenceHash: z.string().optional(),
});

tradesRouter.post(
  "/trades/:id/disputes/resolve",
  requireRole("verifier", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = resolveDisputeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const body = parsed.data;
    const trade = await loadTradeContext(req.params.id);
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    requireEscrowReady(trade);
    requireEscrow(trade);
    if (trade.state !== "DISPUTED") throw conflict(`trade is not disputed (current: ${trade.state})`);
    if (!(await chain.isAvailable())) throw serviceUnavailable(escrowUnavailableMessage());

    const outcome = escrow.ESCROW_OUTCOME_ENUM[body.outcome];
    let deliveredMilli = 0n;
    if (body.outcome === "partial_delivery") {
      if (!body.deliveredKwh) throw badRequest("deliveredKwh is required for a partial-delivery outcome");
      if (body.deliveredKwh >= trade.agreedKwh) {
        throw badRequest("deliveredKwh must be less than agreedKwh");
      }
      deliveredMilli = escrow.kwhToMilli(body.deliveredKwh);
      if (deliveredMilli <= 0n || deliveredMilli >= escrow.kwhToMilli(trade.agreedKwh)) {
        throw badRequest("deliveredKwh must be positive and less than the agreed quantity at milli-kWh precision");
      }
    }
    const reasonHash = toBytes32(undefined, body.reason);
    const evidenceHash = toBytes32(body.evidenceHash, body.reason);

    let settlementTxHash: string;
    try {
      const tx = await chain.resolveDisputeOnChain(
        trade.chainTradeId!,
        outcome,
        deliveredMilli,
        body.reason,
        evidenceHash,
      );
      if (!tx) throw new Error("attestor wallet unavailable");
      settlementTxHash = tx;
    } catch (err) {
      console.warn(`[chain] resolveDispute failed for trade ${trade.id}:`, err);
      throw serviceUnavailable(escrowUnavailableMessage());
    }

    const after = await chain.getEscrowOnChain(trade.chainTradeId!);
    if (!after || after.outcome !== outcome) {
      throw serviceUnavailable(
        "Dispute-resolution transaction was submitted but the contract did not report the expected outcome. " +
          "The database was left unchanged; retry or reconcile the trade.",
      );
    }
    const updated = await escrow.applyEscrowSnapshot(trade.id, after, {
      settlementTxHash,
      finalSettlementTxHash: settlementTxHash,
      disputeResolutionOutcome: body.outcome.toUpperCase(),
      disputeResolutionReason: body.reason,
      disputeResolutionEvidenceHash: evidenceHash,
      disputeResolutionTxHash: settlementTxHash,
    });
    if (outcome === 3) {
      await prisma.evidenceBundle.updateMany({
        where: { tradeId: trade.id, attestationStatus: "PENDING" },
        data: { attestationStatus: "REJECTED", attestedBy: req.user!.id, attestedAt: new Date() },
      });
    } else {
      await prisma.evidenceBundle.updateMany({
        where: { tradeId: trade.id, attestationStatus: "PENDING" },
        data: { attestationStatus: "ATTESTED", attestedBy: req.user!.id, attestedAt: new Date() },
      });
      await ensureRewardEvent(
        trade,
        outcome === 1 ? "verified-delivery" : "verified-partial-delivery",
        rewardAmount(trade, outcome === 1 ? after.deliveredKwhMilli : after.deliveredKwhMilli),
        settlementTxHash,
      );
    }

    res.json({
      trade: tradeJson(updated),
      settlementTxHash,
      reasonHash,
      escrow: escrow.escrowJson(updated),
    });
  }),
);

const depositSchema = z.object({
  kind: z.enum(["consumer_payment", "consumer_collateral", "producer_collateral"]),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

tradesRouter.post(
  "/trades/:id/escrow/deposits",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = depositSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("kind and a valid transaction hash are required");
    const { kind, txHash } = parsed.data;
    const trade = await loadTradeContext(req.params.id);
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    requireEscrowReady(trade);
    requireEscrow(trade);
    const expectedParty = kind === "producer_collateral" ? "producer" : "consumer";
    const wallet = requireParty(trade, req.user!, expectedParty);

    if (!(await chain.isReadable())) throw serviceUnavailable(escrowUnavailableMessage());
    const snapshot = await chain.getEscrowOnChain(trade.chainTradeId!);
    if (!snapshot) throw serviceUnavailable(escrowUnavailableMessage());

    const existingTx =
      kind === "consumer_payment"
        ? trade.consumerPaymentTxHash
        : kind === "consumer_collateral"
          ? trade.consumerCollateralTxHash
          : trade.producerCollateralTxHash;
    if (existingTx) {
      if (existingTx.toLowerCase() === txHash.toLowerCase()) {
        res.json({ trade: tradeJson(trade), escrow: escrow.escrowJson(trade), idempotent: true });
        return;
      }
      throw conflict(`${kind} was already recorded with a different transaction`);
    }

    const expectedAmount =
      kind === "consumer_payment"
        ? snapshot.paymentRequired
        : kind === "consumer_collateral"
          ? snapshot.consumerCollateralRequired
          : snapshot.producerCollateralRequired;

    try {
      await chain.verifyEscrowDepositTx(
        txHash,
        trade.chainTradeId!,
        wallet,
        escrow.DEPOSIT_KINDS[kind],
        expectedAmount,
      );
    } catch (err) {
      throw conflict(
        `deposit transaction could not be verified: ${err instanceof Error ? err.message : String(err)}`,
        "CHAIN_ERROR",
      );
    }

    const after = await chain.getEscrowOnChain(trade.chainTradeId!);
    if (!after) throw serviceUnavailable(escrowUnavailableMessage());
    const txField =
      kind === "consumer_payment"
        ? { consumerPaymentTxHash: txHash }
        : kind === "consumer_collateral"
          ? { consumerCollateralTxHash: txHash }
          : { producerCollateralTxHash: txHash };
    const activationField =
      after.state === "DeliveryActive" && !trade.fundingActivationTxHash
        ? { fundingActivationTxHash: txHash }
        : {};
    const updated = await escrow.applyEscrowSnapshot(trade.id, after, {
      ...txField,
      ...activationField,
    });

    res.json({ trade: tradeJson(updated), escrow: escrow.escrowJson(updated), idempotent: false });
  }),
);

tradesRouter.post(
  "/trades/:id/escrow/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    let trade = await loadTradeContext(req.params.id);
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    requireEscrowReady(trade);
    requireEscrow(trade);

    const party = partyForTrade(trade, req.user!);
    const mayCancel =
      party !== null || req.user!.role === "verifier" || req.user!.role === "admin";
    if (!mayCancel) throw forbidden("only a participant or an authorized verifier may cancel this escrow");

    if (trade.state === "CANCELLED") {
      await syncIfEscrow(trade);
      trade = await loadTradeContext(req.params.id);
      res.json({ trade: tradeJson(trade!), escrow: escrow.escrowJson(trade!), idempotent: true });
      return;
    }
    if (trade.state !== "MATCHED") {
      throw conflict(`only an unfunded MATCHED escrow can be cancelled (current: ${trade.state})`);
    }
    if (trade.fundingDeadline && Date.now() <= trade.fundingDeadline.getTime()) {
      throw conflict(
        `funding deadline has not passed yet (${trade.fundingDeadline.toISOString()}); deposits can still be made`,
      );
    }
    if (!(await chain.isAvailable())) throw serviceUnavailable(escrowUnavailableMessage());

    let txHash: string | null = null;
    try {
      txHash = await chain.cancelExpiredEscrowOnChain(trade.chainTradeId!);
    } catch (err) {
      console.warn(`[chain] cancelExpiredEscrow failed for trade ${trade.id}:`, err);
      throw serviceUnavailable(escrowUnavailableMessage());
    }
    const after = await chain.getEscrowOnChain(trade.chainTradeId!);
    if (!after || after.outcome !== 4) {
      throw serviceUnavailable(
        "Cancellation transaction was submitted but the contract did not report a cancelled escrow. " +
          "The database was left unchanged; retry or reconcile the trade.",
      );
    }
    const updated = await escrow.applyEscrowSnapshot(trade.id, after, {
      settlementTxHash: txHash,
      finalSettlementTxHash: txHash,
    });
    res.json({ trade: tradeJson(updated), settlementTxHash: txHash, escrow: escrow.escrowJson(updated) });
  }),
);

tradesRouter.get(
  "/trades/:id/escrow",
  asyncHandler(async (req, res) => {
    let trade = await loadTradeContext(req.params.id);
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    if (trade.escrowEnabled && !trade.escrowState?.startsWith("UNAVAILABLE")) {
      await syncIfEscrow(trade);
      trade = await loadTradeContext(req.params.id);
      if (!trade) throw notFound(`trade ${req.params.id} not found`);
    }
    res.json({
      trade: {
        id: trade!.id,
        state: trade!.state,
        agreedKwh: trade!.agreedKwh,
        pricePerKwh: trade!.pricePerKwh,
        chainTradeId: trade!.chainTradeId,
      },
      escrow: escrow.escrowJson(trade!),
      chain: {
        enabled: config.CHAIN_ENABLED,
        readable: await chain.isReadable(),
        writable: await chain.isAvailable(),
      },
    });
  }),
);

tradesRouter.post(
  "/trades/:id/escrow/sync",
  requireAuth,
  asyncHandler(async (req, res) => {
    const trade = await loadTradeContext(req.params.id);
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    requireEscrowReady(trade);
    requireEscrow(trade);
    const party = partyForTrade(trade, req.user!);
    if (party === null && !["verifier", "admin", "coordinator"].includes(req.user!.role)) {
      throw forbidden("only a participant or an authorized verifier may reconcile this trade");
    }
    if (!(await chain.isReadable())) throw serviceUnavailable(escrowUnavailableMessage());
    const updated = await escrow.syncEscrowTrade(trade.id);
    if (!updated) throw notFound(`trade ${req.params.id} not found`);
    res.json({ trade: tradeJson(updated), escrow: escrow.escrowJson(updated) });
  }),
);

tradesRouter.get(
  "/trades/:id/receipt",
  asyncHandler(async (req, res) => {
    let trade = await loadTradeContext(req.params.id);
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    if (trade.escrowEnabled) {
      await syncIfEscrow(trade);
      trade = await loadTradeContext(req.params.id);
      if (!trade) throw notFound(`trade ${req.params.id} not found`);
    }

    const bundle = trade.evidenceBundles[0] ?? null;
    const withinTolerance =
      trade.discrepancyPct !== null && trade.discrepancyPct <= config.DELIVERY_TOLERANCE_PCT;

    let stateOnChain: string | null = null;
    if (trade.chainTradeId !== null) {
      try {
        stateOnChain = await chain.getStateOnChain(trade.chainTradeId);
      } catch (err) {
        console.warn(`[chain] getStateOnChain failed for trade ${trade.id}:`, err);
      }
    }

    res.json({
      trade: {
        id: trade.id,
        state: trade.state,
        agreedKwh: trade.agreedKwh,
        pricePerKwh: trade.pricePerKwh,
        estimatedValue: round4(trade.agreedKwh * trade.pricePerKwh),
      },
      offer: { id: trade.offerId, facilityId: trade.offer.facilityId },
      request: { id: trade.requestId, buyerId: trade.request.buyerId },
      evidence: bundle
        ? {
            hash: bundle.evidenceHash,
            discrepancyPct: trade.discrepancyPct,
            withinTolerance,
            recordReferences: JSON.parse(bundle.recordReferences) as string[],
            attestationStatus: bundle.attestationStatus,
          }
        : null,
      chain: {
        enabled: config.CHAIN_ENABLED,
        tradeId: trade.chainTradeId,
        txHash: trade.chainTxHash,
        settlementTxHash: trade.settlementTxHash,
        stateOnChain,
      },
      escrow: escrow.escrowJson(trade),
      rewards: trade.rewardEvents.map((r) => ({
        recipient: r.recipient,
        amount: r.amount,
        reason: r.reason,
        txHash: r.chainTxHash,
      })),
    });
  }),
);
