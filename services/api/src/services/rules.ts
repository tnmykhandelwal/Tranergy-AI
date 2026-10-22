import { computeEnergyBalance, type IntervalStreams } from "./energyBalance";

export type RuleSeverity = "hard" | "soft";
export type ClaimStatus = "PENDING" | "VERIFIED_FOR_PROTOTYPE" | "REVIEW_REQUIRED" | "REJECTED_BY_RULE";

export interface RuleResult {
  code: string;
  severity: RuleSeverity;
  message: string;
}

export interface RulesClaim {
  claimedKwh: number;
  intervalStart: Date;
  intervalEnd: Date;
  certificateExternalId: string | null;
}

export interface RulesReading {
  meterType: string;
  energyKwh: number;
  qualityStatus: string;
  ingestedAt: Date;
  intervalStart: Date;
  intervalEnd: Date;
  sourceStatus: string;
}

export interface RulesFacility {
  installedCapacityKw: number;
  exportLimitKw: number;
}

export interface RulesCertificateCheck {
  externalId: string;
  status: string;
  usable: boolean;
  quantityMwh: number | null;
  issues: string[];
  usedByClaimIds: string[];
}

export interface RulesMlResult {
  mlStatus: string;
  flagged: boolean;
  reasonCodes: string[];
  anomalyScore: number | null;
}

export interface RulesInput {
  claim: RulesClaim;
  coveringReadings: RulesReading[];
  facility: RulesFacility;
  certificate: RulesCertificateCheck | null;
  ml: RulesMlResult;
  balanceToleranceKwh: number;
}

export interface RulesOutput {
  ruleResults: RuleResult[];
  status: ClaimStatus;
}

const HOUR_MS = 3600_000;
const STALE_AFTER_MS = 48 * HOUR_MS;

