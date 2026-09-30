import assert from "node:assert/strict";
import test from "node:test";
import { BATCH_TEST_DDL } from "./batchTestingSchema.ts";

const guard = BATCH_TEST_DDL.find(statement => statement.includes("FUNCTION protect_batch_test_enrollment()"))!;

test("a mapped original seat cannot evade its booking guard by changing identity", () => {
  assert.match(guard, /TG_OP='UPDATE'/);
  assert.match(guard, /WHERE session_id=OLD\.session_id/);
  assert.match(guard, /old_linked IS NOT NULL AND \(to_jsonb\(NEW\)-'payment_status'\) IS DISTINCT FROM \(to_jsonb\(OLD\)-'payment_status'\)/);
  assert.ok(guard.indexOf("WHERE session_id=OLD.session_id") < guard.indexOf("IF approved_refund THEN RETURN NEW"));
});

test("only an unchanged test-access seat may become refunded through the narrow exception", () => {
  assert.match(guard, /OLD\.payment_status='test' AND NEW\.payment_status='refunded'/);
  assert.match(guard, /OLD\.payment_method='test_access' AND NEW\.payment_method='test_access'/);
  assert.match(guard, /OLD\.payment_reference IS NULL AND NEW\.payment_reference IS NULL/);
});

test("refund revocation requires the latest ledger decision for its exact original allocation", () => {
  assert.match(guard, /JOIN batch_test_payments pay ON pay\.booking_id=b\.id/);
  assert.match(guard, /b\.batch_id=old_linked AND b\.student_id=OLD\.student_id/);
  assert.match(guard, /l\.booking_id=b\.id AND l\.position=original_position ORDER BY l\.id DESC LIMIT 1/);
  assert.match(guard, /'future'\) IN \('refund_owed','refunded'\)/);
});

test("new mapped enrollments still require the original no-payment test booking contract", () => {
  assert.match(guard, /NEW\.payment_status IS DISTINCT FROM 'test'/);
  assert.match(guard, /NEW\.payment_method IS DISTINCT FROM 'test_access'/);
  assert.match(guard, /NEW\.payment_reference IS NOT NULL/);
  assert.match(guard, /NOT EXISTS\(SELECT 1 FROM batch_test_bookings WHERE batch_id=linked AND student_id=NEW\.student_id\)/);
});

test("a terminal refunded original seat cannot be resurrected as test or another active status", () => {
  assert.match(guard, /old_linked IS NOT NULL AND OLD\.payment_status='refunded' AND NEW\.payment_status IS DISTINCT FROM 'refunded'/);
  assert.ok(guard.indexOf("OLD.payment_status='refunded'") < guard.indexOf("IF approved_refund THEN RETURN NEW"));
});
