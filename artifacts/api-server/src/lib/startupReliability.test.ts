import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dbSource = readFileSync(new URL("../../../../lib/db/src/index.ts", import.meta.url), "utf8");
const healthSource = readFileSync(new URL("../routes/health.ts", import.meta.url), "utf8");
const railway = JSON.parse(readFileSync(new URL("../../../../railway.json", import.meta.url), "utf8")) as {
  deploy?: { healthcheckPath?: string; healthcheckTimeout?: number };
};

test("database waits are bounded at both connection and query layers", () => {
  assert.match(dbSource, /connectionTimeoutMillis:\s*5_000/);
  assert.match(dbSource, /query_timeout:\s*15_000/);
  assert.match(dbSource, /statement_timeout:\s*15_000/);
});

test("Railway only switches traffic after the API can reach its database", () => {
  assert.equal(railway.deploy?.healthcheckPath, "/api/readyz");
  assert.equal(railway.deploy?.healthcheckTimeout, 60);
  assert.match(healthSource, /pool\.query\("select 1 as ready"\)/);
  assert.match(healthSource, /status\(503\)/);
});
