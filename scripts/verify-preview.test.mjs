import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundlePaths, verifyPreview } from "./verify-preview.mjs";

const apiUrl = "https://hometuition-api-staging-production.up.railway.app";
const previewUrl = "https://hometuition-preview.example.workers.dev";
const html =
  '<script src="/_expo/static/js/web/__common-123.js" defer></script><script src="/_expo/static/js/web/entry-456.js" defer></script>';

test("accepts split Metro runtime/entry names, not only index", () => {
  assert.deepEqual(bundlePaths(html), [
    "_expo/static/js/web/__common-123.js",
    "_expo/static/js/web/entry-456.js",
  ]);
  assert.throws(() =>
    bundlePaths('<script src="/../../elsewhere.js"></script>'),
  );
  assert.throws(() => bundlePaths("<html></html>"));
});

for (const mode of [
  "correct",
  "old-html",
  "wrong-bytes",
  "production",
  "missing-api",
  "unavailable",
  "lazy-correct",
  "lazy-production",
  "lazy-stale",
  "foreign-api",
]) {
  test(`preview verification: ${mode}`, async () => {
    const buildDir = await mkdtemp(
      path.join(tmpdir(), "sikshya-preview-test-"),
    );
    try {
      const common =
        mode === "production"
          ? `${apiUrl} workspaceapi-server-production-5a63.up.railway.app`
          : mode === "missing-api"
            ? "no API"
            : apiUrl;
      await mkdir(path.join(buildDir, "_expo/static/js/web"), {
        recursive: true,
      });
      await writeFile(path.join(buildDir, "index.html"), html);
      await writeFile(
        path.join(buildDir, "_expo/static/js/web/__common-123.js"),
        common,
      );
      await writeFile(
        path.join(buildDir, "_expo/static/js/web/entry-456.js"),
        "entry",
      );
      const lazy = mode === "lazy-production"
        ? "wss://workspaceapi-server-production-5a63.up.railway.app/api/ws"
        : mode === "foreign-api" ? "https://another-api.up.railway.app" : "lazy";
      if (mode.startsWith("lazy-") || mode === "foreign-api") {
        await writeFile(path.join(buildDir, "_expo/static/js/web/lazy-789.js"), lazy);
      }
      const fetchImpl = async (url) => {
        const body =
          url.pathname === "/"
            ? mode === "old-html"
              ? html.replace("456", "789")
              : html
            : url.pathname.includes("lazy-")
              ? mode === "lazy-stale" ? "older lazy content" : lazy
            : url.pathname.includes("__common")
              ? common
              : mode === "wrong-bytes"
                ? "stale entry"
                : "entry";
        return new Response(body, {
          status: mode === "unavailable" ? 503 : 200,
        });
      };
      const run = () =>
        verifyPreview({ buildDir, previewUrl, apiUrl, fetchImpl });
      if (mode === "correct") assert.equal((await run()).assets.length, 2);
      else if (mode === "lazy-correct") assert.equal((await run()).assets.length, 3);
      else await assert.rejects(run);
    } finally {
      await rm(buildDir, { recursive: true, force: true });
    }
  });
}
