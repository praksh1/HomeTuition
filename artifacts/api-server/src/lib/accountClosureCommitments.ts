import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { ClosureCommitments } from "./accountClosurePolicy";
import { lessonRemedySchemaReady } from "./lessonRemedySchema";

/** Read-only preflight. Missing schema/failed queries throw and prevent completion.
 * Never changes lesson states, generates settlements, or interprets a simulated payout as cash.
 * Untracked legacy payment history requires reconciliation, not an invented zero balance.
 */
export async function readAccountClosureCommitments(source: Pick<typeof db,"execute">, userId: number): Promise<ClosureCommitments> {
  const hasRemedies = await lessonRemedySchemaReady(source);
  const pendingRemedies = hasRemedies ? sql`(SELECT count(*) FROM lesson_remedy_cases c
    WHERE (c.student_id=${userId} OR c.teacher_id=${userId}) AND c.status NOT IN ('resolved','withdrawn')
      AND NOT (c.status='delivered_review' AND c.outcome='replacement_delivered'
        AND c.replacement_review_closes_at IS NOT NULL AND c.replacement_review_closes_at<=now()
        AND EXISTS(SELECT 1 FROM lesson_remedy_offers o WHERE o.case_id=c.id AND o.accepted_at IS NOT NULL AND o.replacement_session_id IS NOT NULL)
        AND COALESCE((SELECT l.to_state FROM batch_test_ledger_entries l WHERE l.booking_id=c.original_booking_id
          AND l.position=c.original_position ORDER BY l.id DESC LIMIT 1),'future')='paid_out'))` : sql`0`;
  const notReplacement = hasRemedies ? sql`AND NOT EXISTS(SELECT 1 FROM lesson_remedy_offers mo
    WHERE mo.replacement_session_id=s.id AND mo.accepted_at IS NOT NULL)` : sql``;
  const noPendingCase = hasRemedies ? sql`AND NOT EXISTS(SELECT 1 FROM lesson_remedy_cases c
    WHERE c.original_booking_id=a.booking_id AND c.original_position=a.position
      AND c.status NOT IN ('resolved','withdrawn'))` : sql``;
  const result=await source.execute(sql`
    WITH relevant_sessions AS (
      SELECT s.id,s.status FROM sessions s WHERE s.teacher_id=${userId}
        OR EXISTS(SELECT 1 FROM session_enrollments e WHERE e.session_id=s.id AND e.student_id=${userId} AND e.payment_status NOT IN ('refunded','cancelled'))
    ), relevant_program_allocations AS (
      SELECT a.state FROM learning_program_allocations a
      JOIN learning_program_enrollments e ON e.id=a.enrollment_id JOIN learning_programs p ON p.id=e.program_id
      WHERE e.student_id=${userId} OR p.teacher_id=${userId}
    ), relevant_batch_allocations AS (
      SELECT b.id AS booking_id,
        CASE WHEN (a.item->>'position') ~ '^[0-9]{1,9}$' THEN (a.item->>'position')::integer END AS position,
        COALESCE((SELECT l.to_state FROM batch_test_ledger_entries l WHERE l.booking_id=b.id
        AND l.position=CASE WHEN (a.item->>'position') ~ '^[0-9]{1,9}$' THEN (a.item->>'position')::integer END
        ORDER BY l.id DESC LIMIT 1),'future') AS state
      FROM batch_test_bookings b JOIN batch_test_payments pay ON pay.booking_id=b.id
      JOIN learning_program_batches batch ON batch.id=b.batch_id JOIN learning_programs p ON p.id=batch.program_id
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(pay.receipt->'allocations')='array'
        THEN pay.receipt->'allocations' ELSE '[]'::jsonb END) a(item)
      WHERE b.student_id=${userId} OR p.teacher_id=${userId}
    )
    SELECT
      (SELECT count(*) FROM relevant_sessions WHERE status NOT IN ('completed','cancelled')) +
      (SELECT count(*) FROM recurring_sessions r WHERE r.status='active' AND (r.teacher_id=${userId}
        OR EXISTS(SELECT 1 FROM recurring_enrollments e WHERE e.recurring_id=r.id AND e.student_id=${userId} AND e.status='active'))) +
      (SELECT count(*) FROM learning_program_batches b JOIN learning_programs p ON p.id=b.program_id WHERE p.teacher_id=${userId} AND b.status='published'
        AND (NOT EXISTS(SELECT 1 FROM learning_program_batch_lessons l WHERE l.batch_id=b.id)
          OR EXISTS(SELECT 1 FROM learning_program_batch_lessons l WHERE l.batch_id=b.id
            AND (l.duration_minutes<=0 OR l.starts_at IS NULL OR l.starts_at+l.duration_minutes*interval '1 minute'>now())))) AS upcoming,
      (SELECT count(*) FROM refunds r WHERE r.status<>'paid' AND (r.student_id=${userId} OR EXISTS(SELECT 1 FROM sessions s WHERE s.id=r.session_id AND s.teacher_id=${userId})
        OR EXISTS(SELECT 1 FROM recurring_sessions c WHERE c.id=r.recurring_id AND c.teacher_id=${userId}))) +
      (SELECT count(*) FROM relevant_program_allocations WHERE state NOT IN ('paid_out','refunded')) +
      (SELECT count(*) FROM relevant_batch_allocations WHERE state NOT IN ('paid_out','refunded')) AS payments,
      (SELECT count(*) FROM disputes d WHERE d.status NOT IN ('resolved','denied','cancelled') AND
        (d.user_id=${userId} OR EXISTS(SELECT 1 FROM sessions s WHERE s.id=d.session_id AND s.teacher_id=${userId}))) AS disputes,
      (SELECT count(*) FROM recurring_days d JOIN recurring_sessions r ON r.id=d.recurring_id
        WHERE d.kind='makeup' AND d.status NOT IN ('held','cancelled') AND (r.teacher_id=${userId}
          OR EXISTS(SELECT 1 FROM recurring_enrollments e WHERE e.recurring_id=r.id AND e.cycle_index=d.cycle_index AND e.student_id=${userId} AND e.status='active'))) +
      (SELECT count(*) FROM relevant_program_allocations WHERE state='replacement_pending') +
      (SELECT count(*) FROM relevant_batch_allocations a WHERE state='replacement_pending' ${noPendingCase}) + ${pendingRemedies} AS makeups,
      EXISTS(SELECT 1 FROM session_enrollments e JOIN sessions s ON s.id=e.session_id
        WHERE e.payment_status='paid' AND (e.student_id=${userId} OR s.teacher_id=${userId})
          AND NOT EXISTS(SELECT 1 FROM batch_test_sessions b WHERE b.session_id=s.id) ${notReplacement})
        OR EXISTS(SELECT 1 FROM recurring_enrollments e JOIN recurring_sessions r ON r.id=e.recurring_id
          WHERE e.student_id=${userId} OR r.teacher_id=${userId})
        OR EXISTS(SELECT 1 FROM learning_program_enrollments e JOIN learning_programs p ON p.id=e.program_id
          WHERE (e.student_id=${userId} OR p.teacher_id=${userId})
            AND NOT EXISTS(SELECT 1 FROM learning_program_allocations a WHERE a.enrollment_id=e.id))
        OR EXISTS(SELECT 1 FROM batch_test_bookings b JOIN learning_program_batches batch ON batch.id=b.batch_id
          JOIN learning_programs p ON p.id=batch.program_id LEFT JOIN batch_test_payments pay ON pay.booking_id=b.id
          WHERE (b.student_id=${userId} OR p.teacher_id=${userId}) AND
            (pay.booking_id IS NULL OR COALESCE(jsonb_typeof(pay.receipt->'allocations'),'null')<>'array'
              OR CASE WHEN jsonb_typeof(pay.receipt->'allocations')='array' THEN jsonb_array_length(pay.receipt->'allocations')=0 ELSE true END
              OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pay.receipt->'allocations')='array'
                THEN pay.receipt->'allocations' ELSE '[]'::jsonb END) item
                WHERE COALESCE(item->>'position','') !~ '^[0-9]{1,9}$')))
          AS legacy_reconciliation_required
  `);
  const row=result.rows[0];
  if (!row) throw Error('Account commitments are unavailable.');
  return {complete:row.legacy_reconciliation_required===false,
    upcomingLessons:Number(row.upcoming),pendingPayments:Number(row.payments),openDisputes:Number(row.disputes),pendingMakeups:Number(row.makeups)};
}
