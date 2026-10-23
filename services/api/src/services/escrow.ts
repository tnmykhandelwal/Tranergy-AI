import type { Prisma, Trade } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import * as chain from "./chain";

export const DEPOSIT_KINDS = {
  consumer_payment: 0,
  consumer_collateral: 1,
  producer_collateral: 2,
} as const;

export type DepositKind = keyof typeof DEPOSIT_KINDS;

export const ESCROW_OUTCOME_ENUM = {
  full_delivery: 1,
  partial_delivery: 2,
  producer_default: 3,
} as const;

export type EscrowOutcomeKey = keyof typeof ESCROW_OUTCOME_ENUM;

const OUTCOME_TO_DB: Record<number, string> = {
  1: "FULL_DELIVERY",
  2: "PARTIAL_DELIVERY",
  3: "PRODUCER_DEFAULT",
  4: "CANCELLED",
};

const CHAIN_STATE_TO_DB: Record<string, string> = {
  Matched: "MATCHED",
  DeliveryActive: "DELIVERY_ACTIVE",
  EvidenceSubmitted: "EVIDENCE_SUBMITTED",
  Settled: "SETTLED",
  Disputed: "DISPUTED",
  PartiallySettled: "PARTIALLY_SETTLED",
  Defaulted: "DEFAULTED",
  Cancelled: "CANCELLED",
};

const CHAIN_STATE_TO_ESCROW: Record<string, string> = {
  Matched: "AWAITING_FUNDING",
  DeliveryActive: "DELIVERY_ACTIVE",
  EvidenceSubmitted: "EVIDENCE_SUBMITTED",
  Settled: "SETTLED",
  Disputed: "DISPUTED",
  PartiallySettled: "PARTIALLY_SETTLED",
  Defaulted: "DEFAULTED",
  Cancelled: "CANCELLED",
};

