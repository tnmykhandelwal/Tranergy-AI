import { describe, expect, it } from "vitest";
import {
  evaluateClaimRules,
  type RulesCertificateCheck,
  type RulesInput,
  type RulesMlResult,
  type RulesReading,
} from "../src/services/rules";

const HOUR = 3600_000;
const intervalStart = new Date("2026-10-17T11:00:00Z");
const intervalEnd = new Date("2026-10-17T12:00:00Z");

function reading(overrides: Partial<RulesReading> = {}): RulesReading {
  return {
    meterType: "generation",
    energyKwh: 100,
    qualityStatus: "ok",
    ingestedAt: new Date(intervalEnd.getTime() + 60_000),
    intervalStart,
    intervalEnd,
    sourceStatus: "authorized",
    ...overrides,
  };
}

const mlClean: RulesMlResult = { mlStatus: "OK", flagged: false, reasonCodes: [], anomalyScore: 0.1 };

function baseInput(overrides: Partial<RulesInput> = {}): RulesInput {
  return {
    claim: {
      claimedKwh: 100,
      intervalStart,
      intervalEnd,
      certificateExternalId: null,
    },
    coveringReadings: [
      reading(),
      reading({ meterType: "load", energyKwh: 50 }),
      reading({ meterType: "grid_export", energyKwh: 50 }),
    ],
    facility: { installedCapacityKw: 150, exportLimitKw: 120 },
    certificate: null,
    ml: mlClean,
    balanceToleranceKwh: 5,
    ...overrides,
  };
}

function codes(input: RulesInput): string[] {
  return evaluateClaimRules(input).ruleResults.map((r) => r.code);
}

