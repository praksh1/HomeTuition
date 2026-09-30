const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertBundleTargets } = require("./build-targets.cjs");

const staging = "https://hometuition-api-staging-production.up.railway.app";
const production = "https://workspaceapi-server-production-5a63.up.railway.app";
const chunk = (source, name = "entry.js") => ({ source, name });

test("accepts matching HTTP and WebSocket targets across chunks", () => {
  assert.doesNotThrow(() => assertBundleTargets([
    chunk(`const http = '${staging}'`),
    chunk(`const ws = '${staging.replace(/^http/, "ws")}'`, "lazy.js"),
  ], `${staging}/`));
});

for (const transport of [production, production.replace(/^http/, "ws")]) {
  test(`rejects staging HTTP plus stale ${transport.split(":")[0]} in the same chunk`, () => {
    assert.throws(() => assertBundleTargets([chunk(`${staging} ${transport}`)], staging), /Mixed API targets/);
  });
  test(`rejects stale ${transport.split(":")[0]} in a separate lazy chunk`, () => {
    assert.throws(() => assertBundleTargets([
      chunk(staging), chunk(transport, "lazy.js"),
    ], staging), /Mixed API targets in lazy.js/);
  });
}

test("rejects escaped or bare foreign Railway hosts", () => {
  assert.throws(() => assertBundleTargets([
    chunk(`${staging} ${production.replaceAll("/", "\\/")}`),
  ], staging), /Mixed API targets/);
  assert.throws(() => assertBundleTargets([
    chunk(`${staging} another-api.up.railway.app`),
  ], staging), /Mixed API targets/);
});

test("requires the requested target and actual emitted JavaScript", () => {
  assert.throws(() => assertBundleTargets([], staging), /no JavaScript/);
  assert.throws(() => assertBundleTargets([chunk("no API")], staging), /requested API target/);
});

test("permits unrelated asset, video and AI origins", () => {
  assert.doesNotThrow(() => assertBundleTargets([
    chunk(`${staging} https://assets.example.com wss://class.livekit.cloud https://ai.example.com`),
  ], staging));
});

test("single-origin and local builds cannot silently retain a Railway API", () => {
  for (const expected of ["localhost:8080", "https://api.example.com"]) {
    assert.doesNotThrow(() => assertBundleTargets([chunk(expected)], expected));
    assert.throws(() => assertBundleTargets([chunk(`${expected} ${production}`)], expected), /Mixed API targets/);
  }
});
