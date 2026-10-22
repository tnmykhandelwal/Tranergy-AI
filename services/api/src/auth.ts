import type { User } from "@prisma/client";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { config } from "./config";
import { prisma } from "./db";
import { forbidden, unauthorized } from "./errors";
import { readAuthToken } from "./walletAuth";

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
    authMethod?: "wallet" | "header";
  }
}

async function loadUser(userId: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id: userId } });
}

function bearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

async function resolveUser(req: Request): Promise<{ user: User; method: "wallet" | "header" } | null> {
  const token = bearerToken(req);
  if (token) {
    const payload = readAuthToken(token);
    if (!payload) return null;
    const user = await loadUser(payload.sub);
    if (!user) return null;
    if (user.walletAddress && user.walletAddress.toLowerCase() !== payload.wallet) return null;
    return { user, method: "wallet" };
  }

  if (!config.ALLOW_HEADER_AUTH) return null;
  const userId = req.header("x-user-id");
  if (!userId) return null;
  const user = await loadUser(userId);
  if (!user) return null;
  return { user, method: "header" };
}

export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  resolveUser(req)
    .then((resolved) => {
      if (!resolved) {
        next(unauthorized("wallet authentication required"));
        return;
      }
      req.user = resolved.user;
      req.authMethod = resolved.method;
      next();
    })
    .catch(next);
};

export function requireRole(...roles: string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    requireAuth(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      const user = req.user;
      if (!user || !roles.includes(user.role)) {
        next(forbidden(`${roles.join(" or ")} role required`));
        return;
      }
      next();
    });
  };
}
