import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { deliveryForBlocks } from "./directMessagePolicy.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(path.resolve(here, ...parts), "utf8");
const safety = read("messageSafety.ts");
const messages = read("..", "routes", "messages.ts");
const files = read("messageAccess.ts");
const admin = read("..", "routes", "admin.ts");

test("a blocked sender gets a normal send path but the blocker stops composing", () => {
  assert.deepEqual(deliveryForBlocks(false, false), { canSend: true, suppressForRecipient: false });
  assert.deepEqual(deliveryForBlocks(false, true), { canSend: true, suppressForRecipient: true });
  assert.deepEqual(deliveryForBlocks(true, false), { canSend: false, suppressForRecipient: false });
  assert.deepEqual(deliveryForBlocks(true, true), { canSend: false, suppressForRecipient: false });
});

test("suppressed messages fail closed across recipient reads and live delivery", () => {
  assert.match(safety, /CREATE TABLE IF NOT EXISTS message_delivery_suppressions/);
  assert.match(safety, /ready = undefined; throw error/);
  assert.match(messages, /async function directConversations\(userId: number\)[\s\S]*?await ensureMessageSafety\(\)[\s\S]*?directMessageVisibleTo\(userId\)/);
  assert.match(messages, /router\.get\("\/messages\/unread-count"[\s\S]*?await ensureMessageSafety\(\)[\s\S]*?directMessageVisibleTo\(userId\)/);
  assert.match(messages, /router\.get\("\/messages\/:otherUserId"[\s\S]*?directMessageVisibleTo\(userId\)/);
  assert.match(messages, /\.set\(\{ read: true \}\)[\s\S]*?directMessageVisibleTo\(userId\)/);
  assert.match(files, /await ensureMessageSafety\(\)[\s\S]*?directMessageVisibleTo\(userId\)/);
  assert.match(messages, /INSERT INTO message_delivery_suppressions\(message_id, hidden_from_user_id\)/);
  assert.match(messages, /if \(!result\.suppressed\) syncConversation\(\[otherUserId\]/);
  assert.match(messages, /if \(!result\.suppressed\) notify\(otherUserId/);
});

test("new reactions are retained privately and a user report reaches the operator queue", () => {
  assert.match(safety, /CREATE TABLE IF NOT EXISTS message_reaction_suppressions/);
  assert.match(messages, /NOT EXISTS \([\s\S]*?message_reaction_suppressions hidden_reaction/);
  assert.match(messages, /INSERT INTO message_reaction_suppressions\(reaction_id, hidden_from_user_id\)/);
  assert.match(messages, /router\.post\("\/messages\/:otherUserId\/report", requireAuth/);
  assert.match(messages, /await tx\.insert\(userReportsTable\)\.values\(\{ ticketId: created!\.id, reportedUserId: otherId \}\)/);
  assert.match(admin, /category === "reported_user"/);
  assert.match(admin, /\.leftJoin\(userReportsTable, eq\(userReportsTable\.ticketId, disputesTable\.id\)\)/);
});
