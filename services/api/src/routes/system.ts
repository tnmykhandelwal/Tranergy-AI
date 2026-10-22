import { Router } from "express";
import { prisma } from "../db";
import { config } from "../config";
import { requireAuth } from "../auth";
import { asyncHandler } from "../errors";

export const systemRouter = Router();

systemRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      service: "tranergy-api",
      chainEnabled: config.CHAIN_ENABLED,
      mlUrl: config.ML_SERVICE_URL,
      time: new Date().toISOString(),
    });
  }),
);

systemRouter.get(
  "/users",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
    res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        walletAddress: u.walletAddress,
      })),
    });
  }),
);
