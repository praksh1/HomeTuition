import { test } from "node:test";
import assert from "node:assert/strict";
import { identityDocumentType, validIdentityKey, identityStorageReady, identityEncryptionKey } from "./identityFiles.ts";
import { IDENTITY_MAX_BYTES } from "./identityPolicy.ts";

test("identity upload validates byte signatures and size, not filename claims", () => {
  assert.equal(identityDocumentType(Buffer.from("%PDF-synthetic signature fixture")), "application/pdf");
  assert.equal(identityDocumentType(Buffer.from([137,80,78,71,13,10,26,10])), "image/png");
  assert.equal(identityDocumentType(Buffer.from([255,216,255,0])), "image/jpeg");
  for (const bytes of [Buffer.alloc(0), Buffer.from("<script>not a photo</script>"), Buffer.from("PK-not-an-accepted-office-file"), Buffer.alloc(IDENTITY_MAX_BYTES+1)]) assert.equal(identityDocumentType(bytes), null);
});
test("private namespace refuses shared keys, traversal, URLs and malformed object IDs", () => {
  const uuid = "12345678-1234-1234-1234-123456789abc";
  assert.equal(validIdentityKey(`identity/123/${uuid}.sealed`), true);
  for (const key of [`evidence/123/${uuid}.sealed`, `identity/0/${uuid}.sealed`, `identity/123/../${uuid}.sealed`, `https://example.test/identity/123/${uuid}.sealed`, `identity/123/${"-".repeat(36)}.sealed`]) assert.equal(validIdentityKey(key), false);
});
test("storage configuration fails closed without dedicated bucket, key or HTTPS", () => {
  const names = ["IDENTITY_R2_BUCKET", "IDENTITY_R2_ACCESS_KEY_ID", "IDENTITY_R2_SECRET_ACCESS_KEY", "IDENTITY_ENCRYPTION_KEY_V1", "R2_BUCKET", "R2_ENDPOINT"];
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.IDENTITY_R2_BUCKET = "private-test"; process.env.R2_BUCKET = "public-test";
    process.env.IDENTITY_R2_ACCESS_KEY_ID = "synthetic"; process.env.IDENTITY_R2_SECRET_ACCESS_KEY = "synthetic";
    process.env.IDENTITY_ENCRYPTION_KEY_V1 = "ab".repeat(32); process.env.R2_ENDPOINT = "https://example.test";
    assert.equal(identityStorageReady(), true); // construction only; no network
    process.env.IDENTITY_R2_BUCKET = "public-test"; assert.equal(identityStorageReady(), false);
    process.env.IDENTITY_R2_BUCKET = "private-test"; process.env.R2_ENDPOINT = "http://example.test"; assert.equal(identityStorageReady(), false);
    process.env.R2_ENDPOINT = "https://example.test"; delete process.env.IDENTITY_ENCRYPTION_KEY_V1;
    assert.equal(identityStorageReady(), false); assert.throws(() => identityEncryptionKey());
  } finally { for (const name of names) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; } }
});
