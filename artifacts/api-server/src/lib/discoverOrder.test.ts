import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { personalizedCursorFor, readPersonalizedCursor } from "./discoverOrder.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const route = readFileSync(path.resolve(here, "..", "routes", "learningPrograms.ts"), "utf8");
const studentDiscover = readFileSync(path.resolve(here, "..", "..", "..", "sikshya", "app", "(student)", "index.tsx"), "utf8");

test("personalized cursor pages across enrolled, followed, relevant and newest tiers", () => {
  const rows = [
    { rank: 100, at: new Date(1000), id: 1 },
    { rank: 100, at: new Date(900), id: 2 },
    { rank: 50, at: new Date(2000), id: 3 },
    { rank: 3, at: new Date(3000), id: 4 },
    { rank: 0, at: new Date(4000), id: 5 },
  ];
  const seen: number[] = [];
  let remaining = rows;
  while (remaining.length) {
    const page = remaining.slice(0, 2);
    seen.push(...page.map((row) => row.id));
    const cursor = readPersonalizedCursor(personalizedCursorFor(page.at(-1)!));
    assert.ok(cursor);
    remaining = rows.filter((row) =>
      row.rank < cursor.rank ||
      (row.rank === cursor.rank && row.at < cursor.at) ||
      (row.rank === cursor.rank && row.at.getTime() === cursor.at.getTime() && row.id < cursor.id),
    );
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  assert.equal(readPersonalizedCursor("100_1000_1"), null);
  assert.equal(readPersonalizedCursor("p101_1000_1"), null);
});

test("catalog query orders and resumes using the same rank, publication time and id", () => {
  assert.match(route, /desc\(priority\), desc\(learningProgramsTable\.publishedAt\), desc\(learningProgramsTable\.id\)/);
  assert.match(route, /\(\$\{priority\}, \$\{learningProgramsTable\.publishedAt\}, \$\{learningProgramsTable\.id\}\) < \(\$\{cursor\.rank\}, \$\{cursor\.at\}, \$\{cursor\.id\}\)/);
  assert.match(route, /booked_batch\.status = 'published' AND lesson\.status IN \('upcoming', 'live'\)/);
  assert.match(route, /place\.payment_status = 'paid' OR \(place\.payment_status = 'test' AND \$\{admitsTestEnrolment\("test"\)\}\)/);
});

test("both program and default tuition catalogue requests ask for authorized personalization", () => {
  assert.equal((studentDiscover.match(/params\.set\("personalized", "1"\)/g) ?? []).length, 2);
});
