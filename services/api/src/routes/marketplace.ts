import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../auth";
import { asyncHandler, badRequest, conflict, forbidden, notFound, serviceUnavailable } from "../errors";
import { computeClaimOfferable } from "../services/offers";
import * as chain from "../services/chain";
import * as escrow from "../services/escrow";
import { config } from "../config";

export const marketplaceRouter = Router();

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function iso(value: Date): string {
  return value.toISOString();
}

const createOfferSchema = z.object({
  claimId: z.string().min(1),
  quantityKwh: z.number().positive(),
  pricePerKwh: z.number().nonnegative(),
});

marketplaceRouter.post(
  "/offers",
  requireRole("producer", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = createOfferSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const { claimId, quantityKwh, pricePerKwh } = parsed.data;

    const eligibility = await computeClaimOfferable(claimId);
    if (eligibility.reason === "claim not found") throw notFound(`claim ${claimId} not found`);
    if (!eligibility.eligible || quantityKwh > eligibility.offerableKwh) {
      throw badRequest(
        eligibility.eligible
          ? `quantityKwh ${quantityKwh} exceeds offerable ${round4(eligibility.offerableKwh)} kWh`
          : (eligibility.reason ?? "offer not eligible"),
        "NOT_ELIGIBLE",
      );
    }

    const offer = await prisma.energyOffer.create({
      data: {
        facilityId: eligibility.facilityId,
        claimId,
        intervalStart: eligibility.intervalStart,
        intervalEnd: eligibility.intervalEnd,
        quantityKwh,
        reservedKwh: 0,
        pricePerKwh,
        status: "OPEN",
        createdById: req.user!.id,
      },
    });

    res.status(201).json(offerJson(offer));
  }),
);

marketplaceRouter.get(
  "/offers",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const offers = await prisma.energyOffer.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
    });
    res.json({ offers: offers.map(offerJson) });
  }),
);

marketplaceRouter.post(
  "/offers/:id/withdraw",
  requireAuth,
  asyncHandler(async (req, res) => {
    const offer = await prisma.energyOffer.findUnique({ where: { id: req.params.id }, include: { facility: true } });
    if (!offer) throw notFound(`offer ${req.params.id} not found`);
    const user = req.user!;
    if (user.role !== "admin" && user.role !== "producer" && offer.facility.ownerId !== user.id) {
      throw forbidden("offer owner, producer, or admin role required");
    }
    if (offer.status === "WITHDRAWN") throw conflict("offer already withdrawn");
    if (offer.reservedKwh > 0) throw conflict("offer has reserved quantity and cannot be withdrawn");
    if (offer.status !== "OPEN") throw conflict(`offer cannot be withdrawn from status ${offer.status}`);

    const updated = await prisma.energyOffer.update({ where: { id: offer.id }, data: { status: "WITHDRAWN" } });
    res.json(offerJson(updated));
  }),
);

const createRequestSchema = z.object({
  quantityKwh: z.number().positive(),
  maxPricePerKwh: z.number().nonnegative(),
  intervalStart: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)))
    .transform((s) => new Date(s)),
  intervalEnd: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)))
    .transform((s) => new Date(s)),
  destinationFacilityId: z.string().optional(),
});

marketplaceRouter.post(
  "/requests",
  requireRole("consumer", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const body = parsed.data;
    if (body.intervalEnd <= body.intervalStart) throw badRequest("intervalEnd must be after intervalStart");

    const request = await prisma.energyRequest.create({
      data: {
        buyerId: req.user!.id,
        destinationFacilityId: body.destinationFacilityId ?? null,
        intervalStart: body.intervalStart,
        intervalEnd: body.intervalEnd,
        quantityKwh: body.quantityKwh,
        allocatedKwh: 0,
        maxPricePerKwh: body.maxPricePerKwh,
        status: "OPEN",
      },
    });
    res.status(201).json(requestJson(request));
  }),
);

marketplaceRouter.get(
  "/requests",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const requests = await prisma.energyRequest.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
    });
    res.json({ requests: requests.map(requestJson) });
  }),
);

interface MatchPlan {
  offerId: string;
  requestId: string;
  intervalStart: Date;
  intervalEnd: Date;
  agreedKwh: number;
  pricePerKwh: number;
}

