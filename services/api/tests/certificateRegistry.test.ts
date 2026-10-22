import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { checkCertificate } from "../src/services/certificateRegistry";
import { resetDb } from "./helpers";

describe("certificateRegistry.checkCertificate", () => {
  beforeAll(async () => {
    await resetDb();
    await prisma.user.create({
      data: { id: "user-alice", name: "Alice", role: "producer" },
    });
    await prisma.facility.create({
      data: { id: "fac-solar-1", name: "Solar", type: "producer", installedCapacityKw: 150, exportLimitKw: 120, ownerId: "user-alice" },
    });
    await prisma.certificateRecord.createMany({
      data: [
        { id: "c1", externalId: "CERT-ACTIVE-0001", issuer: "MockRegistry", quantityMwh: 1, status: "ACTIVE", ownerReference: "user-alice", metadataHash: "0x1" },
        { id: "c2", externalId: "CERT-TRANSFERRED-0001", issuer: "MockRegistry", quantityMwh: 1, status: "TRANSFERRED", ownerReference: "user-bob", metadataHash: "0x2" },
        { id: "c3", externalId: "CERT-RETIRED-0001", issuer: "MockRegistry", quantityMwh: 1, status: "RETIRED", ownerReference: "user-alice", metadataHash: "0x3" },
        { id: "c4", externalId: "CERT-INVALID-0001", issuer: "MockRegistry", quantityMwh: 1, status: "INVALID", ownerReference: "user-alice", metadataHash: "0x4" },
        { id: "c5", externalId: "CERT-SMALL-0001", issuer: "MockRegistry", quantityMwh: 0.05, status: "ACTIVE", ownerReference: "user-alice", metadataHash: "0x5" },
      ],
    });
    await prisma.generationClaim.create({
      data: {
        id: "clm-holder",
        facilityId: "fac-solar-1",
        intervalStart: new Date("2026-10-17T11:00:00Z"),
        intervalEnd: new Date("2026-10-17T12:00:00Z"),
        claimedKwh: 50,
        certificateExternalId: "CERT-ACTIVE-0001",
        status: "PENDING",
        createdById: "user-alice",
      },
    });
    await prisma.generationClaim.create({
      data: {
        id: "clm-rejected-holder",
        facilityId: "fac-solar-1",
        intervalStart: new Date("2026-10-17T13:00:00Z"),
        intervalEnd: new Date("2026-10-17T14:00:00Z"),
        claimedKwh: 50,
        certificateExternalId: "CERT-TRANSFERRED-0001",
        status: "REJECTED_BY_RULE",
        createdById: "user-alice",
      },
    });
  });

  it("returns CERTIFICATE_NOT_FOUND with UNKNOWN status for missing ids", async () => {
    const result = await checkCertificate("CERT-MISSING-0001");
    expect(result).toMatchObject({
      externalId: "CERT-MISSING-0001",
      status: "UNKNOWN",
      usable: false,
      quantityMwh: null,
      issues: ["CERTIFICATE_NOT_FOUND"],
      usedByClaimIds: [],
    });
  });

  it("ACTIVE certificate with enough quantity and no other claim is usable", async () => {
    const result = await checkCertificate("CERT-SMALL-0001", 40);
    expect(result.usable).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.quantityMwh).toBe(0.05);
  });

  it("flags TRANSFERRED, RETIRED and INVALID statuses as not usable", async () => {
    expect((await checkCertificate("CERT-TRANSFERRED-0001")).issues).toEqual(["CERTIFICATE_TRANSFERRED"]);
    expect((await checkCertificate("CERT-RETIRED-0001")).issues).toEqual(["CERTIFICATE_RETIRED"]);
    const invalid = await checkCertificate("CERT-INVALID-0001");
    expect(invalid.issues).toEqual(["CERTIFICATE_INVALID"]);
    expect(invalid.usable).toBe(false);
  });

  it("flags CERTIFICATE_DUPLICATE_USE when attached to another non-rejected claim", async () => {
    const result = await checkCertificate("CERT-ACTIVE-0001", 50, "clm-other");
    expect(result.usable).toBe(false);
    expect(result.issues).toContain("CERTIFICATE_DUPLICATE_USE");
    expect(result.usedByClaimIds).toEqual(["clm-holder"]);
  });

  it("excludes the requesting claim from duplicate detection", async () => {
    const result = await checkCertificate("CERT-ACTIVE-0001", 50, "clm-holder");
    expect(result.issues).not.toContain("CERTIFICATE_DUPLICATE_USE");
    expect(result.usedByClaimIds).toEqual([]);
  });

  it("ignores REJECTED claims when detecting duplicate use", async () => {
    const result = await checkCertificate("CERT-TRANSFERRED-0001");
    expect(result.issues).not.toContain("CERTIFICATE_DUPLICATE_USE");
    expect(result.usedByClaimIds).toEqual([]);
  });

  it("flags CERTIFICATE_QUANTITY_TOO_SMALL when quantityMwh*1000 < claimKwh", async () => {
    const result = await checkCertificate("CERT-SMALL-0001", 100);
    expect(result.issues).toContain("CERTIFICATE_QUANTITY_TOO_SMALL");
    expect(result.usable).toBe(false);
  });
});
