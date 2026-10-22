import { Prisma } from "@prisma/client";
import { Router } from "express";
import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";
import { prisma } from "../db";
import { asyncHandler, badRequest } from "../errors";
import { requireAuth } from "../auth";
import { generateSimulatorData, streamsForType } from "../services/simulator";

export const readingsRouter = Router();

const csvRowSchema = z.object({
  meterId: z.string().min(1),
  facilityId: z.string().min(1).optional(),
  meterType: z.string().min(1).optional(),
  intervalStart: z.string().min(1),
  intervalEnd: z.string().min(1),
  energyKwh: z.union([z.number(), z.string()]),
});

interface ImportRowError {
  row: number;
  message: string;
}

readingsRouter.post(
  "/readings/import",
  requireAuth,
  asyncHandler(async (req, res) => {
    let csvText: string;
    if (typeof req.body === "string" && req.body.length > 0) {
      csvText = req.body;
    } else if (req.body && typeof req.body === "object" && typeof (req.body as { csv?: unknown }).csv === "string") {
      csvText = (req.body as { csv: string }).csv;
    } else {
      throw badRequest("CSV body required (Content-Type: text/csv or JSON {csv: string})");
    }

    let records: Array<Record<string, unknown>>;
    try {
      records = parseCsv(csvText, { columns: true, skip_empty_lines: true, trim: true }) as Array<
        Record<string, unknown>
      >;
    } catch (err) {
      throw badRequest(`invalid CSV: ${err instanceof Error ? err.message : "parse error"}`);
    }

    let imported = 0;
    let skippedDuplicates = 0;
    let invalid = 0;
    const errors: ImportRowError[] = [];
    const createdMeters = new Set<string>();

    for (let i = 0; i < records.length; i++) {
      const parsedRow = csvRowSchema.safeParse(records[i]);
      if (!parsedRow.success) {
        invalid += 1;
        errors.push({ row: i + 2, message: `missing or invalid columns: ${parsedRow.error.issues.map((x) => x.path.join(".")).join(", ")}` });
        continue;
      }
      const row = parsedRow.data;
      const intervalStart = new Date(row.intervalStart);
      const intervalEnd = new Date(row.intervalEnd);
      if (Number.isNaN(intervalStart.getTime()) || Number.isNaN(intervalEnd.getTime()) || intervalEnd <= intervalStart) {
        invalid += 1;
        errors.push({ row: i + 2, message: "invalid intervalStart/intervalEnd" });
        continue;
      }

      const rawEnergy = typeof row.energyKwh === "number" ? row.energyKwh : Number(row.energyKwh);
      if (!Number.isFinite(rawEnergy)) {
        invalid += 1;
        errors.push({ row: i + 2, message: "energyKwh is not a number" });
        continue;
      }

      const existingMeter = await prisma.meter.findUnique({ where: { id: row.meterId } });
      let meterId = row.meterId;
      if (!existingMeter) {
        if (!row.facilityId || !row.meterType) {
          invalid += 1;
          errors.push({ row: i + 2, message: "unknown meterId requires facilityId and meterType to auto-create" });
          continue;
        }
        let facility = await prisma.facility.findUnique({ where: { id: row.facilityId } });
        if (!facility) {
          facility = await prisma.facility.create({
            data: {
              id: row.facilityId,
              name: row.facilityId,
              type: "mixed",
              installedCapacityKw: 100,
              exportLimitKw: 100,
              ownerId: req.user!.id,
            },
          });
        }
        await prisma.meter.create({
          data: {
            id: row.meterId,
            facilityId: facility.id,
            meterType: row.meterType,
            unit: "kWh",
            sourceType: "csv",
            sourceStatus: "unverified",
          },
        });
        createdMeters.add(row.meterId);
      } else {
        meterId = existingMeter.id;
      }

      if (rawEnergy < 0) {
        const meterType = existingMeter?.meterType ?? row.meterType ?? "";
        if (meterType === "generation" || meterType === "load") {
          invalid += 1;
          errors.push({ row: i + 2, message: `negative energy on ${meterType} meter` });
          continue;
        }
      }

      try {
        await prisma.meterReading.create({
          data: {
            meterId,
            intervalStart,
            intervalEnd,
            energyKwh: rawEnergy,
            sourceReference: "csv-import",
          },
        });
        imported += 1;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          skippedDuplicates += 1;
        } else {
          invalid += 1;
          errors.push({ row: i + 2, message: err instanceof Error ? err.message : "insert failed" });
        }
      }
    }

    res.json({ imported, skippedDuplicates, invalid, errors });
  }),
);

