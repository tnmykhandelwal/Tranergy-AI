import { prisma } from "../src/db";

export async function resetDb(): Promise<void> {
  await prisma.rewardEvent.deleteMany();
  await prisma.evidenceBundle.deleteMany();
  await prisma.trade.deleteMany();
  await prisma.energyOffer.deleteMany();
  await prisma.energyRequest.deleteMany();
  await prisma.verificationCase.deleteMany();
  await prisma.generationClaim.deleteMany();
  await prisma.meterReading.deleteMany();
  await prisma.meter.deleteMany();
  await prisma.certificateRecord.deleteMany();
  await prisma.facility.deleteMany();
  await prisma.user.deleteMany();
}

export const HOUR_MS = 3600_000;

export function hourStart(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

export async function seedMinimalFixtures(): Promise<{ now: Date }> {
  const now = hourStart(new Date());
  await prisma.user.createMany({
    data: [
      { id: "user-alice", name: "Alice Generator", role: "producer", walletAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
      { id: "user-bob", name: "Bob Building", role: "consumer", walletAddress: null },
      { id: "user-carol", name: "Carol Coordinator", role: "coordinator", walletAddress: null },
      { id: "user-diana", name: "Diana Verifier", role: "verifier", walletAddress: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" },
      { id: "user-admin", name: "Admin", role: "admin", walletAddress: null },
    ],
  });

  await prisma.facility.create({
    data: {
      id: "fac-solar-1",
      name: "Solar Site 01",
      type: "producer",
      installedCapacityKw: 150,
      exportLimitKw: 120,
      ownerId: "user-alice",
    },
  });

  await prisma.meter.createMany({
    data: [
      { id: "m-solar-gen", facilityId: "fac-solar-1", meterType: "generation", sourceType: "simulated", sourceStatus: "authorized" },
      { id: "m-solar-export", facilityId: "fac-solar-1", meterType: "grid_export", sourceType: "simulated", sourceStatus: "authorized" },
      { id: "m-solar-load", facilityId: "fac-solar-1", meterType: "load", sourceType: "simulated", sourceStatus: "authorized" },
    ],
  });

  await prisma.certificateRecord.createMany({
    data: [
      { id: "cert-active-0001", externalId: "CERT-ACTIVE-0001", issuer: "MockRegistry", quantityMwh: 1, status: "ACTIVE", ownerReference: "user-alice", metadataHash: "0x" + "a".repeat(64) },
      { id: "cert-transferred-0001", externalId: "CERT-TRANSFERRED-0001", issuer: "MockRegistry", quantityMwh: 1, status: "TRANSFERRED", ownerReference: "user-bob", metadataHash: "0x" + "b".repeat(64) },
      { id: "cert-retired-0001", externalId: "CERT-RETIRED-0001", issuer: "MockRegistry", quantityMwh: 1, status: "RETIRED", ownerReference: "user-alice", metadataHash: "0x" + "c".repeat(64) },
      { id: "cert-invalid-0001", externalId: "CERT-INVALID-0001", issuer: "MockRegistry", quantityMwh: 1, status: "INVALID", ownerReference: "user-alice", metadataHash: "0x" + "d".repeat(64) },
      { id: "cert-active-dup-0001", externalId: "CERT-ACTIVE-DUP-0001", issuer: "MockRegistry", quantityMwh: 1, status: "ACTIVE", ownerReference: "user-alice", metadataHash: "0x" + "e".repeat(64) },
    ],
  });

  const start = new Date(now.getTime() - 48 * HOUR_MS);
  for (let i = 0; i < 48; i++) {
    const intervalStart = new Date(start.getTime() + i * HOUR_MS);
    const intervalEnd = new Date(intervalStart.getTime() + HOUR_MS);
    const hour = intervalStart.getUTCHours();
    const bell = hour + 0.5 > 6 && hour + 0.5 < 18 ? Math.sin((Math.PI * (hour + 0.5 - 6)) / 12) ** 1.5 : 0;
    let gen = Math.round(150 * bell * 100) / 100;
    const load = 12;
    if (i === 22) gen = 140;
    if (i === 24) gen = 165;
    if (i === 30) gen = 300;
    const ingestedAt = new Date(intervalEnd.getTime() + 60_000);
    await prisma.meterReading.createMany({
      data: [
        { meterId: "m-solar-gen", intervalStart, intervalEnd, energyKwh: gen, ingestedAt },
        { meterId: "m-solar-export", intervalStart, intervalEnd, energyKwh: Math.max(0, gen - load), ingestedAt },
        { meterId: "m-solar-load", intervalStart, intervalEnd, energyKwh: load, ingestedAt },
      ],
    });
  }

  return { now };
}

export function fixtureInterval(index: number, now: Date): { start: Date; end: Date } {
  const start = new Date(new Date(now.getTime() - 48 * HOUR_MS).getTime() + index * HOUR_MS);
  return { start, end: new Date(start.getTime() + HOUR_MS) };
}
