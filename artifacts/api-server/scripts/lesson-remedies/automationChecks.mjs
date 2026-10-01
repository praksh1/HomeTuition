/** Add-on to the loopback-only disposable PG harness. No network providers or cash operations. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function runAutomationChecks({ root, url, q, connect, check, fixture, acceptedPastFixture, DAY, HOUR }) {
  const parsed = new URL(url);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
  assert.match(parsed.pathname, /^\/fadko_makeup_test[A-Za-z0-9_-]*$/);
  const requireApi = createRequire(path.join(root, "artifacts/api-server/package.json"));
  const { build } = requireApi("esbuild");
  const scratch = await mkdtemp(path.join(tmpdir(), "fadko-remedy-automation-test-"));
  const outfile = path.join(scratch, "automation.mjs");
  const previous = { DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: process.env.NODE_ENV };
  const ownedCases = []; let module;
  try {
    process.env.DATABASE_URL = url; process.env.NODE_ENV = "test";
    const storePath = path.join(root, "artifacts/api-server/src/lib/lessonRemedyAutomationStore.ts");
    const rulesPath = path.join(root, "artifacts/api-server/src/lib/lessonRemedyAutomation.ts");
    await build({ stdin: { contents: `export * from ${JSON.stringify(storePath)}; export * from ${JSON.stringify(rulesPath)};`,
        resolveDir: root, sourcefile: "automation-test-entry.ts", loader: "ts" },
      outfile, bundle: true, platform: "node", format: "esm", external: ["pg-native"], logLevel: "silent",
      banner: { js: `import { createRequire as testCreateRequire } from 'node:module';
        const require = testCreateRequire(${JSON.stringify(pathToFileURL(path.join(root, "artifacts/api-server/package.json")).href)});` } });
    module = await import(pathToFileURL(outfile).href);
    const rules = module;
    await module.installRemedyAutomationShadowStorageForLocalTests();
    const env = { LESSON_REMEDY_AUTOMATION_MODE: "shadow" };
    const audit = (f) => module.auditStoredRemedyAutomation({ bookingId: f.bookingId, position: 0, nowMs: Date.now() }, env);
    const epoch = (value) => value instanceof Date ? value.getTime() : Date.parse(String(value));
    const attestation = (sessionId, verdict, finalizedAtMs) => ({ sessionId, verdict,
      source: "covered_server_records", referenceDigest: "a".repeat(64), finalizedAtMs,
      entireScheduledWindowCovered: true, outageDuringWindow: false, contradictory: false });
    async function prospectiveFixture() {
      const f = await fixture({ at: Date.now() - 5 * DAY });
      const accepted = await acceptedPastFixture(f); ownedCases.push(accepted.caseId);
      const originalAt = Date.parse(f.snapshot.lessons[0].startsAt);
      const originalEnd = originalAt + f.snapshot.lessons[0].durationMinutes * 60_000;
      const boughtAt = originalAt - DAY;
      // Every row belongs solely to this guarded synthetic fixture. These are not backfilled live terms.
      await q("UPDATE batch_test_bookings SET created_at=$2 WHERE id=$1", [f.bookingId, new Date(boughtAt)]);
      const policy = rules.snapshotAutomatedRemedyPolicy();
      const termsDigest = rules.automatedRemedyPurchaseDigest({ bookingId: f.bookingId, studentId: f.student.id, policy });
      await q(`INSERT INTO lesson_remedy_automation_purchase_terms
        (booking_id,student_id,policy_version,policy_snapshot,accepted_at,terms_digest)
        VALUES($1,$2,$3,$4,$5,$6)`, [f.bookingId, f.student.id, policy.version, JSON.stringify(policy), new Date(boughtAt), termsDigest]);
      await q("UPDATE lesson_remedy_cases SET policy_version=$2,policy_snapshot=$3,requested_at=$4 WHERE id=$1",
        [accepted.caseId, policy.version, JSON.stringify(policy), new Date(originalEnd)]);
      const offer = (await q("SELECT * FROM lesson_remedy_offers WHERE case_id=$1", [accepted.caseId])).rows[0];
      const identity = { bookingId: f.bookingId, position: 0, studentId: f.student.id,
        originalSessionId: f.sessionIds[0], offerId: offer.id,
        offerStartsAtMs: epoch(offer.starts_at), offerEndsAtMs: epoch(offer.ends_at), grossNpr: 1000 };
      const consent = { ...identity, replacementSessionId: accepted.replacementId,
        policyVersion: policy.version, warningVersion: rules.COURTESY_ABSENCE_WARNING_VERSION,
        digest: rules.courtesyAbsenceWarningDigest(identity), accepted: true, acceptedAtMs: epoch(offer.accepted_at) };
      await q(`INSERT INTO lesson_remedy_automation_warning_consents
        (offer_id,booking_id,student_id,original_position,consent,accepted_at) VALUES($1,$2,$3,0,$4,$5)`,
        [offer.id, f.bookingId, f.student.id, JSON.stringify(consent), offer.accepted_at]);
      const replacementEnd = epoch(offer.ends_at);
      for (const [sessionId, verdict, at] of [[f.sessionIds[0], "student_absent", originalEnd], [accepted.replacementId, "student_absent", replacementEnd]]) {
        await q(`INSERT INTO lesson_remedy_automation_evidence(session_id,student_id,attestation,finalized_at)
          VALUES($1,$2,$3,$4)`, [sessionId, f.student.id, JSON.stringify(attestation(sessionId, verdict, at)), new Date(at)]);
      }
      return { ...f, ...accepted, originalEnd, replacementEnd, offerId: offer.id };
    }
    const legacy = await fixture({ at: Date.now() - 5 * DAY });
    const legacyResult = await audit(legacy);
    check("automation shadow never retrofits old purchases without frozen checkout consent", !legacyResult.changed && legacyResult.decision.reason === "legacy_terms");
    const f = await prospectiveFixture();
    const results = await Promise.all(Array.from({ length: 25 }, () => audit(f)));
    check("25 PostgreSQL retries serialize on original payment and append one shadow refund intent", results.filter(row => row.changed).length === 1
      && Number((await q("SELECT count(*) n FROM lesson_remedy_automation_shadow_actions WHERE booking_id=$1", [f.bookingId])).rows[0].n) === 1);
    check("stored partial refund shadow is 70/30, teacher 0, and never a cash confirmation", results.every(row => row.decision.kind === "refund_intent"
      && row.decision.studentRefundNpr === 700 && row.decision.platformRetainedNpr === 300 && row.decision.teacherNpr === 0 && row.decision.paymentMoved === false));
    const totals = (await q("SELECT receipt FROM batch_test_payments WHERE booking_id=$1", [f.bookingId])).rows[0].receipt;
    check("shadow preserves original receipt shares, actual collected 0, and legacy ledger unchanged", totals.actualMoneyCollectedNpr === 0
      && totals.allocations[0].teacherNpr === 700
      && (await q("SELECT event FROM batch_test_ledger_entries WHERE booking_id=$1", [f.bookingId])).rows.every(row => row.event === "makeup_requested"));
    const race = await prospectiveFixture();
    const client = await connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT booking_id FROM batch_test_payments WHERE booking_id=$1 FOR UPDATE", [race.bookingId]);
      let settled = false; const waiting = audit(race).then(result => { settled = true; return result; });
      await new Promise(resolve => setTimeout(resolve, 150));
      check("automation audit waits behind the exact original payment-row lock", !settled);
      await client.query(`INSERT INTO batch_test_ledger_entries
        (booking_id,position,event,from_state,to_state,gross_npr,teacher_npr,fadko_npr,detail)
        VALUES($1,0,'synthetic_payout_race','eligible','paid_out',1000,700,300,'{"synthetic":true}')`, [race.bookingId]);
      await client.query("COMMIT");
      const result = await waiting;
      check("payout winning the lock turns stale refund preflight into reconciliation review", result.decision.kind === "review"
        && result.decision.reason === "already_paid_out"
        && !(await q("SELECT decision FROM lesson_remedy_automation_shadow_actions WHERE booking_id=$1", [race.bookingId])).rows.some(row => row.decision.kind === "refund_intent"));
    } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
    const failure = await prospectiveFixture();
    await q("UPDATE lesson_remedy_automation_evidence SET attestation=$3 WHERE session_id=$1 AND student_id=$2",
      [failure.replacementId, failure.student.id, JSON.stringify(attestation(failure.replacementId, "teacher_absent", failure.replacementEnd))]);
    const full = await audit(failure);
    check("verified teacher replacement absence queues a full original-allocation shadow refund", full.decision.kind === "refund_intent"
      && full.decision.studentRefundNpr === 1000 && full.decision.platformRetainedNpr === 0 && full.decision.teacherNpr === 0);
    const outage = await prospectiveFixture();
    await q("UPDATE lesson_remedy_automation_evidence SET attestation=$3 WHERE session_id=$1 AND student_id=$2",
      [outage.replacementId, outage.student.id, JSON.stringify({ ...attestation(outage.replacementId, "student_absent", outage.replacementEnd), outageDuringWindow: true })]);
    const uncertain = await audit(outage);
    check("a known outage stays a held review rather than automatic student forfeiture", uncertain.decision.kind === "review" && uncertain.decision.reason === "uncertain_evidence");
    check("schema prohibits fabricated cash movement even by a direct SQL attempt", await q("UPDATE lesson_remedy_automation_shadow_actions SET payment_moved=true WHERE booking_id=$1", [f.bookingId]).then(() => false, () => true));
    const disabled = await module.auditStoredRemedyAutomation({ bookingId: f.bookingId, position: 0, nowMs: Date.now() }, {});
    check("turning off shadow evaluation does not create or rewrite durable actions", !disabled.changed && disabled.decision.reason === "disabled");
  } finally {
    // Preserve the harness's historical v1 cases for subsequent generic CI suites. No original
    // receipt, ledger or enrollment is deleted; all fixtures were owned synthetic loopback rows.
    if (ownedCases.length) await q(`UPDATE lesson_remedy_cases SET policy_version='2026-09-29-v1',policy_snapshot=
      jsonb_build_object('version','2026-09-29-v1','kind','monthly_tuition','purchasedLessonCount',3,
        'courtesyLimit',2,'noRollover',true,'teacherApprovalRequired',true,'offerResponseHours',168,
        'replacementWithinDays',30,'reviewHours',48,'missedReplacement','human_review') WHERE id=ANY($1::int[])`, [ownedCases]);
    if (module) await module.closeRemedyAutomationShadowTestPool();
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    const resolved = path.resolve(scratch);
    assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep), "Generated bundle cleanup must stay under system temp.");
    await rm(resolved, { recursive: true, force: true });
  }
}
