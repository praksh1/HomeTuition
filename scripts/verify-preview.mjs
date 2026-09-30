import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import buildTargets from "../artifacts/sikshya/scripts/build-targets.cjs";

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

/** Verify served HTML AND every emitted JS chunk, including shared and lazy chunks. */
export async function verifyPreview({
  buildDir,
  previewUrl,
  apiUrl,
  fetchImpl = fetch,
  target = "preview",
}) {
  const preview = new URL(previewUrl);
  const api = new URL(apiUrl);
  assert(["preview", "production"].includes(target), "Unknown release target");
  if (target === "production") {
    assert(preview.href === "https://hometuition.praksh-dhakal.workers.dev/", "Not the approved Production Worker");
    assert(api.href === `https://${productionApi}/`, "Not the approved Production API");
  } else {
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
  }
  const localHtml = await readFile(path.join(buildDir, "index.html"), "utf8");
  const initialAssets = bundlePaths(localHtml);
  const jsPath = "_expo/static/js/web";
  const assets = (await readdir(path.join(buildDir, jsPath)))
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => {
      assert(/^[\w-]+\.js$/.test(name), `Unexpected emitted bundle name: ${name}`);
      return `${jsPath}/${name}`;
    });
  assert(initialAssets.every((asset) => assets.includes(asset)), "Initial HTML bundle is missing from export");
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
    initialAssets,
    "Served HTML points to a different build",
  );
  const servedBundles = [];
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
    servedBundles.push({ name: asset, source: served.toString() });
  }
  buildTargets.assertBundleTargets(servedBundles, apiUrl);
  return { assets, apiUrl, previewUrl };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [previewUrl, apiUrl, target = "preview"] = process.argv.slice(2);
  const result = await verifyPreview({
    buildDir: "artifacts/sikshya/web-build",
    previewUrl,
    apiUrl,
    target,
  });
  console.log(
    `Verified served HTML and ${result.assets.length} exact bundles against ${result.apiUrl}`,
  );
}
