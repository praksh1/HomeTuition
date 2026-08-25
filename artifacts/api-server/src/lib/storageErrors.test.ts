import assert from "node:assert/strict";
import { test } from "node:test";

import { describeStorageFailure } from "./storageErrors.ts";

/**
 * The errors these are built from are shaped the way the AWS SDK actually throws them: a
 * `name` carrying the S3 error code, a `message`, and `$metadata.httpStatusCode`. Inventing a
 * friendlier shape here would test nothing about the code that has to read the real one.
 */
const sdkError = (name: string, message: string, httpStatusCode = 403) =>
  Object.assign(new Error(message), { name, $metadata: { httpStatusCode } });

test("a read-only token is named as one, because trying again will never fix it", () => {
  const failure = describeStorageFailure(sdkError("AccessDenied", "Access Denied"));
  assert.equal(failure.code, "AccessDenied");
  assert.match(failure.advice, /Object Read & Write/);
  // The owner is told what to change; the student is not shown configuration advice.
  assert.doesNotMatch(failure.publicMessage, /token|bucket|R2_/i);
});

test("a wrong key and a wrong secret are told apart", () => {
  const badKey = describeStorageFailure(sdkError("InvalidAccessKeyId", "The key id does not exist"));
  assert.match(badKey.advice, /R2_ACCESS_KEY_ID/);

  const badSecret = describeStorageFailure(sdkError("SignatureDoesNotMatch", "signature mismatch"));
  assert.match(badSecret.advice, /R2_SECRET_ACCESS_KEY/);
  // The two must not give the same advice — that is the whole reason for separating them.
  assert.notEqual(badKey.advice, badSecret.advice);
});

test("a missing bucket points at the bucket name, not at the credentials", () => {
  const failure = describeStorageFailure(sdkError("NoSuchBucket", "The specified bucket does not exist", 404));
  assert.match(failure.advice, /R2_BUCKET/);
  assert.doesNotMatch(failure.advice, /ACCESS_KEY|SECRET/);
});

test("an endpoint that does not match the account points at the account id", () => {
  for (const code of ["PermanentRedirect", "AuthorizationHeaderMalformed"]) {
    const failure = describeStorageFailure(sdkError(code, "wrong endpoint", 301));
    assert.match(failure.advice, /R2_ACCOUNT_ID/, code);
  }
});

test("a hostname that does not resolve is not reported as a refusal", () => {
  const failure = describeStorageFailure(
    Object.assign(new Error("getaddrinfo ENOTFOUND abc.r2.cloudflarestorage.com"), { name: "Error" }),
  );
  assert.match(failure.advice, /R2_ACCOUNT_ID/);
  // A student should be told we could not reach storage, not that we could not save the file:
  // the first is true and temporary-sounding, the second invites them to retry into a wall.
  assert.match(failure.publicMessage, /could not reach/i);
});

test("an unrecognised refusal still carries its code rather than a shrug", () => {
  const failure = describeStorageFailure(sdkError("EntityTooLarge", "Your proposed upload exceeds", 400));
  assert.equal(failure.code, "EntityTooLarge");
  assert.match(failure.advice, /EntityTooLarge/);
  assert.match(failure.advice, /400/);
});

test("nothing key-shaped survives into the detail a log will keep", () => {
  // An access key id is 20 uppercase alphanumerics; a secret is long and base64-ish. S3 echoes
  // the key id back in this error, and the message goes to a log a support agent may read.
  const failure = describeStorageFailure(
    sdkError("InvalidAccessKeyId", "The AWS Access Key Id AKIAIOSFODNN7EXAMPLE and secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEYzz does not exist"),
  );
  assert.doesNotMatch(failure.detail, /AKIAIOSFODNN7EXAMPLE/);
  assert.doesNotMatch(failure.detail, /wJalrXUtnFEMI/);
  assert.match(failure.detail, /\[redacted\]/);
  // The surrounding words survive, so the message still reads as a sentence.
  assert.match(failure.detail, /does not exist/);
});

test("every failure gives the owner something to change and the user something to read", () => {
  const codes = [
    "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch",
    "NoSuchBucket", "PermanentRedirect", "AuthorizationHeaderMalformed", "SomethingNew",
  ];
  for (const code of codes) {
    const failure = describeStorageFailure(sdkError(code, "x"));
    assert.ok(failure.advice.length > 20, `${code} advice`);
    assert.ok(failure.publicMessage.length > 20, `${code} public`);
    // The public message never names an environment variable.
    assert.doesNotMatch(failure.publicMessage, /R2_/, `${code} leaked a setting name`);
  }
});
