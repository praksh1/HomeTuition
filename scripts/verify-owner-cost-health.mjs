/** Read-only check of the exact deployed production artifacts; no owner credentials required. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { bundlePaths } from "./verify-preview.mjs";

const site = "https://hometuition.praksh-dhakal.workers.dev";
const api = "https://workspaceapi-server-production-5a63.up.railway.app";
const build = path.resolve("artifacts/sikshya/web-build");
const fingerprint = bytes => createHash("sha256").update(bytes).digest("hex");
const localHtml = await readFile(path.join(build, "index.html"), "utf8");
const expected = bundlePaths(localHtml);
async function get(url) {
  return fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error", cache: "no-store" });
}
const page = await get(`${site}/cost-health`);
assert.equal(page.status, 200);
assert.deepEqual(bundlePaths(await page.text()), expected, "Live owner route serves a different release");
let hasApi = false;
let hasCostPage = false;
for (const asset of expected) {
  const response = await get(`${site}/${asset}`);
  assert.equal(response.status, 200);
  const live = Buffer.from(await response.arrayBuffer());
  assert.equal(fingerprint(live), fingerprint(await readFile(path.join(build, asset))), `Live asset differs: ${asset}`);
  hasApi ||= live.includes(api);
  hasCostPage ||= live.includes("cost-health-known-spend") && live.includes("Dollar alerts unavailable") && live.includes("Provider watchlist") && live.includes("cost-health-chart-empty") && live.includes("cost-health-panel-settings");
}
assert(hasApi && hasCostPage, "Expected production API or verified cost-page labels missing");
const denied = await get(`${api}/api/owner/cost-health`);
assert.equal(denied.status, 401, "Anonymous access must be rejected");
await denied.body?.cancel();
console.log(`PASS production cost page serves ${expected.length} exact verified bundles`);
console.log("PASS production API target, redesigned dashboard and honest dollar-alert labels present");
console.log("PASS live anonymous owner-data access denied");
