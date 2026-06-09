import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as schema from "./schema.js";

// Load the project's .env regardless of the caller's cwd (so the global
// `oversteer` CLI works from any directory). process.loadEnvFile is built into
// Node 21+. Missing .env is fine — we fall back to the default below.
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
  process.loadEnvFile(join(projectRoot, ".env"));
} catch {
  // no .env present; rely on ambient env or the default connection string
}

const connectionString =
  process.env.DATABASE_URL ?? "postgres://yilongli@localhost:5432/oversteer";

const pool = new pg.Pool({ connectionString });

export const db = drizzle(pool, { schema });
export { pool };
