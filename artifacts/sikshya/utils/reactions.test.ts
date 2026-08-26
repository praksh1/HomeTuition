import assert from "node:assert/strict";
import { test } from "node:test";
import { applyReaction, attachmentLabel, REACTIONS } from "./reactions.ts";

test("a first reaction is counted as yours", () => {
  assert.deepEqual(applyReaction([], "👍"), [{ emoji: "👍", count: 1, mine: true }]);
});

test("joining one somebody else left counts two, and marks it yours", () => {
  assert.deepEqual(applyReaction([{ emoji: "👍", count: 1, mine: false }], "👍"), [
    { emoji: "👍", count: 1 + 1, mine: true },
  ]);
});

test("the same one again takes it back", () => {
  assert.deepEqual(applyReaction([{ emoji: "👍", count: 1, mine: true }], "👍"), []);
});

test("and leaves everybody else's behind", () => {
  assert.deepEqual(applyReaction([{ emoji: "👍", count: 3, mine: true }], "👍"), [
    { emoji: "👍", count: 2, mine: false },
  ]);
});

test("a different one replaces yours rather than stacking", () => {
  const after = applyReaction([{ emoji: "👍", count: 1, mine: true }], "🎉");
  // The point: one person never holds two reactions on one message.
  assert.equal(after.filter((r) => r.mine).length, 1);
  assert.deepEqual(after, [{ emoji: "🎉", count: 1, mine: true }]);
});

test("replacing does not disturb the count somebody else built up", () => {
  const after = applyReaction(
    [{ emoji: "👍", count: 4, mine: true }, { emoji: "🎉", count: 2, mine: false }],
    "🎉",
  );
  assert.deepEqual(after, [
    { emoji: "👍", count: 3, mine: false },
    { emoji: "🎉", count: 3, mine: true },
  ]);
});

test("a file with no name is described by its type", () => {
  assert.equal(attachmentLabel({ fileKey: "k", fileType: "image/png", fileName: null }), "Photo");
  assert.equal(attachmentLabel({ fileKey: "k", fileType: "application/pdf", fileName: null }), "File");
  assert.equal(attachmentLabel({ fileKey: "k", fileType: "image/png", fileName: "q4.png" }), "q4.png");
});

test("the list is short enough to tap through on a phone", () => {
  assert.ok(REACTIONS.length <= 6, `${REACTIONS.length} is too many to show under a bubble`);
});
