import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { config } from "../config";
import { requireAuth, requireRole } from "../auth";
import { asyncHandler, badRequest, conflict, notFound } from "../errors";
import * as chain from "../services/chain";

export const tradesRouter = Router();

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

function tradeJson(trade: {
  id: string;
  offerId: string;
  requestId: string;
  agreedKwh: number;
  pricePerKwh: number;
  state: string;
  evidenceHash: string | null;
  discrepancyPct: number | null;
  chainTradeId: number | null;
  chainTxHash: string | null;
  settlementTxHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
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
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
  };
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
    const trade = await prisma.trade.findUnique({
      where: { id: req.params.id },
      include: { evidenceBundles: true, rewardEvents: true },
    });
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    res.json({
      ...tradeJson(trade),
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

    const trade = await prisma.trade.findUnique({ where: { id: req.params.id } });
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    if (trade.state !== "MATCHED") {
      throw conflict(`evidence can only be attached to MATCHED trades (current: ${trade.state})`);
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

    const updated = await prisma.trade.update({
      where: { id: trade.id },
      data: {
        state: withinTolerance ? "EVIDENCE_SUBMITTED" : "REVIEW_REQUIRED",
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
    });
  }),
);

tradesRouter.post(
  "/trades/:id/attest",
  requireRole("verifier", "admin"),
  asyncHandler(async (req, res) => {
    const trade = await prisma.trade.findUnique({
      where: { id: req.params.id },
      include: { offer: { include: { facility: { include: { owner: true } } } }, evidenceBundles: true },
    });
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
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

    const amount = (BigInt(Math.floor(trade.agreedKwh * 1e6)) * 10n ** 12n).toString();
    const recipient = trade.offer.facility.owner.walletAddress ?? chain.userAddressFromId(trade.offer.facility.ownerId);
    const reward = await prisma.rewardEvent.create({
      data: {
        tradeId: trade.id,
        recipient,
        amount,
        reason: "verified-delivery",
        chainTxHash: settlementTxHash,
      },
    });

    res.json({
      trade: tradeJson(updated),
      settlementTxHash,
      chainDisabled,
      reward: {
        recipient: reward.recipient,
        amount: reward.amount,
        reason: reward.reason,
        chainTxHash: reward.chainTxHash,
      },
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

    const trade = await prisma.trade.findUnique({ where: { id: req.params.id } });
    if (!trade) throw notFound(`trade ${req.params.id} not found`);
    if (!["MATCHED", "EVIDENCE_SUBMITTED", "REVIEW_REQUIRED"].includes(trade.state)) {
      throw conflict(`trade cannot be disputed from state ${trade.state}`);
    }

    let chainTxHash: string | null = null;
    if (trade.chainTradeId !== null) {
      try {
        if (await chain.isAvailable()) {
          chainTxHash = await chain.disputeOnChain(trade.chainTradeId, reason);
        }
      } catch (err) {
        console.warn(`[chain] disputeOnChain failed for trade ${trade.id}:`, err);
      }
    }

    const updated = await prisma.trade.update({
      where: { id: trade.id },
      data: { state: "DISPUTED", deliveryEvidence: JSON.stringify({ disputeReason: reason }) },
    });

    res.json({ trade: tradeJson(updated), chainTxHash });
  }),
);

tradesRouter.get(
  "/trades/:id/receipt",
  asyncHandler(async (req, res) => {
    const trade = await prisma.trade.findUnique({
      where: { id: req.params.id },
      include: {
        offer: true,
        request: true,
        evidenceBundles: { orderBy: { createdAt: "desc" } },
        rewardEvents: true,
      },
    });
    if (!trade) throw notFound(`trade ${req.params.id} not found`);

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
      rewards: trade.rewardEvents.map((r) => ({
        recipient: r.recipient,
        amount: r.amount,
        reason: r.reason,
        txHash: r.chainTxHash,
      })),
    });
  }),
);
