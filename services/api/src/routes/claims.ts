import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireRole } from "../auth";
import { asyncHandler, badRequest, notFound } from "../errors";
import { verifyClaimById } from "../services/claimVerification";

export const claimsRouter = Router();

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "must be an ISO-8601 date string" })
  .transform((s) => new Date(s));

const createClaimSchema = z.object({
  facilityId: z.string().min(1),
  intervalStart: isoDate,
  intervalEnd: isoDate,
  claimedKwh: z.number().positive(),
  certificateExternalId: z.string().min(1).nullish(),
});

claimsRouter.post(
  "/claims",
  requireRole("producer", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = createClaimSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const body = parsed.data;
    if (body.intervalEnd <= body.intervalStart) {
      throw badRequest("intervalEnd must be after intervalStart");
    }

    const facility = await prisma.facility.findUnique({ where: { id: body.facilityId } });
    if (!facility) throw notFound(`facility ${body.facilityId} not found`);

    const claim = await prisma.generationClaim.create({
      data: {
        facilityId: body.facilityId,
        intervalStart: body.intervalStart,
        intervalEnd: body.intervalEnd,
        claimedKwh: body.claimedKwh,
        certificateExternalId: body.certificateExternalId ?? null,
        status: "PENDING",
        createdById: req.user!.id,
      },
    });

    res.status(201).json(claim);
  }),
);

claimsRouter.post(
  "/claims/:id/verify",
  requireRole("producer", "consumer", "coordinator", "verifier", "admin"),
  asyncHandler(async (req, res) => {
    const outcome = await verifyClaimById(req.params.id);
    res.json({
      claim: outcome.claim,
      case: {
        id: outcome.verificationCase.id,
        claimId: outcome.verificationCase.claimId,
        ruleResults: outcome.ruleResults,
        mlStatus: outcome.verificationCase.mlStatus,
        anomalyScore: outcome.verificationCase.anomalyScore,
        anomalyFlags: outcome.anomalyFlags,
        modelVersion: outcome.verificationCase.modelVersion,
        reviewStatus: outcome.verificationCase.reviewStatus,
        createdAt: outcome.verificationCase.createdAt,
      },
    });
  }),
);