async function planMatches(filter?: { intervalStart?: Date; intervalEnd?: Date }): Promise<{
  matches: Array<MatchPlan & { reason: string }>;
  unmatchedOffers: Array<{ offerId: string; reason: string }>;
  unmatchedRequests: Array<{ requestId: string; reason: string }>;
}> {
  const offers = await prisma.energyOffer.findMany({
    where: {
      status: { in: ["OPEN", "PARTIALLY_RESERVED"] },
      ...(filter?.intervalStart ? { intervalStart: filter.intervalStart } : {}),
      ...(filter?.intervalEnd ? { intervalEnd: filter.intervalEnd } : {}),
    },
    include: { claim: true },
  });
  const requests = await prisma.energyRequest.findMany({
    where: {
      status: { in: ["OPEN", "PARTIALLY_FILLED"] },
      ...(filter?.intervalStart ? { intervalStart: filter.intervalStart } : {}),
      ...(filter?.intervalEnd ? { intervalEnd: filter.intervalEnd } : {}),
    },
  });

  const eligibleOffers = offers.filter((o) => o.claim.status === "VERIFIED_FOR_PROTOTYPE");

  const groups = new Map<string, { offers: typeof eligibleOffers; requests: typeof requests }>();
  for (const offer of eligibleOffers) {
    const key = `${offer.intervalStart.getTime()}|${offer.intervalEnd.getTime()}`;
    const group = groups.get(key) ?? { offers: [], requests: [] };
    group.offers.push(offer);
    groups.set(key, group);
  }
  for (const request of requests) {
    const key = `${request.intervalStart.getTime()}|${request.intervalEnd.getTime()}`;
    const group = groups.get(key) ?? { offers: [], requests: [] };
    group.requests.push(request);
    groups.set(key, group);
  }

  const matches: Array<MatchPlan & { reason: string }> = [];
  const matchedOfferIds = new Set<string>();
  const matchedRequestIds = new Set<string>();
  const requestRemaining = new Map<string, number>();
  const offerRemaining = new Map<string, number>();

  for (const group of groups.values()) {
    const sortedOffers = [...group.offers].sort(
      (a, b) => a.pricePerKwh - b.pricePerKwh || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const sortedRequests = [...group.requests].sort(
      (a, b) => b.maxPricePerKwh - a.maxPricePerKwh || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    for (const offer of sortedOffers) {
      offerRemaining.set(offer.id, Math.max(0, offer.quantityKwh - offer.reservedKwh));
    }
    for (const request of sortedRequests) {
      requestRemaining.set(request.id, Math.max(0, request.quantityKwh - request.allocatedKwh));
    }

    for (const request of sortedRequests) {
      let remainingRequest = requestRemaining.get(request.id) ?? 0;
      for (const offer of sortedOffers) {
        if (remainingRequest <= 0) break;
        if (offer.pricePerKwh > request.maxPricePerKwh) continue;
        const remainingOffer = offerRemaining.get(offer.id) ?? 0;
        if (remainingOffer <= 0) continue;
        const agreedKwh = round4(Math.min(remainingOffer, remainingRequest));
        if (agreedKwh <= 0) continue;
        offerRemaining.set(offer.id, remainingOffer - agreedKwh);
        remainingRequest -= agreedKwh;
        requestRemaining.set(request.id, remainingRequest);
        matchedOfferIds.add(offer.id);
        matchedRequestIds.add(request.id);
        matches.push({
          offerId: offer.id,
          requestId: request.id,
          intervalStart: offer.intervalStart,
          intervalEnd: offer.intervalEnd,
          agreedKwh,
          pricePerKwh: offer.pricePerKwh,
          reason: "lowest price offer with compatible interval and price <= max",
        });
      }
    }
  }

  const unmatchedOffers = eligibleOffers
    .filter((o) => !matchedOfferIds.has(o.id))
    .map((o) => ({ offerId: o.id, reason: "NO_COMPATIBLE_REQUEST" }));
  const unmatchedRequests = requests
    .filter((r) => !matchedRequestIds.has(r.id))
    .map((r) => ({ requestId: r.id, reason: "INSUFFICIENT_OFFERS" }));

  return { matches, unmatchedOffers, unmatchedRequests };
}

const previewSchema = z
  .object({
    intervalStart: z.string().optional(),
    intervalEnd: z.string().optional(),
  })
  .partial();

marketplaceRouter.post(
  "/matches/preview",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = previewSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("invalid preview body");
    const filter: { intervalStart?: Date; intervalEnd?: Date } = {};
    if (parsed.data.intervalStart) {
      const d = new Date(parsed.data.intervalStart);
      if (Number.isNaN(d.getTime())) throw badRequest("invalid intervalStart");
      filter.intervalStart = d;
    }
    if (parsed.data.intervalEnd) {
      const d = new Date(parsed.data.intervalEnd);
      if (Number.isNaN(d.getTime())) throw badRequest("invalid intervalEnd");
      filter.intervalEnd = d;
    }
    const result = await planMatches(filter);
    res.json(result);
  }),
);

