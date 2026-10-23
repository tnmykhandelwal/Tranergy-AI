-- Tranergy AI schema for Supabase.
-- Generated from services/api/prisma/schema.prisma.
-- Use this in the Supabase SQL Editor only when the public schema is EMPTY.
-- If the tables already exist, run `npm run db:push` instead.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "walletAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "installedCapacityKw" DOUBLE PRECISION NOT NULL,
    "exportLimitKw" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meter" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "meterType" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kWh',
    "sourceType" TEXT NOT NULL DEFAULT 'simulated',
    "sourceStatus" TEXT NOT NULL DEFAULT 'authorized',

    CONSTRAINT "Meter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "intervalStart" TIMESTAMP(3) NOT NULL,
    "intervalEnd" TIMESTAMP(3) NOT NULL,
    "energyKwh" DOUBLE PRECISION NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceReference" TEXT,
    "qualityStatus" TEXT NOT NULL DEFAULT 'ok',

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateRecord" (
    "id" TEXT NOT NULL,
    "registry" TEXT NOT NULL DEFAULT 'MOCK',
    "externalId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "quantityMwh" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "ownerReference" TEXT,
    "metadataHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificateRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationClaim" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "intervalStart" TIMESTAMP(3) NOT NULL,
    "intervalEnd" TIMESTAMP(3) NOT NULL,
    "claimedKwh" DOUBLE PRECISION NOT NULL,
    "certificateExternalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "GenerationClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCase" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "ruleResults" TEXT NOT NULL,
    "anomalyScore" DOUBLE PRECISION,
    "anomalyFlags" TEXT,
    "modelVersion" TEXT,
    "mlStatus" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'OPEN',
    "reviewerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnergyOffer" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "intervalStart" TIMESTAMP(3) NOT NULL,
    "intervalEnd" TIMESTAMP(3) NOT NULL,
    "quantityKwh" DOUBLE PRECISION NOT NULL,
    "reservedKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pricePerKwh" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "EnergyOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnergyRequest" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "destinationFacilityId" TEXT,
    "intervalStart" TIMESTAMP(3) NOT NULL,
    "intervalEnd" TIMESTAMP(3) NOT NULL,
    "quantityKwh" DOUBLE PRECISION NOT NULL,
    "allocatedKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxPricePerKwh" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnergyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "agreedKwh" DOUBLE PRECISION NOT NULL,
    "pricePerKwh" DOUBLE PRECISION NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'MATCHED',
    "deliveryEvidence" TEXT,
    "evidenceHash" TEXT,
    "discrepancyPct" DOUBLE PRECISION,
    "chainTradeId" INTEGER,
    "chainTxHash" TEXT,
    "settlementTxHash" TEXT,

    -- Mutual-stake escrow (token amounts are integer base-unit strings)
    "escrowEnabled" BOOLEAN NOT NULL DEFAULT false,
    "escrowRequired" BOOLEAN NOT NULL DEFAULT false,
    "escrowState" TEXT NOT NULL DEFAULT 'NONE',
    "settlementToken" TEXT,
    "settlementTokenSymbol" TEXT,
    "settlementTokenDecimals" INTEGER,
    "pricePerKwhUnits" TEXT,
    "tradeValueUnits" TEXT,
    "consumerPaymentUnits" TEXT,
    "consumerCollateralUnits" TEXT,
    "producerCollateralUnits" TEXT,
    "consumerPaymentFundedUnits" TEXT NOT NULL DEFAULT '0',
    "consumerCollateralFundedUnits" TEXT NOT NULL DEFAULT '0',
    "producerCollateralFundedUnits" TEXT NOT NULL DEFAULT '0',
    "collateralRatioBps" INTEGER,
    "fundingDeadline" TIMESTAMP(3),
    "deliveryDeadline" TIMESTAMP(3),
    "deliveryGracePeriodSeconds" INTEGER,
    "escrowInitTxHash" TEXT,
    "consumerPaymentTxHash" TEXT,
    "consumerCollateralTxHash" TEXT,
    "producerCollateralTxHash" TEXT,
    "fundingActivationTxHash" TEXT,
    "fundedAt" TIMESTAMP(3),
    "verifiedDeliveredKwh" DOUBLE PRECISION,
    "verifiedDeliveredKwhMilli" TEXT,
    "paymentToProducerUnits" TEXT,
    "paymentRefundedUnits" TEXT,
    "producerCollateralReturnedUnits" TEXT,
    "producerCollateralSlashedUnits" TEXT,
    "consumerCollateralReturnedUnits" TEXT,
    "settlementOutcome" TEXT,
    "finalSettlementTxHash" TEXT,
    "disputeRaisedBy" TEXT,
    "disputeReason" TEXT,
    "disputeTxHash" TEXT,
    "disputeResolutionOutcome" TEXT,
    "disputeResolutionReason" TEXT,
    "disputeResolutionEvidenceHash" TEXT,
    "disputeResolutionTxHash" TEXT,
    "resolvedAt" TIMESTAMP(3),

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceBundle" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "recordReferences" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "attestationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "attestedBy" TEXT,
    "attestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardEvent" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "chainTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_meterId_intervalStart_intervalEnd_key" ON "MeterReading"("meterId", "intervalStart", "intervalEnd");

-- CreateIndex
CREATE UNIQUE INDEX "CertificateRecord_externalId_key" ON "CertificateRecord"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationCase_claimId_key" ON "VerificationCase"("claimId");

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meter" ADD CONSTRAINT "Meter_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "Meter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationClaim" ADD CONSTRAINT "GenerationClaim_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationClaim" ADD CONSTRAINT "GenerationClaim_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCase" ADD CONSTRAINT "VerificationCase_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "GenerationClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCase" ADD CONSTRAINT "VerificationCase_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnergyOffer" ADD CONSTRAINT "EnergyOffer_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnergyOffer" ADD CONSTRAINT "EnergyOffer_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "GenerationClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnergyOffer" ADD CONSTRAINT "EnergyOffer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnergyRequest" ADD CONSTRAINT "EnergyRequest_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "EnergyOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "EnergyRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceBundle" ADD CONSTRAINT "EvidenceBundle_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEvent" ADD CONSTRAINT "RewardEvent_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
