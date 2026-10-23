import { describe, expect, it } from "vitest";
import {
  computeQuote,
  decimalToUnits,
  escrowDeadlines,
  kwhToMilli,
  priceToUnits,
  unitsToDecimal,
} from "../src/services/escrow";

describe("escrow amount math", () => {
  it("converts kWh to milli-kWh without float drift", () => {
    expect(kwhToMilli(20).toString()).toBe("20000");
    expect(kwhToMilli(0.1).toString()).toBe("100");
    expect(kwhToMilli(17.555).toString()).toBe("17555");
  });

  it("converts a 6-decimal price into base units", () => {
    expect(priceToUnits(0.12, 6).toString()).toBe("120000");
    expect(priceToUnits(1, 6).toString()).toBe("1000000");
    expect(priceToUnits(0.000001, 6).toString()).toBe("1");
  });

  it("computes a 20 kWh / 0.12 quote with 100% collateral", () => {
    const quote = computeQuote(20, 0.12, 6, 10_000);
    expect(quote.quantityKwhMilli.toString()).toBe("20000");
    expect(quote.pricePerKwhUnits.toString()).toBe("120000");
    expect(quote.tradeValue.toString()).toBe("2400000");
    expect(quote.consumerPayment.toString()).toBe("2400000");
    expect(quote.consumerCollateral.toString()).toBe("2400000");
    expect(quote.producerCollateral.toString()).toBe("2400000");
  });

  it("halves collateral at 5000 bps without changing the payment", () => {
    const quote = computeQuote(20, 0.12, 6, 5_000);
    expect(quote.consumerPayment.toString()).toBe("2400000");
    expect(quote.consumerCollateral.toString()).toBe("1200000");
    expect(quote.producerCollateral.toString()).toBe("1200000");
  });

  it("floors integer division and never creates units", () => {
    const quote = computeQuote(0.001, 0.000001, 6, 10_000);
    expect(quote.tradeValue.toString()).toBe("0");
  });

  it("round-trips base units to display decimals", () => {
    expect(unitsToDecimal("2400000", 6)).toBe(2.4);
    expect(unitsToDecimal(decimalToUnits(2.4, 6), 6)).toBe(2.4);
    expect(decimalToUnits(Number("12.345678"), 6)).toBe(12345678n);
  });
});

describe("escrow deadlines", () => {
  it("never schedules delivery before the offer interval ends", () => {
    const intervalEnd = new Date(Date.now() + 24 * 3600 * 1000);
    const { fundingDeadline, deliveryDeadline } = escrowDeadlines(intervalEnd);
    expect(fundingDeadline.getTime()).toBeGreaterThan(Date.now());
    expect(deliveryDeadline.getTime()).toBeGreaterThan(fundingDeadline.getTime());
    expect(deliveryDeadline.getTime()).toBeGreaterThanOrEqual(intervalEnd.getTime());
  });

  it("pushes delivery past funding when the interval already ended", () => {
    const intervalEnd = new Date(Date.now() - 24 * 3600 * 1000);
    const { fundingDeadline, deliveryDeadline } = escrowDeadlines(intervalEnd);
    expect(deliveryDeadline.getTime()).toBeGreaterThan(fundingDeadline.getTime());
  });
});
