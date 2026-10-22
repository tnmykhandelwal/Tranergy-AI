import { Router } from "express";
import { prisma } from "../db";
import { asyncHandler } from "../errors";
import { checkCertificate } from "../services/certificateRegistry";

export const certificatesRouter = Router();

certificatesRouter.get(
  "/certificates",
  asyncHandler(async (_req, res) => {
    const certificates = await prisma.certificateRecord.findMany({ orderBy: { externalId: "asc" } });
    res.json({
      certificates: certificates.map((c) => ({
        externalId: c.externalId,
        registry: c.registry,
        issuer: c.issuer,
        quantityMwh: c.quantityMwh,
        status: c.status,
        ownerReference: c.ownerReference,
        metadataHash: c.metadataHash,
        issuedAt: c.issuedAt.toISOString(),
      })),
    });
  }),
);

certificatesRouter.get(
  "/certificates/:externalId/check",
  asyncHandler(async (req, res) => {
    const claimKwhRaw = req.query.claimKwh;
    const claimKwh =
      typeof claimKwhRaw === "string" && claimKwhRaw.length > 0 ? Number(claimKwhRaw) : undefined;
    const excludeClaimId = typeof req.query.excludeClaimId === "string" ? req.query.excludeClaimId : undefined;
    const result = await checkCertificate(
      req.params.externalId,
      claimKwh !== undefined && Number.isFinite(claimKwh) ? claimKwh : undefined,
      excludeClaimId,
    );
    res.json(result);
  }),
);
