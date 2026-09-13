import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = readFileSync(path.join(root, "app", "class-home.tsx"), "utf8");
const chat = readFileSync(path.join(root, "app", "class-chat.tsx"), "utf8");
const channel = readFileSync(
  path.join(root, "hooks", "useUserChannel.ts"),
  "utf8",
);
const notifications = readFileSync(
  path.join(root, "context", "NotificationContext.tsx"),
  "utf8",
);
const panel = readFileSync(
  path.join(root, "components", "classes", "BatchTestPanel.tsx"),
  "utf8",
);

test("a booked class opens one coherent class home", () => {
  assert.match(panel, /label="Open class home"/);
  assert.match(panel, /pathname: "\/class-home"/);
  for (const label of [
    "Next lesson",
    "Class messages",
    "Homework",
    "Materials",
    "Help",
  ]) {
    assert.match(home, new RegExp(label, "i"));
  }
});

test("new group tools receive the batch id and never navigate through a Monthly id", () => {
  assert.match(home, /params: \{ id: String\(batchId\) \}/);
  assert.doesNotMatch(
    home + panel,
    /monthly-chat|monthly-homework|recurringId/,
  );
});

test("class home keeps a real next-lesson action and a phone-size touch floor", () => {
  assert.match(home, /pathname: "\/session\/\[id\]"/);
  assert.match(home, /minHeight: 48/);
  assert.match(home, /minHeight: 76/);
});

test("class messages refresh live and clear only after the conversation loads", () => {
  assert.match(channel, /"class_message"/);
  assert.match(channel, /batchId\?: number \| string/);
  assert.match(notifications, /notifyClassMessage/);
  assert.match(notifications, /pathname: "\/class-chat"/);
  assert.match(chat, /lastEvent\?\.kind === "class_message"/);
  assert.match(chat, /\/messages\/read/);
  assert.match(chat, /next\.messages\.at\(-1\)\?\.id/);
  assert.match(chat, /await uploadFile\(file\)/);
  assert.match(chat, /Open attachment/);
  assert.match(chat, /Choose a photo or PDF/);
});

test("the class home shows a durable unread badge", () => {
  assert.match(home, /unreadMessages: number/);
  assert.match(home, /unread class messages/);
  assert.match(home, /backgroundColor: colors\.brand/);
  assert.match(home, /lastEvent\?\.kind === "class_message"/);
});
