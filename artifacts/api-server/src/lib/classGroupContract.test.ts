import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const access = readFileSync(path.join(here, "classGroupAccess.ts"), "utf8");
const routes = readFileSync(
  path.join(here, "..", "routes", "classGroups.ts"),
  "utf8",
);
const schema = readFileSync(path.join(here, "classGroupSchema.ts"), "utf8");

test("new class groups have one batch authority and never masquerade as old Monthly classes", () => {
  assert.match(access, /batchTestBookingsTable\.batchId/);
  assert.match(access, /learningProgramsTable\.teacherId/);
  assert.doesNotMatch(
    access + routes + schema,
    /recurringId|recurring_sessions|session_messages/,
  );
});

test("every learning tool is scoped by batch and created additively", () => {
  for (const name of [
    "class_group_messages",
    "class_group_message_files",
    "class_group_message_reads",
    "class_group_homework",
    "class_group_homework_submissions",
    "class_group_homework_files",
    "class_group_materials",
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${name}`));
  }
  assert.doesNotMatch(schema, /ALTER TABLE|DROP TABLE|DROP COLUMN/);
  assert.match(routes, /Only the teacher can set homework/);
  assert.match(routes, /Only the teacher can add class materials/);
});

test("late students do not inherit earlier conversation", () => {
  assert.match(
    routes,
    /gte\(classGroupMessagesTable\.createdAt, access\.joinedAt\)/,
  );
  assert.match(routes, /classGroupMessagesTable\.pinnedAt/);
});

test("unread messages have a durable per-person acknowledgement", () => {
  assert.match(schema, /PRIMARY KEY \(batch_id, user_id\)/);
  assert.match(routes, /lastReadMessageId/);
  assert.match(routes, /greatest/);
  assert.match(routes, /kind: "class_message"/);
});

test("new class messages verify one stored file and keep late-join visibility aligned", () => {
  assert.match(routes, /classGroupMessageFilesTable/);
  assert.match(routes, /Write a message or attach a photo or PDF/);
  assert.match(routes, /preview: message\.body\.slice\(0, 140\) \|\| "Sent a file"/);
  assert.match(schema, /class_group_message_files_key_idx/);
});

test("new class homework accepts files only after storage verification and keeps answers private", () => {
  assert.match(routes, /verifyUpload\(key, userId\)/);
  assert.match(routes, /Only the teacher can return feedback/);
  assert.match(routes, /classGroupHomeworkFilesTable\.kind, \["submission", "feedback"\]/);
  assert.match(schema, /class_group_homework_files_key_idx/);
  assert.match(schema, /submission_id integer REFERENCES class_group_homework_submissions/);
});
