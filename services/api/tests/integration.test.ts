import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db";
import { createApp } from "../src/app";
import { fixtureInterval, resetDb, seedMinimalFixtures } from "./helpers";

const app = createApp();

let mlFlagged = false;
let fixturesNow = new Date();

beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      if (!String(url).includes("/score")) throw new Error(`unexpected fetch: ${String(url)}`);
      return {
        ok: true,
        json: async () =>
          mlFlagged
            ? {
                anomalyScore: 0.73,
                isAnomaly: true,
                flagged: true,
                mlStatus: "ANOMALY_FLAGGED",
                reasonCodes: ["GEN_SPIKE_VS_ROLLING", "GEN_ABOVE_CAPACITY"],
                modelVersion: "iforest-test",
                features: { capacityRatio: 1.1 },
              }
            : {
                anomalyScore: 0.1,
                isAnomaly: false,
                flagged: false,
                mlStatus: "OK",
                reasonCodes: [],
                modelVersion: "iforest-test",
                features: { capacityRatio: 0.93 },
              },
      } as Response;
    }),
  );
  await resetDb();
  const seeded = await seedMinimalFixtures();
  fixturesNow = seeded.now;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.$disconnect();
});

describe("system", () => {
  it("GET /api/health is public", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, service: "tranergy-api", chainEnabled: false });
  });

  it("GET /api/chain/status reports disabled chain", async () => {
    const res = await request(app).get("/api/chain/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: false, connected: false });
  });
});

