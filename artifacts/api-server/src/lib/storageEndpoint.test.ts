import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveEndpoint } from "./storageEndpoint.ts";

const ACCOUNT = "abc123def456abc123def456abc123de"; // 32 hex, the shape Cloudflare issues

test("a bare account id becomes the endpoint Cloudflare documents", () => {
  const { endpoint, note } = resolveEndpoint(ACCOUNT, "");
  assert.equal(endpoint, `https://${ACCOUNT}.r2.cloudflarestorage.com`);
  assert.equal(note, null);
});

/**
 * The failure the owner actually hit. Cloudflare's bucket page shows an "S3 API" value ending
 * in the bucket name, and pasting it into R2_ACCOUNT_ID built `https://https://…` — a URL whose
 * hostname is the literal string `https`, reported as `getaddrinfo ENOTFOUND https`.
 */
test("a full URL pasted into the account id is used as the endpoint, not glued into one", () => {
  const { endpoint, note } = resolveEndpoint(`https://${ACCOUNT}.r2.cloudflarestorage.com/hometuition`, "");
  assert.equal(endpoint, `https://${ACCOUNT}.r2.cloudflarestorage.com`);
  assert.match(String(note), /full URL/i);
  // The specific wreckage this replaces.
  assert.doesNotMatch(endpoint, /https:\/\/https/);
  assert.equal(new URL(endpoint).hostname, `${ACCOUNT}.r2.cloudflarestorage.com`);
});

test("and the bucket on the end of it is dropped rather than sent as part of the host", () => {
  const { endpoint } = resolveEndpoint(`https://${ACCOUNT}.r2.cloudflarestorage.com/hometuition`, "");
  assert.doesNotMatch(endpoint, /hometuition/);
});

test("a hostname with no scheme is given one", () => {
  const { endpoint, note } = resolveEndpoint(`${ACCOUNT}.r2.cloudflarestorage.com`, "");
  assert.equal(endpoint, `https://${ACCOUNT}.r2.cloudflarestorage.com`);
  assert.match(String(note), /hostname/i);
});

test("an explicit endpoint wins over the account id", () => {
  const { endpoint } = resolveEndpoint(ACCOUNT, "https://somewhere.example.com");
  assert.equal(endpoint, "https://somewhere.example.com");
  // The local stand-in the upload tests point at must keep working, port and all.
  assert.equal(resolveEndpoint("", "http://127.0.0.1:9401").endpoint, "http://127.0.0.1:9401");
});

test("but is cleaned too, because the same paste lands there just as easily", () => {
  const withBucket = resolveEndpoint("", `https://${ACCOUNT}.r2.cloudflarestorage.com/hometuition`);
  assert.equal(withBucket.endpoint, `https://${ACCOUNT}.r2.cloudflarestorage.com`);
  assert.match(String(withBucket.note), /path/i);

  const noScheme = resolveEndpoint("", `${ACCOUNT}.r2.cloudflarestorage.com`);
  assert.equal(noScheme.endpoint, `https://${ACCOUNT}.r2.cloudflarestorage.com`);
  assert.match(String(noScheme.note), /https:\/\//);
});

test("a trailing slash never becomes part of the host", () => {
  assert.equal(resolveEndpoint("", "https://somewhere.example.com/").endpoint, "https://somewhere.example.com");
  assert.equal(resolveEndpoint("", "somewhere.example.com/").endpoint, "https://somewhere.example.com");
});

test("an account id of the wrong shape is flagged but still tried", () => {
  const { endpoint, note } = resolveEndpoint("my-account", "");
  assert.equal(endpoint, "https://my-account.r2.cloudflarestorage.com");
  assert.match(String(note), /32-character/);
});

test("nothing set at all resolves to nothing, so uploads report themselves unconfigured", () => {
  assert.equal(resolveEndpoint("", "").endpoint, "");
  assert.equal(resolveEndpoint("   ", "  ").endpoint, "");
});

test("every endpoint it returns is a URL whose hostname is not 'https'", () => {
  const inputs: [string, string][] = [
    [ACCOUNT, ""],
    [`https://${ACCOUNT}.r2.cloudflarestorage.com`, ""],
    [`https://${ACCOUNT}.r2.cloudflarestorage.com/bucket`, ""],
    [`${ACCOUNT}.r2.cloudflarestorage.com`, ""],
    ["my-account", ""],
    ["", "https://somewhere.example.com/bucket"],
    ["", "somewhere.example.com"],
    ["", "http://127.0.0.1:9401"],
  ];
  for (const [account, endpointSetting] of inputs) {
    const { endpoint } = resolveEndpoint(account, endpointSetting);
    const url = new URL(endpoint);
    assert.notEqual(url.hostname, "https", `${account} / ${endpointSetting}`);
    assert.ok(url.hostname.length > 3, `${account} / ${endpointSetting} gave host ${url.hostname}`);
    // A path here means the bucket would appear twice in every request.
    assert.equal(url.pathname, "/", `${account} / ${endpointSetting} kept a path`);
  }
});
