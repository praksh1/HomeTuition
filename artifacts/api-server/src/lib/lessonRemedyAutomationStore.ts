import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { readBatchSnapshot } from "./programBatches";
import { recordAutomatedRemedyShadow, REMEDY_AUTOMATION_VERSION,
  type AutomatedPurchaseConsent, type AutomatedRemedyAdapter, type AutomatedRemedyCase,
  type AutomatedRemedyDecision, type AutomatedRemedyFacts, type VerifiedRemedyEvidence,
} from "./lessonRemedyAutomation.ts";
import { AUTOMATION_STORAGE_TABLES, LESSON_REMEDY_AUTOMATION_DDL } from "./lessonRemedyAutomationStorage.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<Tx, "execute">;
const epoch = (value: unknown): number => value instanceof Date ? value.getTime() : Date.parse(String(value));

/** No runtime auto-migration. A dry-run must opt in explicitly, on a disposable local database. */
export async function installRemedyAutomationShadowStorageForLocalTests(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/fadko_makeup_test[A-Za-z0-9_-]*$/.test(url.pathname)
    || process.env.NODE_ENV !== "test") throw Error("Automation schema installation is restricted to disposable local make-up tests.");
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(838209, 2)`);
    for (const statement of LESSON_REMEDY_AUTOMATION_DDL) await tx.execute(sql.raw(statement));
  });
}
async function storageReady(reader: Reader): Promise<boolean> {
  const result = await reader.execute(sql`SELECT to_regclass('lesson_remedy_automation_purchase_terms') AS terms,
    to_regclass('lesson_remedy_automation_warning_consents') AS warnings,
    to_regclass('lesson_remedy_automation_evidence') AS evidence,
    to_regclass('lesson_remedy_automation_shadow_actions') AS actions`);
  return Object.values(result.rows[0] ?? {}).length === AUTOMATION_STORAGE_TABLES.length
    && Object.values(result.rows[0] ?? {}).every(Boolean);
}
/** The test-only adapter does not activate refunds, future access changes, payouts or a scheduler. */
async function lockedShadowFacts(tx: Tx, bookingId: number, position: number, nowMs: number): Promise<AutomatedRemedyFacts> {
  // Same lock ordering as request, acceptance, settlement and operator refunds.
  const payments = await tx.execute(sql`SELECT receipt FROM batch_test_payments WHERE booking_id=${bookingId} FOR UPDATE`);
  const bookings = await tx.execute(sql`SELECT id,batch_id,student_id,created_at FROM batch_test_bookings WHERE id=${bookingId} FOR UPDATE`);
  const booking = bookings.rows[0];
  const receipt = payments.rows[0]?.receipt as { mode?: string; actualMoneyCollectedNpr?: number;
    allocations?: Array<{ position: number; grossNpr: number; teacherNpr: number; fadkoNpr: number }> } | undefined;
  if (!booking || !receipt || receipt.mode !== "simulation" || receipt.actualMoneyCollectedNpr !== 0
    || !Array.isArray(receipt.allocations)) throw Error("Shadow automation requires an immutable simulated purchase with no real money.");
  const allocations = receipt.allocations.filter(row => row.position === position);
  if (allocations.length !== 1 || allocations[0]!.teacherNpr + allocations[0]!.fadkoNpr !== allocations[0]!.grossNpr) throw Error("The original allocation is ambiguous.");
  const lessons = await tx.execute(sql`SELECT s.id,s.teacher_id,s.date,s.duration,c.snapshot
    FROM batch_test_sessions m JOIN sessions s ON s.id=m.session_id
    JOIN batch_test_contracts c ON c.batch_id=m.batch_id
    JOIN session_enrollments e ON e.session_id=s.id AND e.student_id=${booking.student_id}
    WHERE m.batch_id=${booking.batch_id} AND m.position=${position} AND e.payment_status IN ('test','paid')`);
  const original = lessons.rows[0]; const snapshot = readBatchSnapshot(original?.snapshot);
  const promised = snapshot?.lessons.find(lesson => lesson.position === position);
  if (lessons.rows.length !== 1 || !original || !promised || Date.parse(promised.startsAt) !== epoch(original.date)
    || promised.durationMinutes !== Number(original.duration)) throw Error("The original purchased lesson no longer matches its frozen promise.");
  const cases = await tx.execute(sql`SELECT * FROM lesson_remedy_cases WHERE original_booking_id=${bookingId}
    AND original_position=${position} FOR UPDATE`);
  const c = cases.rows[0]; let remedy: AutomatedRemedyCase | null = null;
  if (c) {
    if (Number(c.student_id) !== Number(booking.student_id) || Number(c.original_session_id) !== Number(original.id)
      || Number(c.teacher_id) !== Number(original.teacher_id)) throw Error("The case does not belong to the locked original purchase.");
    const offers = await tx.execute(sql`SELECT * FROM lesson_remedy_offers WHERE case_id=${c.id}
      ORDER BY version DESC LIMIT 1 FOR UPDATE`);
    const offer = offers.rows[0];
    const warnings = offer ? await tx.execute(sql`SELECT consent FROM lesson_remedy_automation_warning_consents
      WHERE offer_id=${offer.id} AND booking_id=${bookingId} AND original_position=${position} AND student_id=${booking.student_id}`) : null;
    remedy = { id: Number(c.id), policyVersion: String(c.policy_version), reason: c.reason as AutomatedRemedyCase["reason"], state: c.status as AutomatedRemedyCase["state"],
      requestedAtMs: epoch(c.requested_at), teacherNonDeliveryConfirmed: c.teacher_non_delivery_confirmed === true,
      offer: offer ? { id: Number(offer.id), createdAtMs: epoch(offer.created_at), startsAtMs: epoch(offer.starts_at),
        endsAtMs: epoch(offer.ends_at), expiresAtMs: epoch(offer.expires_at), state: offer.status as "accepted",
        acceptedAtMs: offer.accepted_at ? epoch(offer.accepted_at) : null,
        replacementSessionId: offer.replacement_session_id ? Number(offer.replacement_session_id) : null } : null,
      warningConsent: warnings?.rows[0]?.consent as AutomatedRemedyCase["warningConsent"] ?? null };
  }
  const terms = await tx.execute(sql`SELECT * FROM lesson_remedy_automation_purchase_terms WHERE booking_id=${bookingId}`);
  const stored = terms.rows[0];
  const purchaseConsent: AutomatedPurchaseConsent | null = stored ? { bookingId, studentId: Number(stored.student_id),
    policy: stored.policy_snapshot, acceptedAtMs: epoch(stored.accepted_at), termsDigest: String(stored.terms_digest) } : null;
  if (stored && stored.policy_version !== REMEDY_AUTOMATION_VERSION) throw Error("The frozen automation policy version changed.");
  const history = await tx.execute(sql`SELECT to_state FROM batch_test_ledger_entries
    WHERE booking_id=${bookingId} AND position=${position} ORDER BY id DESC LIMIT 1`);
  const evidence = await tx.execute(sql`SELECT session_id,attestation FROM lesson_remedy_automation_evidence
    WHERE student_id=${booking.student_id} AND session_id IN (${original.id},${remedy?.offer?.replacementSessionId ?? original.id})`);
  const proof = (sessionId: number | null) => evidence.rows.find(row => Number(row.session_id) === sessionId)?.attestation as VerifiedRemedyEvidence | undefined;
  const disputes = await tx.execute(sql`SELECT id FROM disputes WHERE user_id=${booking.student_id}
    AND session_id IN (${original.id},${remedy?.offer?.replacementSessionId ?? original.id})
    AND reason IN ('Payment Issue','Refund Request') AND status IN ('open','opened','assigned','processing','in_review') LIMIT 1`);
  return { bookingId, position, studentId: Number(booking.student_id), originalSessionId: Number(original.id),
    bookingCreatedAtMs: epoch(booking.created_at), originalStartsAtMs: epoch(original.date),
    originalEndsAtMs: epoch(original.date) + Number(original.duration) * 60_000,
    grossNpr: allocations[0]!.grossNpr, allocationState: (history.rows[0]?.to_state ?? "future") as AutomatedRemedyFacts["allocationState"],
    paymentMode: "simulation", purchaseConsent, originalEvidence: proof(Number(original.id)) ?? null,
    replacementEvidence: proof(remedy?.offer?.replacementSessionId ?? null) ?? null,
    remedy, humanFinancialReviewOpen: disputes.rows.length > 0, nowMs };
}

export function postgresRemedyAutomationShadowAdapter(): AutomatedRemedyAdapter {
  return { transaction(run) { return db.transaction(async tx => {
    if (!await storageReady(tx)) throw Error("Automation shadow storage is not installed. No decision or payment changed.");
    return run({ loadLockedFacts: (bookingId, position, nowMs) => lockedShadowFacts(tx, bookingId, position, nowMs),
      async readAction(key) {
        const found = await tx.execute(sql`SELECT decision FROM lesson_remedy_automation_shadow_actions WHERE action_key=${key}`);
        return found.rows[0]?.decision as AutomatedRemedyDecision ?? null;
      }, async appendShadowAction(key, facts, decision) {
        await tx.execute(sql`INSERT INTO lesson_remedy_automation_shadow_actions
          (action_key,booking_id,original_position,original_session_id,student_id,policy_version,decision,evidence_references)
          VALUES(${key},${facts.bookingId},${facts.position},${facts.originalSessionId},${facts.studentId},${REMEDY_AUTOMATION_VERSION},
            ${JSON.stringify(decision)}::jsonb,${JSON.stringify({ original: facts.originalEvidence?.referenceDigest ?? null,
              replacement: facts.replacementEvidence?.referenceDigest ?? null })}::jsonb)`);
      } });
  }); } };
}

/** Executable test/dry-run hook only. Callers cannot attach arbitrary evidence or a refund amount. */
export async function auditStoredRemedyAutomation(input: { bookingId: number; position: number; nowMs: number },
  env: Record<string, string | undefined> = process.env) {
  return recordAutomatedRemedyShadow(postgresRemedyAutomationShadowAdapter(), input, env);
}

/** Closes only the isolated harness's imported pool. Not a route or app shutdown hook. */
export async function closeRemedyAutomationShadowTestPool(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.NODE_ENV !== "test" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/fadko_makeup_test[A-Za-z0-9_-]*$/.test(url.pathname)) throw Error("Refusing to close a shared application connection pool.");
  await pool.end();
}
