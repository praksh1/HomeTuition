import assert from "node:assert/strict";
import test from "node:test";
import { shouldSendMessageOnKey } from "./messageComposer.ts";

test("desktop Enter sends while Shift+Enter keeps a new line", () => {
  assert.equal(shouldSendMessageOnKey("web", "Enter"), true);
  assert.equal(shouldSendMessageOnKey("web", "Enter", true), false);
  assert.equal(shouldSendMessageOnKey("web", "a"), false);
});

test("mobile return keys and active input-method composition are never intercepted", () => {
  assert.equal(shouldSendMessageOnKey("ios", "Enter"), false);
  assert.equal(shouldSendMessageOnKey("android", "Enter"), false);
  assert.equal(shouldSendMessageOnKey("web", "Enter", false, true), false);
});
