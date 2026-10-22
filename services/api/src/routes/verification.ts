import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../auth";
import { asyncHandler, badRequest, notFound } from "../errors";
import { parseRuleResults, parseStringArray } from "../services/claimVerification";

export const verificationRouter = Router();

verificationRouter.get(
  "/verification-cases",
  requireAuth,
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const cases = await prisma.verificationCase.findMany({
      where: status ? { reviewStatus: status } : {},
      include: { claim: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      cases: cases.map((c) => ({
        id: c.id,
        claim: {
          id: c.claim.id,
          facilityId: c.claim.facilityId,
          intervalStart: c.claim.intervalStart.toISOString(),
          intervalEnd: c.claim.intervalEnd.toISOString(),
          claimedKwh: c.claim.claimedKwh,
          status: c.claim.status,
        },
        ruleResults: parseRuleResults(c.ruleResults),
        anomalyScore: c.anomalyScore,
        anomalyFlags: parseStringArray(c.anomalyFlags),
        mlStatus: c.mlStatus,
        reviewStatus: c.reviewStatus,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  }),
);

const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().optional(),
});

verificationRouter.post(
  "/verification-cases/:id/decision",
  requireRole("verifier", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const { decision, note } = parsed.data;

    const verificationCase = await prisma.verificationCase.findUnique({
      where: { id: req.params.id },
      include: { claim: true },
    });
    if (!verificationCase) throw notFound(`verification case ${req.params.id} not found`);

    const approved = decision === "approve";
    const claimStatus = approved ? "VERIFIED_FOR_PROTOTYPE" : "REJECTED_BY_RULE";
    const reviewStatus = approved ? "APPROVED_BY_REVIEWER" : "REJECTED_BY_REVIEWER";

    const [updatedClaim, updatedCase] = await prisma.$transaction([
      prisma.generationClaim.update({
        where: { id: verificationCase.claimId },
        data: { status: claimStatus },
      }),
      prisma.verificationCase.update({
        where: { id: verificationCase.id },
        data: {
          reviewStatus,
          reviewerId: req.user!.id,
          decidedAt: new Date(),
          decisionNote: note ?? null,
        },
      }),
    ]);

    if (!approved) {
      await prisma.energyOffer.updateMany({
        where: { claimId: verificationCase.claimId, status: { in: ["OPEN", "PARTIALLY_RESERVED"] } },
        data: { status: "BLOCKED" },
      });
    }

    res.json({ claim: updatedClaim, case: { ...updatedCase, ruleResults: parseRuleResults(updatedCase.ruleResults) } });
  }),
);
