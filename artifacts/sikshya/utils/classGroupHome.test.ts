import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = readFileSync(path.join(root, "app", "class-home.tsx"), "utf8");
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
