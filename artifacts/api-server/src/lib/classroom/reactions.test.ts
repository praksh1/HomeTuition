import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptClassReaction } from "./reactions.ts";

test("live reactions are allowlisted, bounded per user and bounded per room", () => {
  const recent = new Map<number, number>();
  assert.equal(acceptClassReaction(recent, 1, "<script>", 10000), false);
  assert.equal(acceptClassReaction(recent, 1, "👍", 10000), true);
  assert.equal(acceptClassReaction(recent, 1, "👏", 11000), false);
  assert.equal(acceptClassReaction(recent, 1, "👏", 11500), true);
  for (let id = 2; id <= 8; id++) assert.equal(acceptClassReaction(recent, id, "❤️", 11500), true);
  assert.equal(acceptClassReaction(recent, 9, "❤️", 11500), false);
  assert.equal(acceptClassReaction(recent, 9, "❤️", 13000), true);
  assert.equal(acceptClassReaction(recent, 10, "❓", 30000), true);
  assert.equal(recent.size, 1);
});
