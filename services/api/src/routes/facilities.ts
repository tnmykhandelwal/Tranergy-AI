import { Router } from "express";
import { prisma } from "../db";
import { config } from "../config";
import { asyncHandler, notFound } from "../errors";
import { computeEnergyBalance, ENERGY_ASSUMPTIONS } from "../services/energyBalance";

export const facilitiesRouter = Router();

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function parseDateParam(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

facilitiesRouter.get(
  "/facilities",
  asyncHandler(async (_req, res) => {
    const facilities = await prisma.facility.findMany({
      include: { meters: { orderBy: { id: "asc" } } },
      orderBy: { id: "asc" },
    });
    res.json({
      facilities: facilities.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        installedCapacityKw: f.installedCapacityKw,
        exportLimitKw: f.exportLimitKw,
        ownerId: f.ownerId,
        meters: f.meters.map((m) => ({
          id: m.id,
          meterType: m.meterType,
          unit: m.unit,
          sourceType: m.sourceType,
          sourceStatus: m.sourceStatus,
        })),
      })),
    });
  }),
);

facilitiesRouter.get(
  "/facilities/:id/energy",
  asyncHandler(async (req, res) => {
    const facilityId = req.params.id;
    const facility = await prisma.facility.findUnique({
      where: { id: facilityId },
      include: { meters: true },
    });
    if (!facility) throw notFound(`facility ${facilityId} not found`);

    const from = parseDateParam(req.query.from);
    const to = parseDateParam(req.query.to);

    const readings = await prisma.meterReading.findMany({
      where: {
        meter: { facilityId },
        ...(from ? { intervalEnd: { gt: from } } : {}),
        ...(to ? { intervalStart: { lt: to } } : {}),
      },
      include: { meter: true },
      orderBy: { intervalStart: "asc" },
    });

    const byInterval = new Map<number, Array<{ meterType: string; energyKwh: number }>>();
    const intervalBounds = new Map<number, { start: Date; end: Date }>();
    for (const r of readings) {
      const key = r.intervalStart.getTime();
      const bucket = byInterval.get(key);
      if (bucket) bucket.push({ meterType: r.meter.meterType, energyKwh: r.energyKwh });
      else byInterval.set(key, [{ meterType: r.meter.meterType, energyKwh: r.energyKwh }]);
      intervalBounds.set(key, { start: r.intervalStart, end: r.intervalEnd });
    }

    const claims = await prisma.generationClaim.findMany({ where: { facilityId } });
    const offers = await prisma.energyOffer.findMany({
      where: { facilityId, status: { in: ["OPEN", "PARTIALLY_RESERVED"] } },
    });

    const intervals = Array.from(byInterval.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([key, bucket]) => {
        const bounds = intervalBounds.get(key);
        if (!bounds) return null;
        const hours = (bounds.end.getTime() - bounds.start.getTime()) / 3600_000;
        const streams = {
          generationKwh: sumType(bucket, "generation"),
          loadKwh: sumType(bucket, "load"),
          importKwh: sumType(bucket, "grid_import"),
          exportKwh: sumType(bucket, "grid_export"),
          batteryChargeKwh: sumType(bucket, "battery_charge"),
          batteryDischargeKwh: sumType(bucket, "battery_discharge"),
        };

        const coveringClaims = claims.filter(
          (c) =>
            c.intervalStart.getTime() <= bounds.start.getTime() &&
            c.intervalEnd.getTime() >= bounds.end.getTime(),
        );
        const verifiedClaim = coveringClaims.find((c) => c.status === "VERIFIED_FOR_PROTOTYPE") ?? null;
        const latestClaim =
          coveringClaims.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
        const claimStatus = verifiedClaim ? verifiedClaim.status : latestClaim ? latestClaim.status : null;

        const intervalOffers = offers.filter(
          (o) =>
            o.intervalStart.getTime() === bounds.start.getTime() &&
            o.intervalEnd.getTime() === bounds.end.getTime(),
        );
        const reservedKwh = intervalOffers.reduce((acc, o) => acc + o.reservedKwh, 0);
        const hasOpenOffer = intervalOffers.length > 0;

        const balance = computeEnergyBalance({
          streams,
          hours,
          bufferKwh: config.ENERGY_BUFFER_KWH,
          reservedKwh,
          claimVerified: Boolean(verifiedClaim),
          exportLimitKw: facility.exportLimitKw,
        });

        return {
          intervalStart: bounds.start.toISOString(),
          intervalEnd: bounds.end.toISOString(),
          generationKwh: streams.generationKwh === null ? null : round4(streams.generationKwh),
          loadKwh: streams.loadKwh === null ? null : round4(streams.loadKwh),
          importKwh: streams.importKwh === null ? null : round4(streams.importKwh),
          exportKwh: streams.exportKwh === null ? null : round4(streams.exportKwh),
          batteryChargeKwh: streams.batteryChargeKwh === null ? null : round4(streams.batteryChargeKwh),
          batteryDischargeKwh: streams.batteryDischargeKwh === null ? null : round4(streams.batteryDischargeKwh),
          balanceResidualKwh: round4(balance.balanceResidualKwh),
          estimatedSurplusKwh: round4(balance.estimatedSurplusKwh),
          offerableKwh: round4(balance.offerableKwh),
          reservedKwh: round4(reservedKwh),
          bufferKwh: config.ENERGY_BUFFER_KWH,
          claimStatus,
          hasOpenOffer,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const dataFrom = from ? from.toISOString() : (intervals[0]?.intervalStart ?? null);
    const dataTo = to ? to.toISOString() : (intervals[intervals.length - 1]?.intervalEnd ?? null);

    res.json({
      facilityId,
      from: dataFrom,
      to: dataTo,
      assumptions: ENERGY_ASSUMPTIONS,
      intervals,
    });
  }),
);

function sumType(bucket: Array<{ meterType: string; energyKwh: number }>, meterType: string): number | null {
  const matches = bucket.filter((b) => b.meterType === meterType);
  if (matches.length === 0) return null;
  return matches.reduce((acc, b) => acc + b.energyKwh, 0);
}
