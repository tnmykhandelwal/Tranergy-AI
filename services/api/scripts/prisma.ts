import { spawnSync } from "node:child_process";
import path from "node:path";
import { config } from "../src/config";

const apiRoot = path.resolve(__dirname, "..");
const result = spawnSync("npx", ["prisma", ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: apiRoot,
  env: { ...process.env, DATABASE_URL: config.DATABASE_URL },
});
process.exit(result.status ?? 1);
