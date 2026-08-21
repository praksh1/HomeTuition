import assert from "node:assert/strict";
import { test } from "node:test";
import { showsOwnChatTab } from "./classroomChat.ts";

test("the web hides its own chat, because the call already has one", () => {
  assert.equal(showsOwnChatTab("web"), false);
});

test("the installed apps keep it, because there it is the only chat there is", () => {
  // Daily's chat is a Prebuilt panel and Prebuilt is the web experience. The native SDK behind
  // this app's own call interface has no panels, so removing this tab there would leave a
  // student on a phone with no way to ask a question at all.
  assert.equal(showsOwnChatTab("ios"), true);
  assert.equal(showsOwnChatTab("android"), true);
});

test("anything unfamiliar keeps the chat rather than losing it", () => {
  // Erring towards a duplicate conversation rather than towards none: a second chat is
  // confusing, and no chat is a student who cannot speak.
  assert.equal(showsOwnChatTab("windows"), true);
  assert.equal(showsOwnChatTab(""), true);
});
