import { execSync } from "node:child_process";
import path from "node:path";
import { resolveTestDatabaseUrl } from "./db-url";

export function setup(): void {
  const apiRoot = path.resolve(__dirname, "..");
  execSync("npx prisma db push --force-reset --skip-generate", {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: resolveTestDatabaseUrl() },
    stdio: "inherit",
  });
}
