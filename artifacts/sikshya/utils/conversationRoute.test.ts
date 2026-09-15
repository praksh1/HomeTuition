import assert from "node:assert/strict";
import test from "node:test";
import { classConversationDestination, classConversationId } from "./conversationRoute.ts";

test("class conversations write one canonical parameter and still read old links", () => {
  assert.deepEqual(classConversationDestination(18), { pathname: "/class-chat", params: { id: "18" } });
  assert.equal(classConversationId({ id: "18" }), 18);
  assert.equal(classConversationId({ batchId: "19" }), 19);
  assert.equal(classConversationId({ id: ["20", "21"] }), 20);
});

test("an incomplete class-conversation link never becomes NaN in an API path", () => {
  assert.equal(classConversationId({}), null);
  assert.equal(classConversationId({ id: "NaN" }), null);
  assert.equal(classConversationId({ id: "0" }), null);
  assert.equal(classConversationId({ id: "2.5" }), null);
});
