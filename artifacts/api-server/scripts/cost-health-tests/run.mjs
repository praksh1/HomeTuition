/** Real PostgreSQL + actual cost-health HTTP route, isolated in a disposable schema.
 * Run only with: railway run --service hometuition-api-staging -- node scripts/cost-health-tests/run.mjs
 * No provider or email network calls occur; those adapters are synthetic.
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
const stagingServiceId = "cc10a94f-b24b-47bc-ae5c-ec2a9307cfa0";
const stagingUrl = "https://hometuition-preview.praksh-dhakal.workers.dev";
if (process.env.RAILWAY_SERVICE_ID !== stagingServiceId || process.env.PUBLIC_APP_URL !== stagingUrl ||
    !process.env.DATABASE_URL) {
  throw Error("Refusing cost-health integration tests: verified staging service and database are required.");
}
const connection = new URL(process.env.DATABASE_URL);
if (connection.protocol !== "postgres:" && connection.protocol !== "postgresql:") throw Error("Expected PostgreSQL staging database");
if (!connection.hostname.endsWith(".neon.tech")) throw Error("Expected Neon staging database");
// Neon transaction pooling does not retain the child process's session search_path.
// The direct endpoint remains the same database, and only a random test schema is touched.
connection.hostname = connection.hostname.replace(/-pooler\./, ".");
connection.searchParams.set("sslmode", "verify-full");
const schema = `fadko_cost_health_test_${randomUUID().replaceAll("-", "")}`;
if (!/^fadko_cost_health_test_[a-f0-9]{32}$/.test(schema)) throw Error("Invalid test schema");
const pool = new Pool({ connectionString: connection.href, connectionTimeoutMillis: 5_000, statement_timeout: 15_000 });
const temp = await mkdtemp(path.join(os.tmpdir(), "fadko-cost-health-"));
let created = false;
try {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  await pool.query(`CREATE TABLE "${schema}".users (
    id serial PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, role text NOT NULL,
    password_hash text NOT NULL, suspended_at timestamptz, suspended_reason text,
    suspended_by integer, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE "${schema}".operator_accounts (
    id serial PRIMARY KEY, user_id integer NOT NULL UNIQUE REFERENCES "${schema}".users(id) ON DELETE CASCADE,
    login_id text NOT NULL UNIQUE, is_administrator boolean NOT NULL DEFAULT false,
    must_change_password boolean NOT NULL DEFAULT true, created_by integer REFERENCES "${schema}".users(id),
    disabled_at timestamptz, disabled_by integer REFERENCES "${schema}".users(id),
    last_sign_in_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`);
  const outfile = path.join(temp, "checks.mjs");
  const mocks = path.join(here, "mocks.ts");
  await build({ entryPoints: [path.join(here, "checks.ts")], outfile, bundle: true, platform: "node", format: "esm",
    external: ["pg-native"], logLevel: "silent",
    banner: { js: `import { createRequire as testRequire } from 'node:module'; const require = testRequire(${JSON.stringify(path.join(repo, "lib/db/package.json"))});` },
    plugins: [{ name: "cost-health-isolation", setup(b) {
      b.onResolve({ filter: /^pg$/ }, () => ({ path: dbRequire.resolve("pg") }));
      b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: path.join(here, "database.ts") }));
      b.onResolve({ filter: /^(\.\/providers|\.\/health|\.\.\/mailer|\.\.\/logger|\.\.\/lib\/activityLog)$/ }, args => {
        const source = args.importer.replaceAll("\\", "/");
        if (source.includes("/src/lib/costHealth/") || source.endsWith("/src/routes/costHealth.ts")) return { path: mocks };
        return undefined;
      });
    } }],
  });
  const run = spawnSync(process.execPath, [outfile], { stdio: "inherit", timeout: 180_000,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      DATABASE_URL: connection.href, COST_HEALTH_TEST_SCHEMA: schema,
      NODE_ENV: "production", SESSION_SECRET: randomUUID(),
      COST_HEALTH_OWNER_USER_ID: "1", COST_HEALTH_ALERT_EMAIL: "synthetic-owner@example.invalid",
      COST_HEALTH_ENABLED: "true", COST_HEALTH_RAILWAY_API_TOKEN: "do-not-expose-synthetic-secret",
      OPERATOR_SITE_ENFORCEMENT_ENABLED: "false" } });
  if (run.status !== 0) process.exitCode = 1;
} catch (error) {
  // Do not echo a connection string or driver error detail containing private configuration.
  console.error("Cost-health DB suite failed", error?.code ?? error?.name ?? "unknown");
  process.exitCode = 1;
} finally {
  try {
    if (created) { await pool.query(`DROP SCHEMA "${schema}" CASCADE`); console.log("Removed synthetic cost-health test schema."); }
  } catch { console.error(`Cleanup required for isolated schema ${schema}`); process.exitCode = 1; }
  await pool.end();
  await rm(temp, { recursive: true, force: true }); // Exact mkdtemp-owned directory only.
}
