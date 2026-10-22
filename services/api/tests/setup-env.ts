import { resolveTestDatabaseUrl } from "./db-url";

process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.CHAIN_ENABLED = "false";
process.env.ML_SERVICE_URL = "http://127.0.0.1:9";
process.env.ENERGY_BUFFER_KWH = "2";
process.env.BALANCE_TOLERANCE_KWH = "5";
process.env.DELIVERY_TOLERANCE_PCT = "10";
