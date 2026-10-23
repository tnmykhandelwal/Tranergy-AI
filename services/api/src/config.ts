import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

export const apiRoot = path.resolve(__dirname, "..");

function loadDotEnv(): void {
  const localEnv = path.join(apiRoot, ".env");
  const rootEnv = path.resolve(apiRoot, "../../.env");
  if (fs.existsSync(localEnv)) dotenv.config({ path: localEnv });
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });
}

loadDotEnv();

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((v) => {
    if (typeof v === "boolean") return v;
    return ["1", "true", "yes", "on"].includes(v.toLowerCase());
  });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://127.0.0.1:3000"),
  ML_SERVICE_URL: z.string().url().default("http://127.0.0.1:8000"),
  ENERGY_BUFFER_KWH: z.coerce.number().nonnegative().default(2),
  BALANCE_TOLERANCE_KWH: z.coerce.number().nonnegative().default(5),
  DELIVERY_TOLERANCE_PCT: z.coerce.number().nonnegative().default(10),
  CHAIN_ENABLED: booleanFromEnv.default(true),
  ANVIL_RPC_URL: z.string().url().default("http://127.0.0.1:8545"),
  CONTRACTS_DEPLOYMENT_FILE: z.string().default("../../contracts/deployments/anvil.json"),
  OPERATOR_PRIVATE_KEY: z.string().optional(),
  ATTESTOR_PRIVATE_KEY: z.string().optional(),
  AUTH_SECRET: z.string().min(16).default("tranergy-local-dev-secret-change-me"),
  AUTH_TOKEN_TTL_HOURS: z.coerce.number().positive().default(72),
  ALLOW_HEADER_AUTH: booleanFromEnv.default(process.env.NODE_ENV !== "production"),
  ADMIN_WALLETS: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

function resolveDatabaseUrl(raw: string): string {
  if (!raw.startsWith("file:")) return raw;
  const filePath = raw.slice("file:".length);
  if (filePath.startsWith("/") || filePath.startsWith("file:/")) return raw;
  return `file:${path.resolve(apiRoot, filePath)}`;
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}

if (
  process.env.NODE_ENV === "production" &&
  parsed.data.AUTH_SECRET === "tranergy-local-dev-secret-change-me"
) {
  throw new Error("AUTH_SECRET must be set to a unique value when NODE_ENV=production");
}

const resolvedDatabaseUrl = resolveDatabaseUrl(parsed.data.DATABASE_URL);
process.env.DATABASE_URL = resolvedDatabaseUrl;

export const config: AppConfig & {
  DATABASE_URL: string;
  adminWallets: string[];
  corsOrigins: string[];
} = {
  ...parsed.data,
  API_PORT: Number(process.env.PORT) || parsed.data.API_PORT,
  DATABASE_URL: resolvedDatabaseUrl,
  adminWallets: (parsed.data.ADMIN_WALLETS ?? "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean),
  corsOrigins: (parsed.data.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
};
