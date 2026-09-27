/** Isolated actual HTTP + PostgreSQL + private R2 proof. No deployed collection flag changes.
 * Run under verified staging Railway variables with the dedicated R2 credentials available.
 * Only a synthetic one-pixel PNG and a discarded encryption key cross this test boundary.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { S3Client, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const dbRequire = createRequire(path.join(repo, "lib/db/package.json"));
const { Pool } = dbRequire("pg");
const target = {
  service: "cc10a94f-b24b-47bc-ae5c-ec2a9307cfa0",
  app: "https://hometuition-preview.praksh-dhakal.workers.dev",
  bucket: "fadko-staging-private-identity",
  account: "ede5359f6838749186039c7a4ce2278c",
};
if (process.env.RAILWAY_SERVICE_ID !== target.service || process.env.PUBLIC_APP_URL !== target.app ||
    process.env.IDENTITY_COLLECTION_ENABLED === "true" || process.env.IDENTITY_R2_BUCKET !== target.bucket ||
    process.env.R2_ACCOUNT_ID !== target.account || !process.env.IDENTITY_R2_ACCESS_KEY_ID ||
    !process.env.IDENTITY_R2_SECRET_ACCESS_KEY || !process.env.DATABASE_URL)
  throw Error("Refusing combined test: verified staging database and private bucket with collection off are required.");
const endpoint = process.env.R2_ENDPOINT || `https://${target.account}.r2.cloudflarestorage.com`;
const parsedEndpoint = new URL(endpoint);
if (parsedEndpoint.protocol !== "https:" || parsedEndpoint.hostname !== `${target.account}.r2.cloudflarestorage.com` ||
    parsedEndpoint.username || parsedEndpoint.password)
  throw Error("Refusing combined test: private storage endpoint does not match staging.");
const connection = new URL(process.env.DATABASE_URL);
if (!connection.hostname.endsWith(".neon.tech")) throw Error("Expected verified Neon staging database.");
connection.hostname = connection.hostname.replace(/-pooler\./, ".");
connection.searchParams.set("sslmode", "verify-full");
const schema = `fadko_identity_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: connection.href, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
const storage = new S3Client({
  region: "auto", endpoint, forcePathStyle: true, maxAttempts: 2,
  credentials: {
    accessKeyId: process.env.IDENTITY_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.IDENTITY_R2_SECRET_ACCESS_KEY,
  },
});
const temp = await mkdtemp(path.join(os.tmpdir(), "fadko-identity-combined-"));
let created = false;
try {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  const outfile = path.join(temp, "checks.mjs");
  await build({
    entryPoints: [path.join(here, "checks.ts")], outfile, bundle: true, platform: "node", format: "esm",
    external: ["pg-native"], logLevel: "silent",
    banner: { js: `import { createRequire as testRequire } from 'node:module'; const require = testRequire(${JSON.stringify(path.join(repo, "lib/db/package.json"))});` },
    plugins: [{ name: "isolated-database-only", setup(b) {
      b.onResolve({ filter: /^pg$/ }, () => ({ path: dbRequire.resolve("pg") }));
      b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: path.join(here, "../identity-db/database.ts") }));
    } }],
  });
  const result = spawnSync(process.execPath, [outfile], {
    stdio: "inherit", timeout: 180000,
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      DATABASE_URL: connection.href, IDENTITY_TEST_SCHEMA: schema,
      NODE_ENV: "production", SESSION_SECRET: randomUUID(),
      IDENTITY_COLLECTION_ENABLED: "true", IDENTITY_RETENTION_ENABLED: "true",
      IDENTITY_R2_BUCKET: target.bucket,
      IDENTITY_R2_ACCESS_KEY_ID: process.env.IDENTITY_R2_ACCESS_KEY_ID,
      IDENTITY_R2_SECRET_ACCESS_KEY: process.env.IDENTITY_R2_SECRET_ACCESS_KEY,
      IDENTITY_ENCRYPTION_KEY_V1: randomBytes(32).toString("hex"),
      R2_ACCOUNT_ID: target.account, R2_ENDPOINT: endpoint, R2_BUCKET: process.env.R2_BUCKET,
    },
  });
  if (result.status !== 0) process.exitCode = 1;
} catch (error) {
  console.error("Combined identity check failed", error?.code ?? error?.name ?? "unknown");
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      const tables = await pool.query("SELECT to_regclass($1) AS name", [`${schema}.identity_verifications`]);
      if (tables.rows[0]?.name) {
        const keys = await pool.query(`SELECT file_key FROM "${schema}".identity_verifications WHERE user_id=101 AND file_key IS NOT NULL`);
        for (const row of keys.rows) {
          const key = String(row.file_key);
          if (!/^identity\/101\/[a-f0-9-]{36}\.sealed$/.test(key)) throw Error("Unexpected synthetic object key");
          await storage.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key }), { abortSignal: AbortSignal.timeout(30_000) });
          try {
            await storage.send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }), { abortSignal: AbortSignal.timeout(15_000) });
            throw Error("Synthetic object still exists");
          } catch (error) {
            if (error?.$metadata?.httpStatusCode !== 404) throw error;
          }
        }
        console.log("Removed and confirmed all synthetic private objects.");
      }
    } catch (error) {
      console.error("Private test-object cleanup failed", error?.code ?? error?.name ?? "unknown");
      process.exitCode = 1;
    }
    try {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      console.log("Removed isolated synthetic PostgreSQL schema.");
    } catch {
      console.error(`Manual cleanup required for synthetic schema ${schema}`);
      process.exitCode = 1;
    }
  }
  await pool.end();
  storage.destroy();
  await rm(temp, { recursive: true, force: true });
}
