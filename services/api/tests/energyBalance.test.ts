import { describe, expect, it } from "vitest";
import { computeEnergyBalance, ENERGY_ASSUMPTIONS } from "../src/services/energyBalance";

const specExampleStreams = {
  generationKwh: 100,
  loadKwh: 55,
  importKwh: 0,
  exportKwh: 30,
  batteryChargeKwh: 15,
  batteryDischargeKwh: 0,
};

describe("computeEnergyBalance (spec §8 formulas)", () => {
  it("matches the spec worked example: 30 surplus, 24 offerable", () => {
    const result = computeEnergyBalance({
      streams: specExampleStreams,
      hours: 1,
      bufferKwh: 2,
      reservedKwh: 4,
      claimVerified: true,
      exportLimitKw: 120,
    });
    expect(result.estimatedSurplusKwh).toBe(30);
    expect(result.offerableKwh).toBe(24);
    expect(result.assumptions).toEqual(ENERGY_ASSUMPTIONS);
  });

  it("uses max(0, gen - load) when storage is not present", () => {
    const result = computeEnergyBalance({
      streams: {
        generationKwh: 100,
        loadKwh: 55,
        importKwh: null,
        exportKwh: null,
        batteryChargeKwh: null,
        batteryDischargeKwh: null,
      },
      hours: 1,
      bufferKwh: 2,
      reservedKwh: 0,
      claimVerified: true,
      exportLimitKw: 120,
    });
    expect(result.estimatedSurplusKwh).toBe(45);
    expect(result.offerableKwh).toBe(43);
  });

  it("never offers below zero and treats missing streams as 0", () => {
    const result = computeEnergyBalance({
      streams: {
        generationKwh: 5,
        loadKwh: 50,
        importKwh: null,
        exportKwh: null,
        batteryChargeKwh: null,
        batteryDischargeKwh: null,
      },
      hours: 1,
      bufferKwh: 2,
      reservedKwh: 1,
      claimVerified: true,
      exportLimitKw: 100,
    });
    expect(result.estimatedSurplusKwh).toBe(0);
    expect(result.offerableKwh).toBe(0);
    expect(result.balanceResidualKwh).toBe(45);
  });

  it("forces offerable to 0 unless a covering claim is VERIFIED_FOR_PROTOTYPE", () => {
    const result = computeEnergyBalance({
      streams: specExampleStreams,
      hours: 1,
      bufferKwh: 2,
      reservedKwh: 0,
      claimVerified: false,
      exportLimitKw: 120,
    });
    expect(result.estimatedSurplusKwh).toBe(30);
    expect(result.offerableKwh).toBe(0);
  });

  it("caps offerable at exportLimitKw * hours", () => {
    const result = computeEnergyBalance({
      streams: {
        generationKwh: 100,
        loadKwh: 0,
        importKwh: null,
        exportKwh: null,
        batteryChargeKwh: null,
        batteryDischargeKwh: null,
      },
      hours: 1,
      bufferKwh: 0,
      reservedKwh: 0,
      claimVerified: true,
      exportLimitKw: 60,
    });
    expect(result.offerableKwh).toBe(60);
  });

  it("computes balanceResidual = |gen + import + discharge - load - export - charge|", () => {
    const result = computeEnergyBalance({
      streams: {
        generationKwh: 100,
        loadKwh: 55,
        importKwh: 3,
        exportKwh: 30,
        batteryChargeKwh: 10,
        batteryDischargeKwh: 2,
      },
      hours: 1,
      bufferKwh: 2,
      reservedKwh: 0,
      claimVerified: true,
      exportLimitKw: 120,
    });
    expect(result.balanceResidualKwh).toBe(10);
  });
});
