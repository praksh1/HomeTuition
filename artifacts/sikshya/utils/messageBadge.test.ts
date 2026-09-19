import assert from "node:assert/strict";
import test from "node:test";
import { messageBadgeNeedsRefresh } from "./messageBadge.ts";

test("direct and class message nudges refresh the floating badge immediately", () => {
  assert.equal(messageBadgeNeedsRefresh("conversation_sync"), true);
  assert.equal(messageBadgeNeedsRefresh("message"), true);
  assert.equal(messageBadgeNeedsRefresh("class_message"), true);
});

test("a read on another signed-in device refreshes the badge too", () => {
  assert.equal(messageBadgeNeedsRefresh("notification_read"), true);
});

test("unrelated live news does not spend a badge request", () => {
  assert.equal(messageBadgeNeedsRefresh("session_live"), false);
  assert.equal(messageBadgeNeedsRefresh("class_homework_set"), false);
  assert.equal(messageBadgeNeedsRefresh(undefined), false);
});
