import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(path.resolve(here, ...parts), "utf8");
const schema = read("..", "..", "..", "..", "lib", "db", "src", "schema", "notificationPrefs.ts");
const guard = read("ensureSchema.ts");
const notify = read("notify.ts");
const routes = read("..", "routes", "notifications.ts");
const booking = read("..", "routes", "batchTesting.ts");

test("notification inbox is additive and indexed per user", () => {
  assert.match(schema, /user_notification_events/);
  assert.match(schema, /index\("user_notification_events_user_idx"\)/);
  assert.match(guard, /CREATE TABLE IF NOT EXISTS "user_notification_events"/);
  assert.match(guard, /CREATE INDEX IF NOT EXISTS "user_notification_events_user_idx"/);
  assert.doesNotMatch(guard.match(/async function ensureNotificationPrefsTable[\s\S]*?\n}/)?.[0] ?? "", /ALTER TABLE|DROP TABLE|DROP COLUMN/);
});

test("missed events are persisted without making live delivery depend on the new table", () => {
  assert.match(notify, /insert\(userNotificationEventsTable\)/);
  assert.match(notify, /could not persist notification event/);
  assert.match(notify, /notifyUser\(recipient\.id, \{ \.\.\.event \}\)/);
  assert.match(routes, /router\.get\("\/notification-events", requireAuth/);
  assert.match(routes, /eq\(userNotificationEventsTable\.userId, req\.user!\.userId\)/);
  assert.match(routes, /gt\(userNotificationEventsTable\.id, after\)/);
  assert.match(routes, /limit\(200\)/);
  assert.match(routes, /Cache-Control", "no-store"/);
});

test("late test enrolment catches the student up on open homework", () => {
  assert.match(booking, /classGroupHomeworkTable\.status, "open"/);
  assert.match(booking, /kind: "class_homework_set"/);
  assert.match(booking, /homeworkId: task\.id/);
  assert.match(booking, /notifyMany\(\[req\.user!\.userId\]/);
});