describe("evaluateClaimRules", () => {
  it("returns VERIFIED_FOR_PROTOTYPE with no rule triggers", () => {
    const out = evaluateClaimRules(baseInput());
    expect(out.status).toBe("VERIFIED_FOR_PROTOTYPE");
    expect(out.ruleResults).toHaveLength(0);
  });

  it("NO_GENERATION_READING (hard) when no generation reading covers the interval", () => {
    const out = evaluateClaimRules(
      baseInput({ coveringReadings: [reading({ meterType: "load" })] }),
    );
    expect(out.ruleResults).toContainEqual(
      expect.objectContaining({ code: "NO_GENERATION_READING", severity: "hard" }),
    );
    expect(out.status).toBe("REJECTED_BY_RULE");
  });

  it("INVALID_READING_QUALITY (hard) when any covering reading is invalid", () => {
    expect(codes(baseInput({ coveringReadings: [reading({ qualityStatus: "invalid" })] }))).toContain(
      "INVALID_READING_QUALITY",
    );
  });

  it("NEGATIVE_ENERGY (hard) for negative generation or load", () => {
    expect(codes(baseInput({ coveringReadings: [reading({ energyKwh: -5 })] }))).toContain(
      "NEGATIVE_ENERGY",
    );
  });

  it("CERTIFICATE_INVALID (hard) for registry status INVALID", () => {
    const certificate: RulesCertificateCheck = {
      externalId: "CERT-INVALID-0001",
      status: "INVALID",
      usable: false,
      quantityMwh: 1,
      issues: ["CERTIFICATE_INVALID"],
      usedByClaimIds: [],
    };
    const out = evaluateClaimRules(
      baseInput({
        claim: { ...baseInput().claim, certificateExternalId: "CERT-INVALID-0001" },
        certificate,
      }),
    );
    expect(out.ruleResults).toContainEqual(
      expect.objectContaining({ code: "CERTIFICATE_INVALID", severity: "hard" }),
    );
    expect(out.status).toBe("REJECTED_BY_RULE");
  });

  it.each([
    ["CERTIFICATE_NOT_FOUND", { status: "UNKNOWN", issues: ["CERTIFICATE_NOT_FOUND"] }],
    ["CERTIFICATE_TRANSFERRED", { status: "TRANSFERRED", issues: ["CERTIFICATE_TRANSFERRED"] }],
    ["CERTIFICATE_RETIRED", { status: "RETIRED", issues: ["CERTIFICATE_RETIRED"] }],
    ["CERTIFICATE_DUPLICATE_USE", { status: "ACTIVE", issues: ["CERTIFICATE_DUPLICATE_USE"] }],
    ["CERTIFICATE_QUANTITY_TOO_SMALL", { status: "ACTIVE", issues: ["CERTIFICATE_QUANTITY_TOO_SMALL"] }],
  ])("%s (soft) triggers review", (code, cert) => {
    const certificate: RulesCertificateCheck = {
      externalId: "CERT-X",
      usable: false,
      quantityMwh: 0.05,
      usedByClaimIds: ["clm-other"],
      ...cert,
    } as RulesCertificateCheck;
    const out = evaluateClaimRules(
      baseInput({
        claim: { ...baseInput().claim, claimedKwh: 100, certificateExternalId: "CERT-X" },
        certificate,
      }),
    );
    expect(out.ruleResults).toContainEqual(expect.objectContaining({ code, severity: "soft" }));
    expect(out.status).toBe("REVIEW_REQUIRED");
  });

  it("CAPACITY_EXCEEDED soft above 1.05x and hard above 1.25x capacity", () => {
    const soft = evaluateClaimRules(
      baseInput({ coveringReadings: [reading({ energyKwh: 165 })] }),
    );
    expect(soft.ruleResults).toContainEqual(
      expect.objectContaining({ code: "CAPACITY_EXCEEDED", severity: "soft" }),
    );
    expect(soft.status).toBe("REVIEW_REQUIRED");

    const hard = evaluateClaimRules(
      baseInput({ coveringReadings: [reading({ energyKwh: 300 })] }),
    );
    expect(hard.ruleResults).toContainEqual(
      expect.objectContaining({ code: "CAPACITY_EXCEEDED", severity: "hard" }),
    );
    expect(hard.status).toBe("REJECTED_BY_RULE");
  });

  it("CLAIM_EXCEEDS_METER (soft) when claimed > meterGen * 1.02", () => {
    const out = evaluateClaimRules(
      baseInput({
        claim: { ...baseInput().claim, claimedKwh: 120 },
        coveringReadings: [reading({ energyKwh: 100 })],
      }),
    );
    expect(out.ruleResults).toContainEqual(
      expect.objectContaining({ code: "CLAIM_EXCEEDS_METER", severity: "soft" }),
    );
    expect(out.status).toBe("REVIEW_REQUIRED");
  });

  it("METER_SOURCE_UNAUTHORIZED (soft) when sourceStatus is not authorized", () => {
    expect(
      codes(baseInput({ coveringReadings: [reading({ sourceStatus: "unverified" })] })),
    ).toContain("METER_SOURCE_UNAUTHORIZED");
  });

  it("STALE_READING (soft) when ingested more than 48h after intervalEnd", () => {
    expect(
      codes(
        baseInput({
          coveringReadings: [reading({ ingestedAt: new Date(intervalEnd.getTime() + 49 * HOUR) })],
        }),
      ),
    ).toContain("STALE_READING");
  });

  it("MISSING_INTERVALS (soft) on a gap in the hourly generation series", () => {
    const twoHourClaim = {
      ...baseInput().claim,
      intervalStart,
      intervalEnd: new Date(intervalStart.getTime() + 2 * HOUR),
    };
    const out = evaluateClaimRules(baseInput({ claim: twoHourClaim }));
    expect(out.ruleResults).toContainEqual(
      expect.objectContaining({ code: "MISSING_INTERVALS", severity: "soft" }),
    );
    expect(out.status).toBe("REVIEW_REQUIRED");
  });

  it("ENERGY_BALANCE_RESIDUAL (soft) when residual exceeds max(1, 5% of generation)", () => {
    const out = evaluateClaimRules(
      baseInput({
        coveringReadings: [
          reading(),
          reading({ meterType: "load", energyKwh: 50 }),
          reading({ meterType: "grid_export", energyKwh: 0 }),
        ],
      }),
    );
    expect(out.ruleResults).toContainEqual(
      expect.objectContaining({ code: "ENERGY_BALANCE_RESIDUAL", severity: "soft" }),
    );
  });

  it("ML_ANOMALY_FLAGGED (soft) when ML flags the interval", () => {
    const out = evaluateClaimRules(
      baseInput({
        ml: {
          mlStatus: "ANOMALY_FLAGGED",
          flagged: true,
          reasonCodes: ["GEN_SPIKE_VS_ROLLING"],
          anomalyScore: 0.9,
        },
      }),
    );
    expect(out.ruleResults).toContainEqual(
      expect.objectContaining({ code: "ML_ANOMALY_FLAGGED", severity: "soft" }),
    );
    expect(out.status).toBe("REVIEW_REQUIRED");
  });

  it("hard rules dominate status logic", () => {
    const out = evaluateClaimRules(
      baseInput({
        claim: { ...baseInput().claim, claimedKwh: 500 },
        coveringReadings: [reading({ energyKwh: 300, qualityStatus: "invalid" })],
        ml: { mlStatus: "ANOMALY_FLAGGED", flagged: true, reasonCodes: ["GEN_ABOVE_CAPACITY"], anomalyScore: 0.8 },
      }),
    );
    expect(out.status).toBe("REJECTED_BY_RULE");
    expect(out.ruleResults.filter((r) => r.severity === "hard").length).toBeGreaterThanOrEqual(2);
  });
});
