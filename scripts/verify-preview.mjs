import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const productionApi = "workspaceapi-server-production-5a63.up.railway.app";

export function bundlePaths(html) {
  const paths = [
    ...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi),
  ].map((match) => match[1].replace(/^\//, ""));
  assert(paths.length > 0, "HTML has no JavaScript bundles");
  for (const asset of paths) {
    assert(
      /^_expo\/static\/js\/web\/[\w-]+\.js$/.test(asset),
      `Unexpected bundle path: ${asset}`,
    );
  }
  return paths;
}

/** Verify the HTML users receive AND every initial bundle, including Metro's shared chunk. */
export async function verifyPreview({
  buildDir,
  previewUrl,
  apiUrl,
  fetchImpl = fetch,
}) {
  const preview = new URL(previewUrl);
  const api = new URL(apiUrl);
  assert(
    preview.protocol === "https:" &&
      preview.hostname.startsWith("hometuition-preview."),
    "Not the isolated preview Worker",
  );
  assert(
    api.protocol === "https:" &&
      !api.hostname.endsWith("workers.dev") &&
      api.hostname !== productionApi,
    "Not a staging API",
  );
  const localHtml = await readFile(path.join(buildDir, "index.html"), "utf8");
  const assets = bundlePaths(localHtml);
  async function remote(relative) {
    const response = await fetchImpl(new URL(relative, preview), {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    assert.equal(response.status, 200, `HTTP failure: ${relative}`);
    return Buffer.from(await response.arrayBuffer());
  }
  const servedHtml = await remote("/");
  assert.deepEqual(
    bundlePaths(servedHtml.toString()),
    assets,
    "Served HTML points to a different build",
  );
  let foundApi = false;
  const fingerprint = (bytes) =>
    createHash("sha256").update(bytes).digest("hex");
  for (const asset of assets) {
    const local = await readFile(path.join(buildDir, asset));
    const served = await remote(`/${asset}`);
    assert.equal(
      fingerprint(served),
      fingerprint(local),
      `Bundle content differs: ${asset}`,
    );
    assert(!served.includes(productionApi), `Production API in ${asset}`);
    foundApi ||= served.includes(apiUrl.replace(/\/+$/, ""));
  }
  assert(foundApi, "No served initial bundle contains the staging API");
  return { assets, apiUrl, previewUrl };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [previewUrl, apiUrl] = process.argv.slice(2);
  const result = await verifyPreview({
    buildDir: "artifacts/sikshya/web-build",
    previewUrl,
    apiUrl,
  });
  console.log(
    `Verified served HTML and ${result.assets.length} exact bundles against ${result.apiUrl}`,
  );
}
