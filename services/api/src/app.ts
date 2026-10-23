import cors from "cors";
import express from "express";
import { config } from "./config";
import { errorHandler } from "./errors";
import { authRouter } from "./routes/auth";
import { certificatesRouter } from "./routes/certificates";
import { chainRouter } from "./routes/chain";
import { claimsRouter } from "./routes/claims";
import { facilitiesRouter } from "./routes/facilities";
import { marketplaceRouter } from "./routes/marketplace";
import { readingsRouter } from "./routes/readings";
import { setupRouter } from "./routes/setup";
import { systemRouter } from "./routes/system";
import { tradesRouter } from "./routes/trades";
import { verificationRouter } from "./routes/verification";

export function createApp(): express.Express {
  const app = express();

  app.use(
    cors({
      origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
    }),
  );
  app.use(express.json({ limit: "5mb" }));
  app.use(
    express.text({
      type: ["text/csv", "text/plain"],
      limit: "5mb",
    }),
  );

  app.use("/api", authRouter);
  app.use("/api", systemRouter);
  app.use("/api/chain", chainRouter);
  app.use("/api", facilitiesRouter);
  app.use("/api", readingsRouter);
  app.use("/api", certificatesRouter);
  app.use("/api", setupRouter);
  app.use("/api", claimsRouter);
  app.use("/api", verificationRouter);
  app.use("/api", marketplaceRouter);
  app.use("/api", tradesRouter);

  app.use(errorHandler);

  return app;
}
