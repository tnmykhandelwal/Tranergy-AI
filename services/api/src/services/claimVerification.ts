import type { GenerationClaim, VerificationCase } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { notFound } from "../errors";
import { checkCertificate, type CertificateCheckResult } from "./certificateRegistry";
import { computeEnergyBalance, type IntervalStreams } from "./energyBalance";
import { scoreMl, type MlScorePayload, type MlScoreResult, type MlTargetPayload } from "./mlClient";
import { evaluateClaimRules, type RuleResult } from "./rules";

const HOUR_MS = 3600_000;

export interface ClaimVerificationOutcome {
  claim: GenerationClaim;
  verificationCase: VerificationCase;
  ruleResults: RuleResult[];
  anomalyFlags: string[];
}

interface CoveringReadingRow {
  meterType: string;
  energyKwh: number;
  qualityStatus: string;
  ingestedAt: Date;
  intervalStart: Date;
  intervalEnd: Date;
  sourceStatus: string;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function streamsToTarget(
  streams: IntervalStreams,
  intervalStart: Date,
  intervalEnd: Date,
): MlTargetPayload {
  const balance = computeEnergyBalance({
    streams,
    hours: (intervalEnd.getTime() - intervalStart.getTime()) / HOUR_MS,
    bufferKwh: 0,
    reservedKwh: 0,
    claimVerified: true,
    exportLimitKw: Number.POSITIVE_INFINITY,
  });
  return {
    intervalStart: intervalStart.toISOString(),
    intervalEnd: intervalEnd.toISOString(),
    generationKwh: round4(streams.generationKwh ?? 0),
    consumptionKwh: round4(streams.loadKwh ?? 0),
    importKwh: round4(streams.importKwh ?? 0),
    exportKwh: round4(streams.exportKwh ?? 0),
    batteryChargeKwh: round4(streams.batteryChargeKwh ?? 0),
    batteryDischargeKwh: round4(streams.batteryDischargeKwh ?? 0),
    balanceResidualKwh: round4(balance.balanceResidualKwh),
  };
}

function bucketStreams(readings: CoveringReadingRow[], start: Date, end: Date): IntervalStreams {
  const inWindow = readings.filter(
    (r) => r.intervalStart.getTime() >= start.getTime() && r.intervalEnd.getTime() <= end.getTime(),
  );
  const sum = (type: string): number | null => {
    const matches = inWindow.filter((r) => r.meterType === type);
    if (matches.length === 0) return null;
    return matches.reduce((acc, r) => acc + r.energyKwh, 0);
  };
  return {
    generationKwh: sum("generation"),
    loadKwh: sum("load"),
    importKwh: sum("grid_import"),
    exportKwh: sum("grid_export"),
    batteryChargeKwh: sum("battery_charge"),
    batteryDischargeKwh: sum("battery_discharge"),
  };
}

export async function buildMlPayload(
  claim: { id: string; facilityId: string; intervalStart: Date; intervalEnd: Date },
  facilityCapacityKw: number,
  readings: CoveringReadingRow[],
): Promise<{ payload: MlScorePayload; missingIntervals: number }> {
  const targetStreams = bucketStreams(readings, claim.intervalStart, claim.intervalEnd);
  const target = streamsToTarget(targetStreams, claim.intervalStart, claim.intervalEnd);

  const history: MlTargetPayload[] = [];
  const historyStart = new Date(claim.intervalStart.getTime() - 24 * HOUR_MS);
  for (let t = historyStart.getTime(); t < claim.intervalStart.getTime(); t += HOUR_MS) {
    const slotStart = new Date(t);
    const slotEnd = new Date(t + HOUR_MS);
    const slotReadings = readings.filter(
      (r) => r.intervalStart.getTime() === t || (r.intervalStart.getTime() < t && r.intervalEnd.getTime() > t),
    );
    if (slotReadings.length === 0) continue;
    history.push(streamsToTarget(bucketStreams(slotReadings, slotStart, slotEnd), slotStart, slotEnd));
  }

  const expectedSlots = Math.max(1, Math.round((claim.intervalEnd.getTime() - claim.intervalStart.getTime()) / HOUR_MS));
  const presentSlots = new Set(
    readings
      .filter(
        (r) =>
          r.intervalStart.getTime() >= claim.intervalStart.getTime() &&
          r.intervalEnd.getTime() <= claim.intervalEnd.getTime(),
      )
      .map((r) => r.intervalStart.getTime()),
  );
  const missingIntervals = Math.max(0, expectedSlots - presentSlots.size);

  return {
    payload: {
      facilityId: claim.facilityId,
      capacityKw: facilityCapacityKw,
      target,
      history,
      missingIntervals,
    },
    missingIntervals,
  };
}

export async function verifyClaimById(claimId: string): Promise<ClaimVerificationOutcome> {
  const claim = await prisma.generationClaim.findUnique({
    where: { id: claimId },
    include: { facility: true },
  });
  if (!claim) throw notFound(`claim ${claimId} not found`);

  const historyStart = new Date(claim.intervalStart.getTime() - 26 * HOUR_MS);
  const readings = await prisma.meterReading.findMany({
    where: {
      meter: { facilityId: claim.facilityId },
      intervalStart: { lt: claim.intervalEnd },
      intervalEnd: { gt: historyStart },
    },
    include: { meter: true },
  });

  const coveringReadings: CoveringReadingRow[] = readings
    .filter(
      (r) =>
        r.intervalStart.getTime() >= claim.intervalStart.getTime() &&
        r.intervalEnd.getTime() <= claim.intervalEnd.getTime(),
    )
    .map((r) => ({
      meterType: r.meter.meterType,
      energyKwh: r.energyKwh,
      qualityStatus: r.qualityStatus,
      ingestedAt: r.ingestedAt,
      intervalStart: r.intervalStart,
      intervalEnd: r.intervalEnd,
      sourceStatus: r.meter.sourceStatus,
    }));

  const { payload } = await buildMlPayload(claim, claim.facility.installedCapacityKw, readings.map((r) => ({
    meterType: r.meter.meterType,
    energyKwh: r.energyKwh,
    qualityStatus: r.qualityStatus,
    ingestedAt: r.ingestedAt,
    intervalStart: r.intervalStart,
    intervalEnd: r.intervalEnd,
    sourceStatus: r.meter.sourceStatus,
  })));

  const ml: MlScoreResult = await scoreMl(payload);

  let certificate: CertificateCheckResult | null = null;
  if (claim.certificateExternalId) {
    certificate = await checkCertificate(claim.certificateExternalId, claim.claimedKwh, claim.id);
  }

  const { ruleResults, status } = evaluateClaimRules({
    claim: {
      claimedKwh: claim.claimedKwh,
      intervalStart: claim.intervalStart,
      intervalEnd: claim.intervalEnd,
      certificateExternalId: claim.certificateExternalId,
    },
    coveringReadings,
    facility: {
      installedCapacityKw: claim.facility.installedCapacityKw,
      exportLimitKw: claim.facility.exportLimitKw,
    },
    certificate,
    ml: { mlStatus: ml.mlStatus, flagged: ml.flagged, reasonCodes: ml.reasonCodes, anomalyScore: ml.anomalyScore },
    balanceToleranceKwh: config.BALANCE_TOLERANCE_KWH,
  });

  const updatedClaim = await prisma.generationClaim.update({
    where: { id: claim.id },
    data: { status },
  });

  const anomalyFlags = ml.flagged ? ml.reasonCodes : ml.mlStatus === "UNAVAILABLE" ? [] : ml.reasonCodes;

  const verificationCase = await prisma.verificationCase.upsert({
    where: { claimId: claim.id },
    create: {
      id: `vc-${claim.id}`,
      claimId: claim.id,
      ruleResults: JSON.stringify(ruleResults),
      anomalyScore: ml.anomalyScore,
      anomalyFlags: JSON.stringify(anomalyFlags),
      modelVersion: ml.modelVersion,
      mlStatus: ml.mlStatus,
      reviewStatus: "OPEN",
    },
    update: {
      ruleResults: JSON.stringify(ruleResults),
      anomalyScore: ml.anomalyScore,
      anomalyFlags: JSON.stringify(anomalyFlags),
      modelVersion: ml.modelVersion,
      mlStatus: ml.mlStatus,
      reviewStatus: "OPEN",
      reviewerId: null,
      decidedAt: null,
      decisionNote: null,
    },
  });

  return { claim: updatedClaim, verificationCase, ruleResults, anomalyFlags };
}

export function parseRuleResults(raw: string): RuleResult[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RuleResult[]) : [];
  } catch {
    return [];
  }
}

export function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
