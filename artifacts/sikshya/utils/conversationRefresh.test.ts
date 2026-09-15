import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");

test("modern conversations use instant sync events with bounded missed-event recovery", () => {
  const inbox = read("components", "ConversationList.tsx");
  const direct = read("app", "conversation", "[id].tsx");
  const klass = read("app", "class-chat.tsx");
  for (const source of [inbox, direct, klass]) {
    assert.match(source, /lastEvent/);
    assert.match(source, /conversation_sync/);
  }
  assert.match(inbox, /12000/);
  assert.match(direct, /8000/);
  assert.match(klass, /8000/);
  assert.doesNotMatch(`${inbox}\n${direct}\n${klass}`, /setInterval\([^\n]+,\s*(4000|5000|6000)\)/);
});
