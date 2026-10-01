import assert from "node:assert/strict";
import test from "node:test";
import { retainEarlierMessageRows, stableMessageRows } from "./messageRows.ts";

test("identical message snapshots reuse the list and rows, including attachments and reactions", () => {
  const rows = [{ id: 1, body: "hello", attachments: [{ fileKey: "private" }], reactions: [{ emoji: "👍", count: 1 }] }];
  assert.equal(stableMessageRows(rows, JSON.parse(JSON.stringify(rows))), rows);
});
test("message updates change only the affected row", () => {
  const rows = [{ id: 1, body: "one", read: false }, { id: 2, body: "two", read: false }];
  const next = stableMessageRows(rows, [{ ...rows[0]! }, { ...rows[1]!, read: true }]);
  assert.equal(next[0], rows[0]); assert.notEqual(next[1], rows[1]); assert.equal(next[1]!.read, true);
});
test("direct-message snapshots remain authoritative when blocked content is suppressed", () => {
  const rows = [{ id: 1, body: "one" }, { id: 2, body: "two" }];
  assert.deepEqual(stableMessageRows(rows, [{ ...rows[0]! }]), [rows[0]]);
  assert.deepEqual(stableMessageRows(rows, []), []);
});
test("class latest-window recovery retains loaded earlier history without duplicates", () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, body: String(i + 1) }));
  assert.equal(retainEarlierMessageRows(rows, rows.slice(200).map(row => ({ ...row }))), rows);
  const next = retainEarlierMessageRows(rows, [...rows.slice(200), { id: 251, body: "latest" }]);
  assert.equal(next.length, 251); assert.equal(next[0], rows[0]); assert.equal(next.at(-1)!.id, 251);
});
