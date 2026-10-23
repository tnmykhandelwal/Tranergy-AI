import { describe, expect, it } from "vitest";
import { normalizeDatabaseUrl } from "../src/config";

describe("normalizeDatabaseUrl", () => {
  it("leaves direct PostgreSQL connections unchanged", () => {
    const url = "postgresql://postgres:secret@db.example.com:5432/postgres?sslmode=require";
    expect(normalizeDatabaseUrl(url)).toBe(url);
  });

  it("enables PgBouncer mode for transaction-pooler connections", () => {
    const normalized = new URL(
      normalizeDatabaseUrl(
        "postgresql://postgres.project:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
      ),
    );

    expect(normalized.searchParams.get("pgbouncer")).toBe("true");
    expect(normalized.searchParams.get("connection_limit")).toBe("1");
    expect(normalized.searchParams.get("sslmode")).toBe("require");
  });

  it("does not overwrite explicit pooler settings", () => {
    const normalized = new URL(
      normalizeDatabaseUrl(
        "postgresql://user:pass@pooler.example.com:6543/postgres?pgbouncer=false&connection_limit=5",
      ),
    );

    expect(normalized.searchParams.get("pgbouncer")).toBe("false");
    expect(normalized.searchParams.get("connection_limit")).toBe("5");
  });
});
