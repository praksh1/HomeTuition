import { test } from "node:test";
import assert from "node:assert/strict";
import { describeRequest } from "./requestAction.ts";

/**
 * Turning a request into a line an agent can read.
 *
 * Worth testing on its own because the whole claim of "every action is recorded" rests on this
 * deriving something sensible from a route nobody has thought about — including routes that do
 * not exist yet.
 */

test("creating something is named for what it creates", () => {
  assert.deepEqual(describeRequest("POST", "/api/sessions"), {
    action: "session.create", subjectType: null, subjectId: null,
  });
});

test("an action on a particular thing carries its id", () => {
  assert.deepEqual(describeRequest("POST", "/api/sessions/42/book"), {
    action: "session.book", subjectType: "session", subjectId: 42,
  });
});

test("changing a thing is an update, named for the thing", () => {
  assert.deepEqual(describeRequest("PATCH", "/api/sessions/42"), {
    action: "session.update", subjectType: "session", subjectId: 42,
  });
});

test("deleting is a delete", () => {
  assert.deepEqual(describeRequest("DELETE", "/api/messages/7"), {
    action: "message.delete", subjectType: "message", subjectId: 7,
  });
});

test("a deeper path keeps every part of what was done", () => {
  assert.deepEqual(describeRequest("POST", "/api/sessions/9/messages"), {
    action: "session.messages", subjectType: "session", subjectId: 9,
  });
});

test("a route nobody has written yet still produces a sensible line", () => {
  // The point of deriving this rather than hand-writing a call per route: coverage should not
  // depend on somebody remembering.
  assert.deepEqual(describeRequest("POST", "/api/refunds/3/approve"), {
    action: "refund.approve", subjectType: "refund", subjectId: 3,
  });
});

test("a singular collection is not mangled into something odd", () => {
  assert.equal(describeRequest("POST", "/api/auth/login").action, "auth.login");
});

test("a path with no id records no subject rather than a wrong one", () => {
  const { subjectType, subjectId } = describeRequest("POST", "/api/disputes");
  assert.equal(subjectType, null);
  assert.equal(subjectId, null);
});

test("trailing slashes do not produce an empty verb", () => {
  assert.equal(describeRequest("POST", "/api/sessions/").action, "session.create");
});
