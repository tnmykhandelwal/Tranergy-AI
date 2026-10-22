import { Router } from "express";
import { asyncHandler } from "../errors";
import { getChainStatus } from "../services/chain";

export const chainRouter = Router();

chainRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    res.json(await getChainStatus());
  }),
);
