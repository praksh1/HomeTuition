import assert from "node:assert/strict";
import { test } from "node:test";
import { showsOwnChatTab } from "./classroomChat.ts";

test("the web uses the classroom's slide-over chat", () => {
  assert.equal(showsOwnChatTab("web"), true);
});

test("the installed apps use the same classroom chat", () => {
  assert.equal(showsOwnChatTab("ios"), true);
  assert.equal(showsOwnChatTab("android"), true);
});

test("anything unfamiliar keeps the chat rather than losing it", () => {
  // A new platform inherits the one socket conversation rather than silently losing chat.
  assert.equal(showsOwnChatTab("windows"), true);
  assert.equal(showsOwnChatTab(""), true);
});
