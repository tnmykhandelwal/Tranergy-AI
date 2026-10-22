import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { config } from "../config";
import { requireAuth } from "../auth";
import { asyncHandler, badRequest, unauthorized } from "../errors";
import {
  defaultNameForWallet,
  isWalletAddress,
  issueAuthToken,
  issueWalletNonce,
  normalizeWallet,
  verifyWalletSignature,
} from "../walletAuth";

export const authRouter = Router();

const registerRoles = ["producer", "consumer"] as const;

function publicUser(user: {
  id: string;
  name: string;
  role: string;
  walletAddress: string | null;
}) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    walletAddress: user.walletAddress,
  };
}

async function findByWallet(address: string) {
  const wallet = normalizeWallet(address);
  const users = await prisma.user.findMany({ where: { walletAddress: { not: null } } });
  return users.find((u) => (u.walletAddress ?? "").toLowerCase() === wallet) ?? null;
}

authRouter.get(
  "/auth/nonce",
  asyncHandler(async (req, res) => {
    const address = typeof req.query.address === "string" ? req.query.address.trim() : "";
    if (!isWalletAddress(address)) {
      throw badRequest("a valid 0x wallet address is required");
    }
    res.json(issueWalletNonce(address));
  }),
);

const verifySchema = z.object({
  address: z.string().refine(isWalletAddress, "must be a 0x… 40-byte address"),
  signature: z.string().min(1),
  role: z.enum(registerRoles).optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

authRouter.post(
  "/auth/verify",
  asyncHandler(async (req, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const { address, signature, role, name } = parsed.data;

    if (!verifyWalletSignature(address, signature)) {
      throw unauthorized("wallet signature could not be verified");
    }

    let user = await findByWallet(address);
    let created = false;

    if (!user) {
      const wallet = normalizeWallet(address);
      const baseId = `wallet-${wallet.slice(2, 12)}`;
      let id = baseId;
      let suffix = 1;
      while (await prisma.user.findUnique({ where: { id } })) {
        id = `${baseId}-${suffix++}`;
      }
      const isConfiguredAdmin = config.adminWallets.includes(wallet);
      const isFirstUser = (await prisma.user.count()) === 0;
      user = await prisma.user.create({
        data: {
          id,
          name: name ?? defaultNameForWallet(address),
          role: isConfiguredAdmin || isFirstUser ? "admin" : role ?? "consumer",
          walletAddress: address,
        },
      });
      created = true;
    } else if (name && name !== user.name) {
      user = await prisma.user.update({ where: { id: user.id }, data: { name } });
    }

    const token = issueAuthToken(user);
    res.status(created ? 201 : 200).json({
      token,
      user: publicUser(user),
      created,
    });
  }),
);

authRouter.get(
  "/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user!) });
  }),
);
