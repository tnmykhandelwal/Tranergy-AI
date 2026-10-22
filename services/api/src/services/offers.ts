import { prisma } from "../db";
import { config } from "../config";
import { aggregateStreams, computeEnergyBalance } from "./energyBalance";

export interface OfferEligibility {
  claimId: string;
  facilityId: string;
  intervalStart: Date;
  intervalEnd: Date;
  claimStatus: string;
  offerableKwh: number;
  eligible: boolean;
  reason: string | null;
}

export async function computeClaimOfferable(claimId: string): Promise<OfferEligibility> {
  const claim = await prisma.generationClaim.findUnique({
    where: { id: claimId },
    include: { facility: true },
  });
  if (!claim) {
    return {
      claimId,
      facilityId: "",
      intervalStart: new Date(0),
      intervalEnd: new Date(0),
      claimStatus: "NOT_FOUND",
      offerableKwh: 0,
      eligible: false,
      reason: "claim not found",
    };
  }

  const readings = await prisma.meterReading.findMany({
    where: {
      meter: { facilityId: claim.facilityId },
      intervalStart: { gte: claim.intervalStart },
      intervalEnd: { lte: claim.intervalEnd },
    },
    include: { meter: true },
  });

  const streams = aggregateStreams(
    readings.map((r) => ({ meterType: r.meter.meterType, energyKwh: r.energyKwh })),
  );

  const reservedAgg = await prisma.energyOffer.aggregate({
    _sum: { reservedKwh: true },
    where: {
      facilityId: claim.facilityId,
      intervalStart: claim.intervalStart,
      intervalEnd: claim.intervalEnd,
      status: { in: ["OPEN", "PARTIALLY_RESERVED"] },
    },
  });
  const reservedKwh = reservedAgg._sum.reservedKwh ?? 0;

  const hours = (claim.intervalEnd.getTime() - claim.intervalStart.getTime()) / 3600_000;
  const claimVerified = claim.status === "VERIFIED_FOR_PROTOTYPE";
  const balance = computeEnergyBalance({
    streams,
    hours,
    bufferKwh: config.ENERGY_BUFFER_KWH,
    reservedKwh,
    claimVerified,
    exportLimitKw: claim.facility.exportLimitKw,
  });

  let eligible = true;
  let reason: string | null = null;
  if (!claimVerified) {
    eligible = false;
    reason = "claim is not VERIFIED_FOR_PROTOTYPE";
  } else if (balance.offerableKwh <= 0) {
    eligible = false;
    reason = "no offerable surplus for claim interval";
  }

  return {
    claimId: claim.id,
    facilityId: claim.facilityId,
    intervalStart: claim.intervalStart,
    intervalEnd: claim.intervalEnd,
    claimStatus: claim.status,
    offerableKwh: balance.offerableKwh,
    eligible,
    reason,
  };
}