export function evaluateClaimRules(input: RulesInput): RulesOutput {
  const results: RuleResult[] = [];
  const { claim, coveringReadings, facility, certificate, ml } = input;

  const hours = Math.max((claim.intervalEnd.getTime() - claim.intervalStart.getTime()) / HOUR_MS, 0);
  const generationReadings = coveringReadings.filter((r) => r.meterType === "generation");
  const meterGenerationKwh = generationReadings.reduce((acc, r) => acc + r.energyKwh, 0);

  if (generationReadings.length === 0) {
    results.push({
      code: "NO_GENERATION_READING",
      severity: "hard",
      message: "no generation meter reading covering the claim interval",
    });
  }

  if (coveringReadings.some((r) => r.qualityStatus === "invalid")) {
    results.push({
      code: "INVALID_READING_QUALITY",
      severity: "hard",
      message: "covering reading stored with qualityStatus invalid",
    });
  }

  const negative = coveringReadings.find(
    (r) => (r.meterType === "generation" || r.meterType === "load") && r.energyKwh < 0,
  );
  if (negative) {
    results.push({
      code: "NEGATIVE_ENERGY",
      severity: "hard",
      message: `negative stored energy on ${negative.meterType} meter (${negative.energyKwh} kWh)`,
    });
  }

  if (claim.certificateExternalId) {
    const issues = certificate?.issues ?? ["CERTIFICATE_NOT_FOUND"];
    if (issues.includes("CERTIFICATE_INVALID") || certificate?.status === "INVALID") {
      results.push({
        code: "CERTIFICATE_INVALID",
        severity: "hard",
        message: `certificate ${claim.certificateExternalId} registry status INVALID`,
      });
    }
    if (issues.includes("CERTIFICATE_NOT_FOUND") || !certificate || certificate.status === "UNKNOWN") {
      results.push({
        code: "CERTIFICATE_NOT_FOUND",
        severity: "soft",
        message: `no registry record for certificate ${claim.certificateExternalId}`,
      });
    }
    if (issues.includes("CERTIFICATE_TRANSFERRED") || certificate?.status === "TRANSFERRED") {
      results.push({
        code: "CERTIFICATE_TRANSFERRED",
        severity: "soft",
        message: `certificate ${claim.certificateExternalId} status TRANSFERRED`,
      });
    }
    if (issues.includes("CERTIFICATE_RETIRED") || certificate?.status === "RETIRED") {
      results.push({
        code: "CERTIFICATE_RETIRED",
        severity: "soft",
        message: `certificate ${claim.certificateExternalId} already retired`,
      });
    }
    if (issues.includes("CERTIFICATE_DUPLICATE_USE")) {
      results.push({
        code: "CERTIFICATE_DUPLICATE_USE",
        severity: "soft",
        message: `certificate ${claim.certificateExternalId} already attached to another non-rejected claim`,
      });
    }
    if (issues.includes("CERTIFICATE_QUANTITY_TOO_SMALL")) {
      results.push({
        code: "CERTIFICATE_QUANTITY_TOO_SMALL",
        severity: "soft",
        message: `certificate quantity ${certificate?.quantityMwh ?? 0} MWh smaller than claimed ${claim.claimedKwh} kWh`,
      });
    }
  }

  const capacityKwh = facility.installedCapacityKw * hours;
  if (capacityKwh > 0 && meterGenerationKwh > capacityKwh * 1.25) {
    results.push({
      code: "CAPACITY_EXCEEDED",
      severity: "hard",
      message: `generation ${meterGenerationKwh} kWh vs capacity ${facility.installedCapacityKw} kW (ratio ${(meterGenerationKwh / capacityKwh).toFixed(2)} > 1.25)`,
    });
  } else if (capacityKwh > 0 && meterGenerationKwh > capacityKwh * 1.05) {
    results.push({
      code: "CAPACITY_EXCEEDED",
      severity: "soft",
      message: `generation ${meterGenerationKwh} kWh vs capacity ${facility.installedCapacityKw} kW (ratio ${(meterGenerationKwh / capacityKwh).toFixed(2)} > 1.05)`,
    });
  }

  if (meterGenerationKwh > 0 && claim.claimedKwh > meterGenerationKwh * 1.02) {
    results.push({
      code: "CLAIM_EXCEEDS_METER",
      severity: "soft",
      message: `claimed ${claim.claimedKwh} > meter ${meterGenerationKwh} * 1.02`,
    });
  }

  if (coveringReadings.some((r) => r.sourceStatus !== "authorized")) {
    results.push({
      code: "METER_SOURCE_UNAUTHORIZED",
      severity: "soft",
      message: "covering meter sourceStatus is not authorized",
    });
  }

  if (coveringReadings.some((r) => r.ingestedAt.getTime() - r.intervalEnd.getTime() > STALE_AFTER_MS)) {
    results.push({
      code: "STALE_READING",
      severity: "soft",
      message: "covering reading ingested more than 48h after intervalEnd",
    });
  }

  const expectedSlots = Math.round(hours);
  const genSlots = new Set(generationReadings.map((r) => r.intervalStart.getTime()));
  const missing = Math.max(0, expectedSlots - genSlots.size);
  if (expectedSlots > 0 && missing > 0) {
    results.push({
      code: "MISSING_INTERVALS",
      severity: "soft",
      message: `gap in hourly generation series within claim window (${missing} missing interval${missing === 1 ? "" : "s"})`,
    });
  }

  const residualThresholds = groupByInterval(coveringReadings, claim).map(({ readings, streams }) => {
    const gen = streams.generationKwh ?? 0;
    const balance = computeEnergyBalance({
      streams,
      hours: 1,
      bufferKwh: 0,
      reservedKwh: 0,
      claimVerified: true,
      exportLimitKw: Number.POSITIVE_INFINITY,
    });
    return { readings, residual: balance.balanceResidualKwh, threshold: Math.max(1, 0.05 * gen) };
  });
  const residualBreach = residualThresholds.find((r) => r.residual > r.threshold);
  if (residualBreach) {
    results.push({
      code: "ENERGY_BALANCE_RESIDUAL",
      severity: "soft",
      message: `energy balance residual ${residualBreach.residual.toFixed(2)} kWh exceeds threshold ${residualBreach.threshold.toFixed(2)} kWh`,
    });
  }

  if (ml.flagged || ml.mlStatus === "ANOMALY_FLAGGED") {
    results.push({
      code: "ML_ANOMALY_FLAGGED",
      severity: "soft",
      message: `ML service flagged the interval (score ${ml.anomalyScore ?? "n/a"}${ml.reasonCodes.length ? `; reasons: ${ml.reasonCodes.join(", ")}` : ""})`,
    });
  }

  let status: ClaimStatus;
  if (results.some((r) => r.severity === "hard")) {
    status = "REJECTED_BY_RULE";
  } else if (results.length > 0 || ml.flagged) {
    status = "REVIEW_REQUIRED";
  } else {
    status = "VERIFIED_FOR_PROTOTYPE";
  }

  return { ruleResults: results, status };
}

function groupByInterval(
  readings: RulesReading[],
  claim: RulesClaim,
): Array<{ readings: RulesReading[]; streams: IntervalStreams }> {
  const byStart = new Map<number, RulesReading[]>();
  for (const r of readings) {
    if (
      r.intervalStart.getTime() >= claim.intervalStart.getTime() &&
      r.intervalEnd.getTime() <= claim.intervalEnd.getTime()
    ) {
      const key = r.intervalStart.getTime();
      const bucket = byStart.get(key);
      if (bucket) bucket.push(r);
      else byStart.set(key, [r]);
    }
  }
  return Array.from(byStart.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, bucket]) => ({
      readings: bucket,
      streams: {
        generationKwh: sumType(bucket, "generation"),
        loadKwh: sumType(bucket, "load"),
        importKwh: sumType(bucket, "grid_import"),
        exportKwh: sumType(bucket, "grid_export"),
        batteryChargeKwh: sumType(bucket, "battery_charge"),
        batteryDischargeKwh: sumType(bucket, "battery_discharge"),
      },
    }));
}

function sumType(readings: RulesReading[], meterType: string): number | null {
  const matches = readings.filter((r) => r.meterType === meterType);
  if (matches.length === 0) return null;
  return matches.reduce((acc, r) => acc + r.energyKwh, 0);
}
