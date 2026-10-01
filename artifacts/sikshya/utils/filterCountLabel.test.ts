import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";
import { filterCountLabel } from "./filterCountLabel.ts";

test("filter labels always put known counts inside parentheses, including zero", () => {
  for (const label of ["All", "Unread", "Upcoming", "Live", "History", "Active", "Past", "Joined", "Not yet"]) {
    for (const count of [0, 1, 4, 13, 27, 286, 1000]) {
      assert.equal(filterCountLabel(label, count), `${label} (${count})`);
    }
  }
});

test("unavailable or invalid counts do not become a fabricated zero or crash a screen", () => {
  for (const count of [null, undefined, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(filterCountLabel("Upcoming", count), "Upcoming");
  }
});

test("student library, notifications and class roster share the count format", () => {
  for (const file of ["app/(student)/sessions.tsx", "app/notifications.tsx", "app/class-students.tsx"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /import \{ filterCountLabel \} from "@\/utils\/filterCountLabel"/);
    assert.match(source, /\{filterCountLabel\(/);
    assert.doesNotMatch(source, /\{g\.label\}\{g\.count/);
    assert.doesNotMatch(source, /\{choice\.label\} \{count\}/);
    assert.doesNotMatch(source, /`(?:All|Unread) \$\{/);
  }
});