const simulatorSchema = z.object({
  days: z.coerce.number().positive().max(30).default(7),
  seed: z.coerce.number().int().default(42),
  injectAnomalies: z.coerce.boolean().default(false),
});

readingsRouter.post(
  "/simulator/run",
  requireAuth,
  asyncHandler(async (req, res) => {
    const source = {
      ...(typeof req.body === "object" && req.body !== null ? req.body : {}),
      ...(typeof req.query === "object" && req.query !== null ? req.query : {}),
    };
    const parsed = simulatorSchema.safeParse(source);
    if (!parsed.success) {
      throw badRequest(`invalid simulator options: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    }
    const { days, seed, injectAnomalies } = parsed.data;

    const facilities = await prisma.facility.findMany({ orderBy: { id: "asc" } });
    if (facilities.length === 0) {
      throw badRequest("no facilities yet — create a facility (Setup page) before generating readings");
    }

    const data = generateSimulatorData({
      days,
      seed,
      injectAnomalies,
      facilities: facilities.map((f) => ({
        id: f.id,
        type: f.type,
        installedCapacityKw: f.installedCapacityKw,
        exportLimitKw: f.exportLimitKw,
      })),
    });

    const meterIds = Array.from(new Set(data.readings.map((r) => r.meterId)));
    for (const facility of facilities) {
      for (const stream of streamsForType(facility.type)) {
        const meterId = `${facility.id}-${stream.suffix}`;
        if (!meterIds.includes(meterId)) continue;
        const existing = await prisma.meter.findUnique({ where: { id: meterId } });
        if (existing) continue;
        await prisma.meter.create({
          data: {
            id: meterId,
            facilityId: facility.id,
            meterType: stream.meterType,
            unit: "kWh",
            sourceType: "simulated",
            sourceStatus: "authorized",
          },
        });
      }
    }

    await prisma.meterReading.deleteMany({
      where: {
        meterId: { in: meterIds },
        intervalStart: { gte: data.window.from },
        intervalEnd: { lte: data.window.to },
      },
    });

    let readingsWritten = 0;
    let skippedDuplicates = 0;
    for (const row of data.readings) {
      try {
        await prisma.meterReading.create({
          data: {
            meterId: row.meterId,
            intervalStart: row.intervalStart,
            intervalEnd: row.intervalEnd,
            energyKwh: row.energyKwh,
            ...(row.ingestedAt ? { ingestedAt: row.ingestedAt } : {}),
            sourceReference: `simulator:seed=${seed}`,
          },
        });
        readingsWritten += 1;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          skippedDuplicates += 1;
        } else {
          throw err;
        }
      }
    }

    if (data.duplicateAttempt) {
      try {
        await prisma.meterReading.create({
          data: {
            meterId: data.duplicateAttempt.meterId,
            intervalStart: data.duplicateAttempt.intervalStart,
            intervalEnd: data.duplicateAttempt.intervalEnd,
            energyKwh: data.duplicateAttempt.energyKwh,
            sourceReference: "simulator:duplicate-attempt",
          },
        });
        readingsWritten += 1;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          skippedDuplicates += 1;
        } else {
          throw err;
        }
      }
    }

    res.json({
      days,
      seed,
      readingsWritten,
      skippedDuplicates,
      anomaliesInjected: data.anomaliesInjected,
      window: { from: data.window.from.toISOString(), to: data.window.to.toISOString() },
    });
  }),
);
