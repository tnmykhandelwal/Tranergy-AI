import path from "node:path";
import dotenv from "dotenv";

const apiRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(apiRoot, ".env") });
dotenv.config({ path: path.resolve(apiRoot, "../../.env") });

/**
 * Tests run against PostgreSQL. By default they reuse the main DATABASE_URL
 * but point at a dedicated `tranergy_test` schema so they never touch real data.
 * Override with TEST_DATABASE_URL for a fully separate database.
 */
export function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit && explicit.startsWith("postgres")) return explicit;

  const raw = process.env.DATABASE_URL ?? "";
  if (!raw.startsWith("postgres")) {
    throw new Error(
      "Tests require a PostgreSQL DATABASE_URL (e.g. your Supabase connection string) " +
        "or an explicit TEST_DATABASE_URL. Set it in services/api/.env",
    );
  }
  const url = new URL(raw);
  url.search = "?schema=tranergy_test";
  return url.toString();
}