/** Convert a human-readable decimal number into integer base units without float math. */
export function decimalToUnits(value: number, decimals: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new Error("invalid decimal value");
  const fixed = value.toFixed(decimals);
  const [whole, fraction = ""] = fixed.split(".");
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function unitsToDecimal(units: string | bigint | null | undefined, decimals: number): number {
  if (units === null || units === undefined) return 0;
  const value = typeof units === "bigint" ? units : BigInt(units);
  return Number(value) / 10 ** decimals;
}

export function kwhToMilli(kwh: number): bigint {
  return decimalToUnits(kwh, 3);
}

export function priceToUnits(pricePerKwh: number, decimals: number): bigint {
  return decimalToUnits(pricePerKwh, decimals);
}

export function computeQuote(
  agreedKwh: number,
  pricePerKwh: number,
  decimals: number,
  collateralRatioBps: number,
): {
  quantityKwhMilli: bigint;
  pricePerKwhUnits: bigint;
  tradeValue: bigint;
  consumerPayment: bigint;
  consumerCollateral: bigint;
  producerCollateral: bigint;
} {
  const quantityKwhMilli = kwhToMilli(agreedKwh);
  const pricePerKwhUnits = priceToUnits(pricePerKwh, decimals);
  const tradeValue = (quantityKwhMilli * pricePerKwhUnits) / 1000n;
  const consumerCollateral = (tradeValue * BigInt(collateralRatioBps)) / 10_000n;
  return {
    quantityKwhMilli,
    pricePerKwhUnits,
    tradeValue,
    consumerPayment: tradeValue,
    consumerCollateral,
    producerCollateral: consumerCollateral,
  };
}

export function escrowDeadlines(intervalEnd: Date): { fundingDeadline: Date; deliveryDeadline: Date } {
  const now = Date.now();
  const fundingDeadline = new Date(now + config.ESCROW_FUNDING_WINDOW_MINUTES * 60_000);
  const minimumDelivery = fundingDeadline.getTime() + config.ESCROW_DELIVERY_WINDOW_MINUTES * 60_000;
  const deliveryDeadline = new Date(Math.max(intervalEnd.getTime(), minimumDelivery));
  return { fundingDeadline, deliveryDeadline };
}

export async function isEscrowUsable(): Promise<boolean> {
  if (!config.ESCROW_ENABLED || !chain.isEscrowConfigured()) return false;
  return chain.isReadable();
}

export async function createEscrowForTrade(args: {
  trade: Trade;
  producerAddress: string;
  consumerAddress: string;
  intervalEnd: Date;
}): Promise<Trade | null> {
  if (!config.ESCROW_ENABLED) return null;
  if (!chain.isEscrowConfigured()) return null;
  if (!(await chain.isAvailable())) return null;

  const token = await chain.getSettlementTokenInfo();
  if (!token) return null;

  const { fundingDeadline, deliveryDeadline } = escrowDeadlines(args.intervalEnd);
  const quantityKwhMilli = kwhToMilli(args.trade.agreedKwh);
  const pricePerKwhUnits = priceToUnits(args.trade.pricePerKwh, token.decimals);
  if (quantityKwhMilli <= 0n || pricePerKwhUnits <= 0n) {
    throw new Error("trade quantity and price must be positive to enable escrow");
  }

  const onChain = await chain.createEscrowTradeOnChain(
    args.trade.id,
    args.producerAddress,
    args.consumerAddress,
    quantityKwhMilli,
    pricePerKwhUnits,
    Math.floor(fundingDeadline.getTime() / 1000),
    Math.floor(deliveryDeadline.getTime() / 1000),
  );

  const snapshot = onChain.snapshot;
  if (!snapshot.enabled) throw new Error("escrow was not enabled on-chain");

  return prisma.trade.update({
    where: { id: args.trade.id },
    data: {
      escrowEnabled: true,
      escrowRequired: true,
      escrowState: "AWAITING_FUNDING",
      settlementToken: token.address,
      settlementTokenSymbol: token.symbol,
      settlementTokenDecimals: token.decimals,
      pricePerKwhUnits: snapshot.pricePerKwhUnits,
      tradeValueUnits: snapshot.tradeValue,
      consumerPaymentUnits: snapshot.paymentRequired,
      consumerCollateralUnits: snapshot.consumerCollateralRequired,
      producerCollateralUnits: snapshot.producerCollateralRequired,
      consumerPaymentFundedUnits: snapshot.paymentFunded,
      consumerCollateralFundedUnits: snapshot.consumerCollateralFunded,
      producerCollateralFundedUnits: snapshot.producerCollateralFunded,
      collateralRatioBps: snapshot.collateralRatioBps,
      fundingDeadline: new Date(snapshot.fundingDeadline * 1000),
      deliveryDeadline: new Date(snapshot.deliveryDeadline * 1000),
      deliveryGracePeriodSeconds: snapshot.gracePeriod,
      escrowInitTxHash: onChain.txHash,
      chainTradeId: onChain.chainTradeId,
      chainTxHash: onChain.txHash,
    },
  });
}

function snapshotUpdateData(snapshot: chain.EscrowSnapshot): Prisma.TradeUpdateInput {
  const data: Prisma.TradeUpdateInput = {
    escrowState: CHAIN_STATE_TO_ESCROW[snapshot.state] ?? "AWAITING_FUNDING",
    state: CHAIN_STATE_TO_DB[snapshot.state] ?? "MATCHED",
    tradeValueUnits: snapshot.tradeValue,
    consumerPaymentUnits: snapshot.paymentRequired,
    consumerCollateralUnits: snapshot.consumerCollateralRequired,
    producerCollateralUnits: snapshot.producerCollateralRequired,
    consumerPaymentFundedUnits: snapshot.paymentFunded,
    consumerCollateralFundedUnits: snapshot.consumerCollateralFunded,
    producerCollateralFundedUnits: snapshot.producerCollateralFunded,
    collateralRatioBps: snapshot.collateralRatioBps,
    fundingDeadline: new Date(snapshot.fundingDeadline * 1000),
    deliveryDeadline: new Date(snapshot.deliveryDeadline * 1000),
    deliveryGracePeriodSeconds: snapshot.gracePeriod,
    verifiedDeliveredKwhMilli: snapshot.deliveredKwhMilli,
    verifiedDeliveredKwh: Number(snapshot.deliveredKwhMilli) / 1000,
  };
  if (snapshot.activatedAt > 0) data.fundedAt = new Date(snapshot.activatedAt * 1000);
  if (snapshot.outcome !== 0) {
    data.settlementOutcome = OUTCOME_TO_DB[snapshot.outcome] ?? null;
    data.paymentToProducerUnits = snapshot.paymentToProducer;
    data.paymentRefundedUnits = snapshot.paymentRefunded;
    data.producerCollateralReturnedUnits = snapshot.producerCollateralReturned;
    data.producerCollateralSlashedUnits = snapshot.producerCollateralSlashed;
    data.consumerCollateralReturnedUnits = snapshot.consumerCollateralReturned;
  }
  if (snapshot.settledAt > 0) data.resolvedAt = new Date(snapshot.settledAt * 1000);
  return data;
}

export async function applyEscrowSnapshot(
  tradeId: string,
  snapshot: chain.EscrowSnapshot,
  extra: Prisma.TradeUpdateInput = {},
): Promise<Trade> {
  return prisma.trade.update({
    where: { id: tradeId },
    data: { ...snapshotUpdateData(snapshot), ...extra },
  });
}

export async function syncEscrowTrade(tradeId: string): Promise<Trade | null> {
  const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
  if (!trade || !trade.escrowEnabled || trade.chainTradeId === null) return trade;
  if (!(await chain.isReadable())) return trade;
  const snapshot = await chain.getEscrowOnChain(trade.chainTradeId);
  if (!snapshot) return trade;
  return applyEscrowSnapshot(trade.id, snapshot);
}

export function escrowJson(trade: Trade): Record<string, unknown> | null {
  if (!trade.escrowEnabled) return null;
  const decimals = trade.settlementTokenDecimals ?? 6;
  const units = (value: string | null | undefined) => value ?? "0";
  const toHuman = (value: string | null | undefined) => unitsToDecimal(units(value), decimals);

  const paymentRequired = units(trade.consumerPaymentUnits);
  const consumerCollateralRequired = units(trade.consumerCollateralUnits);
  const producerCollateralRequired = units(trade.producerCollateralUnits);
  const paymentFunded = units(trade.consumerPaymentFundedUnits);
  const consumerCollateralFunded = units(trade.consumerCollateralFundedUnits);
  const producerCollateralFunded = units(trade.producerCollateralFundedUnits);

  const totalRequired =
    BigInt(paymentRequired) + BigInt(consumerCollateralRequired) + BigInt(producerCollateralRequired);
  const totalFunded =
    BigInt(paymentFunded) + BigInt(consumerCollateralFunded) + BigInt(producerCollateralFunded);

  return {
    enabled: true,
    required: trade.escrowRequired,
    escrowState: trade.escrowState,
    chainTradeId: trade.chainTradeId,
    settlementToken: {
      address: trade.settlementToken,
      symbol: trade.settlementTokenSymbol,
      decimals,
      testAsset: true,
      unit: "base units",
    },
    quantityKwh: trade.agreedKwh,
    pricePerKwh: trade.pricePerKwh,
    pricePerKwhUnits: trade.pricePerKwhUnits,
    tradeValueUnits: trade.tradeValueUnits,
    tradeValue: toHuman(trade.tradeValueUnits),
    collateralRatioBps: trade.collateralRatioBps,
    deposits: {
      consumerPayment: {
        requiredUnits: paymentRequired,
        fundedUnits: paymentFunded,
        outstandingUnits: (BigInt(paymentRequired) - BigInt(paymentFunded)).toString(),
        required: toHuman(paymentRequired),
        funded: toHuman(paymentFunded),
        outstanding: toHuman((BigInt(paymentRequired) - BigInt(paymentFunded)).toString()),
        confirmed: BigInt(paymentFunded) >= BigInt(paymentRequired) && BigInt(paymentRequired) > 0n,
        txHash: trade.consumerPaymentTxHash,
      },
      consumerCollateral: {
        requiredUnits: consumerCollateralRequired,
        fundedUnits: consumerCollateralFunded,
        outstandingUnits: (
          BigInt(consumerCollateralRequired) - BigInt(consumerCollateralFunded)
        ).toString(),
        required: toHuman(consumerCollateralRequired),
        funded: toHuman(consumerCollateralFunded),
        outstanding: toHuman(
          (BigInt(consumerCollateralRequired) - BigInt(consumerCollateralFunded)).toString(),
        ),
        confirmed:
          BigInt(consumerCollateralFunded) >= BigInt(consumerCollateralRequired) &&
          BigInt(consumerCollateralRequired) > 0n,
        txHash: trade.consumerCollateralTxHash,
      },
      producerCollateral: {
        requiredUnits: producerCollateralRequired,
        fundedUnits: producerCollateralFunded,
        outstandingUnits: (
          BigInt(producerCollateralRequired) - BigInt(producerCollateralFunded)
        ).toString(),
        required: toHuman(producerCollateralRequired),
        funded: toHuman(producerCollateralFunded),
        outstanding: toHuman(
          (BigInt(producerCollateralRequired) - BigInt(producerCollateralFunded)).toString(),
        ),
        confirmed:
          BigInt(producerCollateralFunded) >= BigInt(producerCollateralRequired) &&
          BigInt(producerCollateralRequired) > 0n,
        txHash: trade.producerCollateralTxHash,
      },
    },
    totals: {
      requiredUnits: totalRequired.toString(),
      fundedUnits: totalFunded.toString(),
      totalRequired: toHuman(totalRequired.toString()),
      totalFunded: toHuman(totalFunded.toString()),
      fundingPct:
        totalRequired === 0n ? 0 : Number((totalFunded * 10_000n) / totalRequired) / 100,
    },
    deadlines: {
      fundingDeadline: trade.fundingDeadline?.toISOString() ?? null,
      deliveryDeadline: trade.deliveryDeadline?.toISOString() ?? null,
      gracePeriodSeconds: trade.deliveryGracePeriodSeconds,
    },
    activation: {
      fundedAt: trade.fundedAt?.toISOString() ?? null,
      escrowInitTxHash: trade.escrowInitTxHash,
      fundingActivationTxHash: trade.fundingActivationTxHash,
    },
    verification: {
      evidenceHash: trade.evidenceHash,
      deliveredKwh: trade.verifiedDeliveredKwh,
      deliveredKwhMilli: trade.verifiedDeliveredKwhMilli,
    },
    settlement: {
      outcome: trade.settlementOutcome,
      paymentToProducerUnits: trade.paymentToProducerUnits,
      paymentRefundedUnits: trade.paymentRefundedUnits,
      producerCollateralReturnedUnits: trade.producerCollateralReturnedUnits,
      producerCollateralSlashedUnits: trade.producerCollateralSlashedUnits,
      consumerCollateralReturnedUnits: trade.consumerCollateralReturnedUnits,
      paymentToProducer: toHuman(trade.paymentToProducerUnits),
      paymentRefunded: toHuman(trade.paymentRefundedUnits),
      producerCollateralReturned: toHuman(trade.producerCollateralReturnedUnits),
      producerCollateralSlashed: toHuman(trade.producerCollateralSlashedUnits),
      consumerCollateralReturned: toHuman(trade.consumerCollateralReturnedUnits),
      finalSettlementTxHash: trade.finalSettlementTxHash ?? trade.settlementTxHash,
      resolvedAt: trade.resolvedAt?.toISOString() ?? null,
    },
    dispute: {
      raisedBy: trade.disputeRaisedBy,
      reason: trade.disputeReason,
      txHash: trade.disputeTxHash,
      resolutionOutcome: trade.disputeResolutionOutcome,
      resolutionReason: trade.disputeResolutionReason,
      resolutionEvidenceHash: trade.disputeResolutionEvidenceHash,
      resolutionTxHash: trade.disputeResolutionTxHash,
    },
  };
}
