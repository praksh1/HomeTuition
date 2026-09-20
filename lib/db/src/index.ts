import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // node-postgres defaults to waiting forever for both a new connection and a query. If the
  // database is restarting, that default turns every signed-in app launch into an endless
  // `/auth/me` request even though the API process itself is answering health checks.
  connectionTimeoutMillis: 5_000,
  query_timeout: 15_000,
  statement_timeout: 15_000,
  idle_in_transaction_session_timeout: 15_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 5_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
