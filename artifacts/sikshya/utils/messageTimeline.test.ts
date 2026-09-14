import assert from "node:assert/strict";
import test from "node:test";

import {
  latestOwnMessageId,
  messageDayKey,
  messageDayLabel,
  messageTimeLabel,
  shouldShowDay,
  type TimelineMessage,
} from "./messageTimeline.ts";

const messages: TimelineMessage[] = [
  { id: 1, senderId: 4, read: true, createdAt: "2026-09-13T18:20:00.000Z" },
  { id: 2, senderId: 7, read: true, createdAt: "2026-09-13T18:40:00.000Z" },
  { id: 3, senderId: 4, read: false, createdAt: "2026-09-14T18:40:00.000Z" },
];

test("message time and day are measured in Nepal on every device", () => {
  assert.equal(messageDayKey(messages[0]!.createdAt), "2026-09-14");
  assert.equal(messageTimeLabel(messages[0]!.createdAt), "12:05 AM");
  assert.equal(messageDayLabel(messages[2]!.createdAt, Date.parse("2026-09-14T19:00:00Z"), () => "date"), "Today");
  assert.equal(messageDayLabel(messages[0]!.createdAt, Date.parse("2026-09-14T19:00:00Z"), () => "date"), "Yesterday");
});

test("a quiet date divider appears only when Nepal's calendar day changes", () => {
  assert.equal(shouldShowDay(messages, 0), true);
  assert.equal(shouldShowDay(messages, 1), false);
  assert.equal(shouldShowDay(messages, 2), true);
});

test("only the latest outgoing message carries delivery state", () => {
  assert.equal(latestOwnMessageId(messages, 4), 3);
  assert.equal(latestOwnMessageId(messages, 7), 2);
  assert.equal(latestOwnMessageId(messages, undefined), null);
});
