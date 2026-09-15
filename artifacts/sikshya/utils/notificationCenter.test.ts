import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterNotifications,
  markOnlyNotificationRead,
  nepalDayKey,
  notificationClock,
  notificationDestination,
  notificationGroupLabel,
  notificationMatchesReadTarget,
  notificationPresentation,
} from "./notificationCenter.ts";
import type { AppNotification } from "./notifications.ts";

const item = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: "one",
  title: "A notification",
  body: "Its details",
  type: "general",
  read: false,
  createdAt: "2026-09-14T18:20:00.000Z",
  ...overrides,
});

test("opening one notification leaves every other unread item unread", () => {
  const result = markOnlyNotificationRead([item(), item({ id: "two" })], "one");
  assert.equal(result[0]?.read, true);
  assert.equal(result[1]?.read, false);
});

test("opening a conversation matches only notifications for that exact conversation", () => {
  const direct = item({ data: { type: "message", conversationWith: "17" } });
  const other = item({ data: { type: "message", conversationWith: "18" } });
  const classMessage = item({ data: { type: "class_message", batchId: "17" } });
  assert.equal(notificationMatchesReadTarget(direct, { kind: "direct_message", conversationWith: 17 }), true);
  assert.equal(notificationMatchesReadTarget(other, { kind: "direct_message", conversationWith: 17 }), false);
  assert.equal(notificationMatchesReadTarget(classMessage, { kind: "direct_message", conversationWith: 17 }), false);
  assert.equal(notificationMatchesReadTarget(classMessage, { kind: "class_message", batchId: 17 }), true);
});

test("unread filtering sorts newest first and safely keeps invalid dates last", () => {
  const result = filterNotifications([
    item({ id: "old", createdAt: "2026-09-14T10:00:00Z" }),
    item({ id: "read", read: true, createdAt: "2026-09-15T10:00:00Z" }),
    item({ id: "invalid", createdAt: "not-a-date" }),
    item({ id: "new", createdAt: "2026-09-14T12:00:00Z" }),
  ], "unread");
  assert.deepEqual(result.map(({ id }) => id), ["new", "old", "invalid"]);
});

test("Nepal day grouping does not change with the viewer's timezone", () => {
  assert.equal(nepalDayKey("2026-09-14T18:20:00Z"), "2026-09-15");
  assert.equal(notificationGroupLabel("2026-09-15", "2026-09-15T05:00:00+05:45", () => "date"), "Today");
  assert.equal(notificationGroupLabel("2026-09-14", "2026-09-15T05:00:00+05:45", () => "date"), "Yesterday");
  assert.match(notificationClock("2026-09-14T18:20:00Z"), /^12:05 AM Nepal time$/);
});

test("notification destinations keep messages, homework, lessons and money actionable", () => {
  assert.deepEqual(notificationDestination({ type: "class_message", batchId: 4 }, "teacher"), { pathname: "/class-chat", params: { id: "4" } });
  assert.deepEqual(notificationDestination({ type: "class_homework_set", batchId: 5 }, "student"), { pathname: "/class-homework", params: { id: "5" } });
  assert.deepEqual(notificationDestination({ type: "live", sessionId: 6 }, "student"), { pathname: "/classroom/[id]", params: { id: "6" } });
  assert.deepEqual(notificationDestination({ type: "rescheduled", sessionId: 7 }, "teacher"), { pathname: "/session/[id]", params: { id: "7" } });
  assert.deepEqual(notificationDestination({ type: "payment" }, "teacher"), { pathname: "/(teacher)/subscription", params: { from: "notif" } });
  assert.deepEqual(notificationDestination({ type: "payment" }, "student"), { pathname: "/(student)/payments" });
});

test("presentation labels describe the event rather than exposing provider codes", () => {
  assert.equal(notificationPresentation(item({ data: { type: "class_homework_feedback" } })).label, "Homework");
  assert.equal(notificationPresentation(item({ type: "live" })).label, "Live now");
  assert.equal(notificationPresentation(item({ type: "payment" })).label, "Payment");
});
