import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");

test("modern conversations use the live event path and only a slow missed-event fallback", () => {
  for (const source of [
    read("components", "ConversationList.tsx"),
    read("app", "conversation", "[id].tsx"),
    read("app", "class-chat.tsx"),
  ]) {
    assert.match(source, /lastEvent/);
    assert.match(source, /30000/);
    assert.doesNotMatch(source, /setInterval\([^\n]+,\s*(4000|5000|6000)\)/);
  }
});
