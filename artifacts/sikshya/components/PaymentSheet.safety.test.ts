import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, "PaymentSheet.tsx"), "utf8");

test("Fadko never collects wallet credentials inside the app", () => {
  assert.doesNotMatch(source, /TextInput/);
  assert.doesNotMatch(source, /pay-mobile|pay-pin/);
  assert.doesNotMatch(source, /secureTextEntry/);
  assert.doesNotMatch(source, /256-bit SSL|No redirect/);
  assert.match(source, /never ask for your eSewa or Khalti MPIN/);
});

test("the sheet describes provider selection without inventing a payment receipt", () => {
  assert.match(source, /Continue with \$\{meta\.name\}/);
  assert.match(source, /booking confirmation, not a wallet receipt/);
  assert.doesNotMatch(source, /Payment Successful|paid via/);
});

test("server acceptance is awaited before confirmation", () => {
  assert.match(source, /await onSuccess\(method\)/);
  assert.ok(source.indexOf("await onSuccess(method)") < source.indexOf('setStage("done")'));
});
