import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../routes/sessions.ts", import.meta.url), "utf8");
const booking = source.slice(source.indexOf("async function bookSession"), source.indexOf('router.post("/sessions/:id/book"'));
const transaction = booking.slice(booking.indexOf("const result = await db.transaction"), booking.indexOf("switch (result.kind)"));

test("ordinary booking re-reads all mutable lesson promises under the seat lock", () => {
  const projection = transaction.slice(transaction.indexOf("const [locked]"), transaction.indexOf('if (!locked)'));
  for (const field of ["date", "duration", "startedAt", "price", "teacherId", "topic", "status", "maxStudents", "enrolledCount"]) {
    assert.ok(projection.includes(`${field}: sessionsTable.${field}`), `${field} must be read under the row lock`);
  }
  assert.match(projection, /for\("update"\)/);
  assert.match(transaction, /const price = locked\.price \?\? 0/);
  assert.doesNotMatch(booking, /const price = session\.price/);
});

test("fresh locked door and overlap checks run before any ordinary-book charge", () => {
  const door = transaction.indexOf("const lockedClosesAt = studentDoorClosesAt({ ...locked, endedAt: null })");
  const overlap = transaction.indexOf("const overlapping =");
  const charge = transaction.indexOf("const charge = await chargeForSession");
  assert.ok(door >= 0 && door < overlap && overlap < charge);
  assert.match(transaction.slice(door, overlap), /kind: "expired"/);
  const query = transaction.slice(overlap, transaction.indexOf("if (overlapping.length)"));
  assert.match(query, /locked\.date\.getTime\(\) \+ locked\.duration \* 60_000/);
  assert.match(query, /locked\.date\.toISOString\(\)/);
  assert.doesNotMatch(query, /session\.date|session\.duration/);
});

test("a concurrently changed promise asks for another review before any payment or enrollment", () => {
  const changed = transaction.indexOf('return { kind: "details_changed"');
  const charge = transaction.indexOf("const charge = await chargeForSession");
  const write = transaction.indexOf("const [enrolment] =");
  assert.ok(changed >= 0 && changed < charge && charge < write);
  const guard = transaction.slice(transaction.lastIndexOf("if (", changed), changed);
  assert.match(guard, /locked\.date\.getTime\(\) !== session\.date\.getTime\(\)/);
  for (const field of ["duration", "price", "topic", "teacherId"]) {
    assert.ok(guard.includes(`locked.${field} !== session.${field}`));
  }
  assert.match(booking, /Lesson details changed\. Refresh and review before booking\. No payment was taken\./);
  assert.match(booking, /refreshRequired: true/);
});

test("committed ordinary-book notifications and amount use the actual locked lesson", () => {
  assert.match(transaction, /viaTestAccess, price, teacherId: locked\.teacherId, topic: locked\.topic/);
  const committed = booking.slice(booking.indexOf("switch (result.kind)"));
  assert.match(committed, /notify\(result\.teacherId,/);
  assert.match(committed, /topic: result\.topic/);
  assert.match(committed, /amount: result\.viaTestAccess \? 0 : result\.price/);
  assert.match(committed, /price: result\.price/);
  assert.doesNotMatch(committed, /session\.(price|topic|teacherId)/);
});