marketplaceRouter.post(
  "/matches/run",
  requireRole("coordinator", "verifier", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = previewSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("invalid body");
    const filter: { intervalStart?: Date; intervalEnd?: Date } = {};
    if (parsed.data.intervalStart) filter.intervalStart = new Date(parsed.data.intervalStart);
    if (parsed.data.intervalEnd) filter.intervalEnd = new Date(parsed.data.intervalEnd);

    const escrowIntended =
      config.ESCROW_ENABLED && config.CHAIN_ENABLED && chain.isEscrowConfigured();
    if (escrowIntended && !(await chain.isAvailable())) {
      throw serviceUnavailable(
        "Mutual escrow is enabled for this deployment, but the chain or operator wallet is unavailable. " +
          "No trades were created because a trade must not be settleable off-chain when escrow is required.",
      );
    }

    const plan = await planMatches(filter);
    const createdTrades: Array<Record<string, unknown>> = [];
    const skipped: Array<{ offerId: string; requestId: string; reason: string }> = [];

    for (const match of plan.matches) {
      try {
        const trade = await prisma.$transaction(async (tx) => {
          const offerRows = await tx.$executeRaw`
            UPDATE "EnergyOffer"
            SET "reservedKwh" = "reservedKwh" + ${match.agreedKwh}
            WHERE "id" = ${match.offerId}
              AND "status" IN ('OPEN', 'PARTIALLY_RESERVED')
              AND "reservedKwh" + ${match.agreedKwh} <= "quantityKwh"`;
          if (offerRows === 0) return null;

          const requestRows = await tx.$executeRaw`
            UPDATE "EnergyRequest"
            SET "allocatedKwh" = "allocatedKwh" + ${match.agreedKwh}
            WHERE "id" = ${match.requestId}
              AND "status" IN ('OPEN', 'PARTIALLY_FILLED')
              AND "allocatedKwh" + ${match.agreedKwh} <= "quantityKwh"`;
          if (requestRows === 0) throw new Error("REQUEST_RESERVATION_FAILED");

          const offer = await tx.energyOffer.findUniqueOrThrow({ where: { id: match.offerId } });
          await tx.energyOffer.update({
            where: { id: offer.id },
            data: { status: offer.reservedKwh >= offer.quantityKwh ? "FILLED" : "PARTIALLY_RESERVED" },
          });
          const request = await tx.energyRequest.findUniqueOrThrow({ where: { id: match.requestId } });
          await tx.energyRequest.update({
            where: { id: request.id },
            data: { status: request.allocatedKwh >= request.quantityKwh ? "FILLED" : "PARTIALLY_FILLED" },
          });

          return tx.trade.create({
            data: {
              offerId: match.offerId,
              requestId: match.requestId,
              agreedKwh: match.agreedKwh,
              pricePerKwh: match.pricePerKwh,
              state: "MATCHED",
            },
          });
        });

        if (!trade) {
          skipped.push({ offerId: match.offerId, requestId: match.requestId, reason: "OFFER_RESERVATION_CONFLICT" });
          continue;
        }

        let chainTradeId: number | null = null;
        let chainTxHash: string | null = null;
        let escrowEnabled = false;
        let escrowError: string | null = null;
        try {
          if (await chain.isAvailable()) {
            const offer = await prisma.energyOffer.findUniqueOrThrow({
              where: { id: match.offerId },
              include: { facility: { include: { owner: true } } },
            });
            const request = await prisma.energyRequest.findUniqueOrThrow({
              where: { id: match.requestId },
              include: { buyer: true },
            });
            const producerAddress = offer.facility.owner.walletAddress ?? chain.userAddressFromId(offer.facility.ownerId);
            const consumerAddress = request.buyer.walletAddress ?? chain.userAddressFromId(request.buyerId);

            if (escrowIntended) {
              try {
                const escrowed = await escrow.createEscrowForTrade({
                  trade,
                  producerAddress,
                  consumerAddress,
                  intervalEnd: match.intervalEnd,
                });
                if (escrowed) {
                  chainTradeId = escrowed.chainTradeId;
                  chainTxHash = escrowed.chainTxHash;
                  escrowEnabled = true;
                } else {
                  throw new Error("escrow configuration became unavailable");
                }
              } catch (err) {
                escrowError = err instanceof Error ? err.message : String(err);
                console.warn(`[escrow] registration failed for trade ${trade.id}:`, err);
                await prisma.trade.update({
                  where: { id: trade.id },
                  data: {
                    escrowRequired: true,
                    escrowState: "UNAVAILABLE",
                    state: "REVIEW_REQUIRED",
                  },
                });
              }
            } else {
              const onChain = await chain.createTradeOnChain(
                trade.id,
                producerAddress,
                consumerAddress,
                match.agreedKwh,
                match.pricePerKwh,
              );
              chainTradeId = onChain.chainTradeId;
              chainTxHash = onChain.txHash;
              if (chainTradeId !== null || chainTxHash !== null) {
                await prisma.trade.update({
                  where: { id: trade.id },
                  data: { chainTradeId, chainTxHash },
                });
              }
            }
          }
        } catch (err) {
          console.warn(`[chain] trade registration failed for trade ${trade.id}:`, err);
          escrowError = err instanceof Error ? err.message : String(err);
        }

        createdTrades.push({
          tradeId: trade.id,
          offerId: trade.offerId,
          requestId: trade.requestId,
          agreedKwh: trade.agreedKwh,
          pricePerKwh: trade.pricePerKwh,
          state: escrowError ? "REVIEW_REQUIRED" : trade.state,
          chainTradeId,
          chainTxHash,
          escrowEnabled,
          escrowError,
        });
      } catch (err) {
        if (err instanceof Error && err.message === "REQUEST_RESERVATION_FAILED") {
          skipped.push({ offerId: match.offerId, requestId: match.requestId, reason: "REQUEST_RESERVATION_CONFLICT" });
          continue;
        }
        throw err;
      }
    }

    res.json({ createdTrades, skipped });
  }),
);

