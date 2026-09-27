import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../../../lib/db/src/schema";
// The test bundle supplies a createRequire anchored to the workspace DB package.
const pg = require("pg");
const name = process.env.IDENTITY_TEST_SCHEMA;
if (!name || !/^fadko_identity_test_[a-f0-9]{32}$/.test(name)) throw Error("Isolated schema required");
// Deliberately no public fallback. All application queries resolve only this synthetic schema.
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${name}`, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
export const db = drizzle(pool, { schema });
export * from "../../../../lib/db/src/schema";
