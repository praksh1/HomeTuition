import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../../../lib/db/src/schema";

// The runner verifies the staging service and creates this schema before starting us.
// Deliberately no `public` fallback: every unqualified production query stays synthetic.
const name = process.env.COST_HEALTH_TEST_SCHEMA;
if (!name || !/^fadko_cost_health_test_[a-f0-9]{32}$/.test(name)) {
  throw Error("An isolated cost-health test schema is required");
}
const pg = require("pg");
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${name}`,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 15_000,
});
export const db = drizzle(pool, { schema });
export * from "../../../../lib/db/src/schema";