function offerJson(offer: {
  id: string;
  facilityId: string;
  claimId: string;
  intervalStart: Date;
  intervalEnd: Date;
  quantityKwh: number;
  reservedKwh: number;
  pricePerKwh: number;
  status: string;
}): Record<string, unknown> {
  return {
    id: offer.id,
    facilityId: offer.facilityId,
    claimId: offer.claimId,
    intervalStart: iso(offer.intervalStart),
    intervalEnd: iso(offer.intervalEnd),
    quantityKwh: offer.quantityKwh,
    reservedKwh: offer.reservedKwh,
    pricePerKwh: offer.pricePerKwh,
    status: offer.status,
    remainingKwh: round4(offer.quantityKwh - offer.reservedKwh),
  };
}

function requestJson(request: {
  id: string;
  buyerId: string;
  destinationFacilityId: string | null;
  intervalStart: Date;
  intervalEnd: Date;
  quantityKwh: number;
  allocatedKwh: number;
  maxPricePerKwh: number;
  status: string;
}): Record<string, unknown> {
  return {
    id: request.id,
    buyerId: request.buyerId,
    destinationFacilityId: request.destinationFacilityId,
    intervalStart: iso(request.intervalStart),
    intervalEnd: iso(request.intervalEnd),
    quantityKwh: request.quantityKwh,
    allocatedKwh: request.allocatedKwh,
    maxPricePerKwh: request.maxPricePerKwh,
    status: request.status,
    remainingKwh: round4(request.quantityKwh - request.allocatedKwh),
  };
}
