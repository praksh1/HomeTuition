/** Real PostgreSQL, isolated synthetic schema; storage is simulated, NEVER real R2.
 * Run with verified staging Railway variables: railway run --service <staging-id> -- node scripts/identity-db/run.mjs
 * Refuses any other service/app target. Does not start the API or enable collection.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const dbRequire = createRequire(path.join(repo, "lib/db/package.json"));
const { Pool } = dbRequire("pg");
if (process.env.RAILWAY_SERVICE_ID !== "cc10a94f-b24b-47bc-ae5c-ec2a9307cfa0"
  || process.env.PUBLIC_APP_URL !== "https://hometuition-preview.praksh-dhakal.workers.dev"
  || !process.env.DATABASE_URL || process.env.IDENTITY_COLLECTION_ENABLED === "true") {
  throw Error("Refusing integration tests: isolated staging service with collection disabled is required.");
}
const schema = `fadko_identity_test_${randomUUID().replaceAll("-", "")}`;
if (!/^fadko_identity_test_[a-f0-9]{32}$/.test(schema)) throw Error("Invalid test schema");
// Neon transaction pooling rejects session search_path. Use the SAME endpoint's direct
// connection only for this isolated suite, without modifying Railway's application URL.
const connection = new URL(process.env.DATABASE_URL);
if (!connection.hostname.endsWith(".neon.tech")) throw Error("Expected verified Neon staging database");
connection.hostname = connection.hostname.replace(/-pooler\./, ".");
connection.searchParams.set("sslmode", "verify-full");
const pool = new Pool({ connectionString: connection.href, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
const temp = await mkdtemp(path.join(os.tmpdir(), "fadko-identity-db-"));
let created = false;
try {
  await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
  // No production/public tables, real account IDs, or real ID content are copied.
  await pool.query(`CREATE TABLE "${schema}".users (id integer PRIMARY KEY)`);
  await pool.query(`INSERT INTO "${schema}".users (id) VALUES (1), (2)`);
  const outfile = path.join(temp, "checks.mjs");
  await build({ entryPoints: [path.join(here,"checks.ts")], outfile, bundle: true, platform: "node", format: "esm",
    external: ["pg-native"], logLevel: "silent",
    banner: { js: `import { createRequire as testRequire } from 'node:module'; const require = testRequire(${JSON.stringify(path.join(repo,"lib/db/package.json"))});` },
    plugins: [{ name: "isolated-identity-test-adapters", setup(b) {
      b.onResolve({ filter: /^pg$/ }, () => ({ path: dbRequire.resolve("pg") }));
      b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: path.join(here,"database.ts") }));
      b.onResolve({ filter: /(^|\/)identityFiles$/ }, () => ({ path: path.join(here,"storage.ts") }));
    }}],
  });
  const run = spawnSync(process.execPath, [outfile], { stdio: "inherit", timeout: 180000,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: connection.href,
      IDENTITY_TEST_SCHEMA: schema, NODE_ENV: "production", SESSION_SECRET: randomUUID(),
      IDENTITY_ENCRYPTION_KEY_V1: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "") } });
  if (run.status !== 0) process.exitCode = 1;
} catch (error) {
  // Do not echo connection strings or server error detail containing private configuration.
  console.error("Identity DB suite failed", error?.code ?? error?.name ?? "unknown"); process.exitCode = 1;
} finally {
  try {
    if (created) { await pool.query(`DROP SCHEMA "${schema}" CASCADE`); console.log("Removed synthetic identity test schema."); }
  } catch { console.error(`Cleanup required for isolated schema ${schema}`); process.exitCode = 1; }
  await pool.end();
  await rm(temp, { recursive: true, force: true }); // Exact mkdtemp-owned build directory only.
}
