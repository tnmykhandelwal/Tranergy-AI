import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../auth";
import { asyncHandler, badRequest, conflict, forbidden, notFound } from "../errors";

export const setupRouter = Router();

const ROLES = ["producer", "consumer", "coordinator", "verifier", "admin"] as const;
const METER_TYPES = [
  "generation",
  "load",
  "grid_import",
  "grid_export",
  "battery_charge",
  "battery_discharge",
] as const;
const FACILITY_TYPES = ["producer", "consumer", "storage", "mixed"] as const;
const CERT_STATUSES = ["ACTIVE", "TRANSFERRED", "RETIRED", "INVALID", "UNKNOWN"] as const;

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "item"
  );
}

const updateUserRoleSchema = z.object({
  role: z.enum(ROLES),
  name: z.string().trim().min(1).max(120).optional(),
});

setupRouter.patch(
  "/users/:id/role",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const parsed = updateUserRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound(`user ${req.params.id} not found`);
    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { role: parsed.data.role, ...(parsed.data.name ? { name: parsed.data.name } : {}) },
    });
    res.json({
      user: {
        id: updated.id,
        name: updated.name,
        role: updated.role,
        walletAddress: updated.walletAddress,
      },
    });
  }),
);

const createFacilitySchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(120),
  type: z.enum(FACILITY_TYPES),
  installedCapacityKw: z.number().positive(),
  exportLimitKw: z.number().nonnegative().default(0),
  timezone: z.string().min(1).max(64).optional(),
});

setupRouter.post(
  "/facilities",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = createFacilitySchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const body = parsed.data;
    const id = body.id ?? slugify(body.name);

    const existing = await prisma.facility.findUnique({ where: { id } });
    if (existing) throw conflict(`facility ${id} already exists`);

    const facility = await prisma.facility.create({
      data: {
        id,
        name: body.name,
        type: body.type,
        installedCapacityKw: body.installedCapacityKw,
        exportLimitKw: body.exportLimitKw,
        timezone: body.timezone ?? "UTC",
        ownerId: req.user!.id,
      },
    });
    res.status(201).json({ facility: { id: facility.id, name: facility.name, type: facility.type } });
  }),
);

const createMeterSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  facilityId: z.string().min(1),
  meterType: z.enum(METER_TYPES),
  unit: z.string().min(1).max(16).default("kWh"),
  sourceType: z.enum(["simulated", "csv", "manual", "gateway"]).default("manual"),
  sourceStatus: z.enum(["authorized", "unverified", "revoked"]).default("authorized"),
});

setupRouter.post(
  "/meters",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = createMeterSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const body = parsed.data;

    const facility = await prisma.facility.findUnique({ where: { id: body.facilityId } });
    if (!facility) throw notFound(`facility ${body.facilityId} not found`);
    if (facility.ownerId !== req.user!.id && req.user!.role !== "admin") {
      throw forbidden("only the facility owner or an admin can add meters");
    }

    const id = body.id ?? `${body.facilityId}-${body.meterType}`;
    const existing = await prisma.meter.findUnique({ where: { id } });
    if (existing) throw conflict(`meter ${id} already exists`);

    const meter = await prisma.meter.create({
      data: {
        id,
        facilityId: body.facilityId,
        meterType: body.meterType,
        unit: body.unit,
        sourceType: body.sourceType,
        sourceStatus: body.sourceStatus,
      },
    });
    res.status(201).json({
      meter: {
        id: meter.id,
        facilityId: meter.facilityId,
        meterType: meter.meterType,
        unit: meter.unit,
        sourceType: meter.sourceType,
        sourceStatus: meter.sourceStatus,
      },
    });
  }),
);

const createCertificateSchema = z.object({
  externalId: z.string().min(1).max(120),
  issuer: z.string().min(1).max(120).default("Tranergy Registry"),
  quantityMwh: z.number().positive(),
  status: z.enum(CERT_STATUSES).default("ACTIVE"),
  ownerReference: z.string().min(1).max(120).nullish(),
  metadataHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex hash")
    .nullish(),
});

setupRouter.post(
  "/certificates",
  requireRole("producer", "verifier", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = createCertificateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const body = parsed.data;

    const existing = await prisma.certificateRecord.findUnique({ where: { externalId: body.externalId } });
    if (existing) throw conflict(`certificate ${body.externalId} already exists`);

    const metadataHash =
      body.metadataHash ?? `0x${createHash("sha256").update(body.externalId).digest("hex")}`;

    const cert = await prisma.certificateRecord.create({
      data: {
        id: body.externalId,
        registry: "MOCK",
        externalId: body.externalId,
        issuer: body.issuer,
        quantityMwh: body.quantityMwh,
        status: body.status,
        ownerReference: body.ownerReference ?? req.user!.id,
        metadataHash,
      },
    });
    res.status(201).json({
      certificate: {
        externalId: cert.externalId,
        registry: cert.registry,
        issuer: cert.issuer,
        quantityMwh: cert.quantityMwh,
        status: cert.status,
        ownerReference: cert.ownerReference,
        metadataHash: cert.metadataHash,
      },
    });
  }),
);