describe("readings import", () => {
  it("counts imported, skipped duplicates and negative rows", async () => {
    const csv = [
      "meterId,facilityId,meterType,intervalStart,intervalEnd,energyKwh",
      "m-solar-gen,fac-solar-1,generation,2026-01-01T00:00:00.000Z,2026-01-01T01:00:00.000Z,10",
      "m-solar-gen,fac-solar-1,generation,2026-01-01T01:00:00.000Z,2026-01-01T02:00:00.000Z,20",
      "m-solar-gen,fac-solar-1,generation,2026-01-01T00:00:00.000Z,2026-01-01T01:00:00.000Z,10",
      "m-solar-gen,fac-solar-1,generation,2026-01-01T02:00:00.000Z,2026-01-01T03:00:00.000Z,-5",
      "m-csv-gen,fac-solar-1,generation,2026-01-01T00:00:00.000Z,2026-01-01T01:00:00.000Z,8",
    ].join("\n");

    const res = await request(app)
      .post("/api/readings/import")
      .set("x-user-id", "user-alice")
      .set("content-type", "text/csv")
      .send(csv);

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(3);
    expect(res.body.skippedDuplicates).toBe(1);
    expect(res.body.invalid).toBe(1);

    const meter = await prisma.meter.findUnique({ where: { id: "m-csv-gen" } });
    expect(meter).not.toBeNull();
    expect(meter?.sourceType).toBe("csv");
    expect(meter?.sourceStatus).toBe("unverified");
  });

  it("rejects unauthenticated import", async () => {
    const res = await request(app)
      .post("/api/readings/import")
      .set("content-type", "text/csv")
      .send("meterId\nx");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("claims and verification", () => {
  let happyClaimId = "";
  let happyInterval = { start: new Date(), end: new Date() };
  let softClaimId = "";
  let hardClaimId = "";

  beforeAll(() => {
    happyInterval = fixtureInterval(22, fixturesNow);
  });

  it("creates a claim as producer", async () => {
    const res = await request(app)
      .post("/api/claims")
      .set("x-user-id", "user-alice")
      .send({
        facilityId: "fac-solar-1",
        intervalStart: happyInterval.start.toISOString(),
        intervalEnd: happyInterval.end.toISOString(),
        claimedKwh: 140,
        certificateExternalId: "CERT-ACTIVE-0001",
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    happyClaimId = res.body.id;
  });

  it("verifies the happy claim to VERIFIED_FOR_PROTOTYPE (idempotent)", async () => {
    mlFlagged = false;
    const res = await request(app)
      .post(`/api/claims/${happyClaimId}/verify`)
      .set("x-user-id", "user-alice");
    expect(res.status).toBe(200);
    expect(res.body.claim.status).toBe("VERIFIED_FOR_PROTOTYPE");
    expect(res.body.case.ruleResults).toEqual([]);
    expect(res.body.case.mlStatus).toBe("OK");

    const again = await request(app)
      .post(`/api/claims/${happyClaimId}/verify`)
      .set("x-user-id", "user-alice");
    expect(again.status).toBe(200);
    expect(again.body.case.id).toBe(res.body.case.id);
    expect(again.body.claim.status).toBe("VERIFIED_FOR_PROTOTYPE");
  });

  it("flags a capacity-soft + claim-exceeds claim as REVIEW_REQUIRED with ML reasons", async () => {
    mlFlagged = true;
    const interval = fixtureInterval(24, fixturesNow);
    const created = await request(app)
      .post("/api/claims")
      .set("x-user-id", "user-alice")
      .send({
        facilityId: "fac-solar-1",
        intervalStart: interval.start.toISOString(),
        intervalEnd: interval.end.toISOString(),
        claimedKwh: 330,
      });
    softClaimId = created.body.id;

    const res = await request(app)
      .post(`/api/claims/${softClaimId}/verify`)
      .set("x-user-id", "user-alice");
    expect(res.status).toBe(200);
    expect(res.body.claim.status).toBe("REVIEW_REQUIRED");
    const codes = res.body.case.ruleResults.map((r: { code: string; severity: string }) => r.code);
    expect(codes).toContain("CAPACITY_EXCEEDED");
    expect(codes).toContain("CLAIM_EXCEEDS_METER");
    expect(codes).toContain("ML_ANOMALY_FLAGGED");
    const capacity = res.body.case.ruleResults.find((r: { code: string }) => r.code === "CAPACITY_EXCEEDED");
    expect(capacity.severity).toBe("soft");
    expect(res.body.case.anomalyScore).toBe(0.73);
    expect(res.body.case.anomalyFlags).toEqual(["GEN_SPIKE_VS_ROLLING", "GEN_ABOVE_CAPACITY"]);
  });

  it("rejects a 2x capacity spike claim by hard rule", async () => {
    mlFlagged = false;
    const interval = fixtureInterval(30, fixturesNow);
    const created = await request(app)
      .post("/api/claims")
      .set("x-user-id", "user-alice")
      .send({
        facilityId: "fac-solar-1",
        intervalStart: interval.start.toISOString(),
        intervalEnd: interval.end.toISOString(),
        claimedKwh: 600,
      });
    hardClaimId = created.body.id;

    const res = await request(app)
      .post(`/api/claims/${hardClaimId}/verify`)
      .set("x-user-id", "user-alice");
    expect(res.body.claim.status).toBe("REJECTED_BY_RULE");
    const capacity = res.body.case.ruleResults.find((r: { code: string }) => r.code === "CAPACITY_EXCEEDED");
    expect(capacity.severity).toBe("hard");
  });

  it("enforces verifier role on decisions", async () => {
    const cases = await request(app)
      .get("/api/verification-cases?status=OPEN")
      .set("x-user-id", "user-carol");
    expect(cases.status).toBe(200);
    const softCase = cases.body.cases.find((c: { claim: { id: string } }) => c.claim.id === softClaimId);
    expect(softCase).toBeTruthy();

    const forbidden = await request(app)
      .post(`/api/verification-cases/${softCase.id}/decision`)
      .set("x-user-id", "user-bob")
      .send({ decision: "approve", note: "not a verifier" });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");

    const approved = await request(app)
      .post(`/api/verification-cases/${softCase.id}/decision`)
      .set("x-user-id", "user-diana")
      .send({ decision: "approve", note: "manual meter audit ok" });
    expect(approved.status).toBe(200);
    expect(approved.body.claim.status).toBe("VERIFIED_FOR_PROTOTYPE");
    expect(approved.body.case.reviewStatus).toBe("APPROVED_BY_REVIEWER");
  });
});

describe("marketplace and settlement", () => {
  let offerId = "";
  let tradeId = "";
  let agreedKwh = 0;
  let interval = { start: new Date(), end: new Date() };

  beforeAll(async () => {
    const claim = await prisma.generationClaim.findFirst({ where: { claimedKwh: 140 } });
    if (!claim) throw new Error("happy claim fixture missing");
    interval = { start: claim.intervalStart, end: claim.intervalEnd };
  });

  it("rejects offers above offerable with NOT_ELIGIBLE", async () => {
    const claim = await prisma.generationClaim.findFirst({ where: { claimedKwh: 140 } });
    const res = await request(app)
      .post("/api/offers")
      .set("x-user-id", "user-alice")
      .send({ claimId: claim!.id, quantityKwh: 1000, pricePerKwh: 0.12 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NOT_ELIGIBLE");
  });

  it("creates an eligible offer", async () => {
    const claim = await prisma.generationClaim.findFirst({ where: { claimedKwh: 140 } });
    const res = await request(app)
      .post("/api/offers")
      .set("x-user-id", "user-alice")
      .send({ claimId: claim!.id, quantityKwh: 20, pricePerKwh: 0.12 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "OPEN", reservedKwh: 0, quantityKwh: 20, pricePerKwh: 0.12 });
    offerId = res.body.id;
  });

  it("matches a request against the offer and reserves capacity", async () => {
    const req1 = await request(app)
      .post("/api/requests")
      .set("x-user-id", "user-bob")
      .send({
        quantityKwh: 15,
        maxPricePerKwh: 0.15,
        intervalStart: interval.start.toISOString(),
        intervalEnd: interval.end.toISOString(),
      });
    expect(req1.status).toBe(201);

    const run = await request(app)
      .post("/api/matches/run")
      .set("x-user-id", "user-carol")
      .send({});
    expect(run.status).toBe(200);
    expect(run.body.createdTrades).toHaveLength(1);
    expect(run.body.createdTrades[0]).toMatchObject({ offerId, agreedKwh: 15, pricePerKwh: 0.12, state: "MATCHED" });
    tradeId = run.body.createdTrades[0].tradeId;
    agreedKwh = run.body.createdTrades[0].agreedKwh;

    const offer = await prisma.energyOffer.findUnique({ where: { id: offerId } });
    expect(offer?.reservedKwh).toBe(15);
    expect(offer?.status).toBe("PARTIALLY_RESERVED");
  });

  it("cannot over-allocate a fully reserved offer", async () => {
    const req2 = await request(app)
      .post("/api/requests")
      .set("x-user-id", "user-bob")
      .send({
        quantityKwh: 50,
        maxPricePerKwh: 0.15,
        intervalStart: interval.start.toISOString(),
        intervalEnd: interval.end.toISOString(),
      });
    const run2 = await request(app)
      .post("/api/matches/run")
      .set("x-user-id", "user-carol")
      .send({});
    expect(run2.body.createdTrades).toHaveLength(1);
    expect(run2.body.createdTrades[0].agreedKwh).toBe(5);

    const offerAfter = await prisma.energyOffer.findUnique({ where: { id: offerId } });
    expect(offerAfter?.reservedKwh).toBe(20);
    expect(offerAfter?.status).toBe("FILLED");

    const req3 = await request(app)
      .post("/api/requests")
      .set("x-user-id", "user-bob")
      .send({
        quantityKwh: 10,
        maxPricePerKwh: 0.15,
        intervalStart: interval.start.toISOString(),
        intervalEnd: interval.end.toISOString(),
      });
    expect(req2.status).toBe(201);
    expect(req3.status).toBe(201);
    const run3 = await request(app)
      .post("/api/matches/run")
      .set("x-user-id", "user-carol")
      .send({});
    expect(run3.body.createdTrades).toHaveLength(0);
    const offerFinal = await prisma.energyOffer.findUnique({ where: { id: offerId } });
    expect(offerFinal?.reservedKwh).toBe(20);
  });

  it("submits evidence within tolerance and settles with verifier role only", async () => {
    const evidence = await request(app)
      .post(`/api/trades/${tradeId}/evidence`)
      .set("x-user-id", "user-alice")
      .send({
        producerExportKwh: agreedKwh * 0.97,
        consumerImportKwh: agreedKwh * 0.96,
        notes: "simulated meter pull",
        recordReferences: [`m-solar-export@${interval.start.toISOString()}`],
      });
    expect(evidence.status).toBe(200);
    expect(evidence.body.withinTolerance).toBe(true);
    expect(evidence.body.chainTxHash).toBeNull();
    expect(evidence.body.trade.state).toBe("EVIDENCE_SUBMITTED");

    const tradeAfterEvidence = await request(app).get(`/api/trades/${tradeId}`);
    expect(tradeAfterEvidence.body.state).toBe("EVIDENCE_SUBMITTED");
    expect(tradeAfterEvidence.body.evidenceBundles).toHaveLength(1);

    const forbidden = await request(app)
      .post(`/api/trades/${tradeId}/attest`)
      .set("x-user-id", "user-bob");
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");

    const attest = await request(app)
      .post(`/api/trades/${tradeId}/attest`)
      .set("x-user-id", "user-diana");
    expect(attest.status).toBe(200);
    expect(attest.body.trade.state).toBe("SETTLED");
    expect(attest.body.trade.settlementTxHash).toBeNull();
    expect(attest.body.chainDisabled).toBe(true);
    expect(attest.body.reward.recipient).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    const expectedAmount = (BigInt(Math.floor(agreedKwh * 1e6)) * 10n ** 12n).toString();
    expect(attest.body.reward.amount).toBe(expectedAmount);
    expect(attest.body.reward.reason).toBe("verified-delivery");
  });

  it("returns a spec-shaped receipt", async () => {
    const res = await request(app).get(`/api/trades/${tradeId}/receipt`);
    expect(res.status).toBe(200);
    expect(res.body.trade).toMatchObject({ id: tradeId, state: "SETTLED", agreedKwh });
    expect(res.body.trade.estimatedValue).toBeCloseTo(agreedKwh * 0.12, 4);
    expect(res.body.offer).toMatchObject({ id: offerId, facilityId: "fac-solar-1" });
    expect(res.body.request.buyerId).toBe("user-bob");
    expect(res.body.evidence.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(res.body.evidence.withinTolerance).toBe(true);
    expect(res.body.evidence.attestationStatus).toBe("ATTESTED");
    expect(res.body.chain).toMatchObject({ enabled: false, tradeId: null, txHash: null, settlementTxHash: null, stateOnChain: null });
    expect(res.body.rewards).toHaveLength(1);
    expect(res.body.disclaimer).toBeUndefined();
  });

  it("exposes interval energy with offerable and reservation fields", async () => {
    const res = await request(app).get("/api/facilities/fac-solar-1/energy");
    expect(res.status).toBe(200);
    expect(res.body.facilityId).toBe("fac-solar-1");
    expect(Array.isArray(res.body.intervals)).toBe(true);
    const target = res.body.intervals.find(
      (i: { intervalStart: string }) => i.intervalStart === interval.start.toISOString(),
    );
    expect(target).toBeTruthy();
    expect(target.claimStatus).toBe("VERIFIED_FOR_PROTOTYPE");
    expect(target.generationKwh).toBe(140);
    expect(target.loadKwh).toBe(12);
    expect(target.offerableKwh).toBe(120);
    expect(target.reservedKwh).toBe(0);
    expect(target.hasOpenOffer).toBe(false);
    expect(target.bufferKwh).toBe(2);
  });
});
