import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/** Runs only inside run.mjs's explicitly local disposable PostgreSQL fixture. */
export async function runFinanceChecks({ api, q, connect, check, fixture, request, offer, accept, resolve, operator, outsider, acceptedPastFixture, DAY, HOUR }) {
  const ownReceipt = (response, f) => response.body?.receipts?.find((r) => r.bookingId === f.bookingId);
  const ledger = async (f, position = 0) => (await q("SELECT * FROM batch_test_ledger_entries WHERE booking_id=$1 AND position=$2 ORDER BY id DESC LIMIT 1", [f.bookingId, position])).rows[0];
  const f = await fixture();
  const requested = await request(f); assert.equal(requested.status, 200, JSON.stringify(requested));
  const caseId = requested.body.caseId;
  assert.equal((await offer(f, caseId)).status, 200);
  const acceptedKey = randomUUID();
  const accepted = await accept(f, caseId, acceptedKey); assert.equal(accepted.status, 200, JSON.stringify(accepted));
  const replacementId = accepted.body.replacementSessionId;

  await assert.rejects(q("UPDATE session_enrollments SET payment_status='refunded' WHERE session_id=$1 AND student_id=$2", [f.sessionIds[0], f.student.id]), /BATCH_TEST_BOOKING_REQUIRED/);
  check("original seat cannot be revoked without its exact refund ledger decision", true);
  await assert.rejects(q("UPDATE session_enrollments SET session_id=$1 WHERE session_id=$2 AND student_id=$3", [replacementId, f.sessionIds[0], f.student.id]), /BATCH_TEST_BOOKING_REQUIRED/);
  check("mapped original seat cannot escape to an unmapped replacement identity", true);
  const foreignStudent = (await q("INSERT INTO users(email,name,role,password_hash) VALUES($1,'Synthetic other booked student','student','synthetic-not-a-login') RETURNING id", [`${randomUUID()}@example.com`])).rows[0].id;
  const foreignGrant = (await q("INSERT INTO test_student_grants(student_id,reason,valid_until) VALUES($1,'Disposable identity-guard fixture',$2) RETURNING id", [foreignStudent, new Date(Date.now() + 120 * DAY)])).rows[0].id;
  await q("INSERT INTO batch_test_bookings(batch_id,student_id,student_grant_id,quote) VALUES($1,$2,$3,$4)", [f.batchId, foreignStudent, foreignGrant, JSON.stringify({ lessonPositions: [0] })]);
  await assert.rejects(q("UPDATE session_enrollments SET student_id=$1 WHERE session_id=$2 AND student_id=$3", [foreignStudent, f.sessionIds[0], f.student.id]), /BATCH_TEST_BOOKING_REQUIRED/);
  check("mapped original seat cannot transfer to a different already-booked student", true);

  const detail = await api(`/sessions/${replacementId}`, f.student.token);
  check("replacement detail links one original class and purchased lesson count", detail.status === 200 && detail.body.classGroup.makeup === true && detail.body.classGroup.batchId === f.batchId && detail.body.classGroup.originalSessionId === f.sessionIds[0] && detail.body.classGroup.lessonCount === f.sessionIds.length);
  check("private replacement detail is unavailable to anonymous and stranger IDs", (await api(`/sessions/${replacementId}`)).status === 404 && (await api(`/sessions/${replacementId}`, outsider.token)).status === 404);
  const ownSchedule = await api(`/sessions?studentId=${f.student.id}`, f.student.token);
  const fakeSchedule = await api(`/sessions?studentId=${f.student.id}`, outsider.token);
  const publicTeacherSchedule = await api(`/sessions?teacherId=${f.teacher.id}`);
  check("replacement schedule requires authenticated ownership, not query IDs", ownSchedule.body.sessions.some((s) => s.id === replacementId) && !fakeSchedule.body.sessions.some((s) => s.id === replacementId) && !publicTeacherSchedule.body.sessions.some((s) => s.id === replacementId));
  check("replacement cannot enter public standalone catalog", !(await api(`/sessions?catalog=standalone&teacherId=${f.teacher.id}`)).body.sessions.some((s) => s.id === replacementId));
  const drop = await api(`/sessions/${replacementId}/drop-info`, f.student.token);
  check("legacy drop adapter shows original allocation, not zero-price replacement refund", drop.status === 200 && drop.body.canDrop === false && drop.body.originalSessionId === f.sessionIds[0]);
  check("legacy drop write cannot mint a refund for a class allocation", (await api(`/sessions/${replacementId}/drop`, f.student.token, {})).status === 409);
  check("legacy operator full refund routes back to exact original receipt", (await api(`/admin/sessions/${replacementId}/refund`, operator.token, { studentId: f.student.id, note: "Synthetic operator checking the original receipt allocation." })).status === 409);
  const material = (await q("INSERT INTO class_group_materials(batch_id,teacher_id,title,note) VALUES($1,$2,'Synthetic teaching note','No personal data or external media.') RETURNING id", [f.batchId, f.teacher.id])).rows[0];
  check("replacement retains class material access without separate purchase", (await api(`/class-groups/${f.batchId}/materials`, f.student.token)).body.materials.some((m) => m.id === material.id));
  check("stranger cannot inspect replacement's original materials", (await api(`/class-groups/${f.batchId}/materials`, outsider.token)).status === 403);
  const teacherMoney = await api("/batch-tests/me/payments", f.teacher.token);
  const receipt = ownReceipt(teacherMoney, f);
  check("teacher held accounting retains every nonterminal original allocation", teacherMoney.body.makeupsEnabled === true && receipt.accounting.heldGrossNpr === 3000 && receipt.allocations[0].remedy.allocationHeld && receipt.allocations[0].remedy.additionalChargeNpr === 0 && receipt.accounting.actualMoneyMovedNpr === 0);
  for (const event of ["lesson_delivered", "complaint_window_closed", "makeup_delivery_confirmed", "makeup_review_restored", "payout_confirmed"]) {
    check(`generic operator cannot fabricate make-up event ${event}`, (await api(`/admin/batch-test-payments/${f.bookingId}/allocations/0/events`, operator.token, { event, note: "Synthetic no-bypass check." })).status === 409);
  }

  await q("INSERT INTO operator_accounts(user_id,login_id,must_change_password) VALUES($1,$2,false) ON CONFLICT(user_id) DO UPDATE SET must_change_password=false", [operator.id, `synthetic-${operator.id}`]);
  const closureRequest = await api("/account-closure", f.student.token, { confirmed: true });
  assert.equal(closureRequest.status, 200, JSON.stringify(closureRequest));
  const closure = await api(`/account-closure-review/${f.student.id}`, operator.token);
  check("pending make-up blocks closure once, not once per case plus allocation", closure.status === 200 && closure.body.commitments.pendingMakeups === 1 && closure.body.blockers.length > 0 && closure.body.completionAvailable === false);

  // A replacement may legally finish beyond its original monthly paid period. Reproduce
  // that boundary with past accepted synthetic records, not a renewal or another charge.
  const afterPeriod = await fixture({ at: Date.now() - 30 * DAY - 15 * 60000 });
  const ap = await acceptedPastFixture(afterPeriod);
  const starts = new Date(Date.parse(afterPeriod.snapshot.tuitionPeriod.endsAt));
  await q("UPDATE sessions SET date=$2,status='live' WHERE id=$1", [ap.replacementId, starts]);
  await q("UPDATE lesson_remedy_offers SET starts_at=$2,ends_at=$3,expires_at=$2 WHERE case_id=$1 AND accepted_at IS NOT NULL", [ap.caseId, starts, new Date(starts.getTime() + 30 * 60000)]);
  const currentAccess = await api(`/sessions/${ap.replacementId}/access`, afterPeriod.student.token);
  check("accepted replacement after monthly period end remains joinable without renewal", starts.getTime() < Date.now() && currentAccess.status === 200 && currentAccess.body.isEnrolled && currentAccess.body.canJoin);
  check("replacement classroom issues only its already-booked participant access", (await api(`/sessions/${ap.replacementId}/room`, afterPeriod.student.token)).status === 200 && (await api(`/sessions/${ap.replacementId}/room`, outsider.token)).status === 403);
  check("no extra class charge or receipt is created after period end", Number((await q("SELECT count(*) AS n FROM batch_test_payments WHERE booking_id=$1", [afterPeriod.bookingId])).rows[0].n) === 1);

  // Refund/support flow names the replacement, yet holds the original paid allocation.
  const delivered = await fixture({ at: Date.now() - 5 * DAY }); const d = await acceptedPastFixture(delivered);
  await q("INSERT INTO session_activity(session_id,ended_at) VALUES($1,$2)", [d.replacementId, new Date(d.replacementAt + 30 * 60000)]);
  await q("INSERT INTO session_participation(session_id,user_id,role,present_ms,join_count) VALUES($1,$2,'teacher',1800000,1)", [d.replacementId, delivered.teacher.id]);
  assert.equal((await resolve(operator, d.caseId, "replacement_delivered")).status, 200);
  const originalDeadline = (await q("SELECT replacement_review_closes_at FROM lesson_remedy_cases WHERE id=$1", [d.caseId])).rows[0].replacement_review_closes_at;
  const support = await api("/disputes", delivered.student.token, { reason: "Refund Request", description: "Synthetic replacement delivery needs human financial review.", sessionId: d.replacementId });
  assert.equal(support.status, 201, JSON.stringify(support));
  check("replacement-linked financial support atomically freezes original allocation", (await ledger(delivered)).to_state === "disputed" && (await q("SELECT status FROM lesson_remedy_cases WHERE id=$1", [d.caseId])).rows[0].status === "review_required");
  check("delivery review cannot implicitly deny original or replacement financial ticket", (await resolve(operator, d.caseId, "replacement_delivered")).status === 409 && (await resolve(operator, d.caseId, "refund_denied")).status === 409);
  // Simulate a separately completed, documented human Support decision; the make-up
  // restoration endpoint must still preserve (not shorten/reset) the confirmed clock.
  await q("UPDATE disputes SET status='denied',resolved_at=now(),resolution='Synthetic separately reviewed decision' WHERE id=$1", [support.body.id]);
  assert.equal((await resolve(operator, d.caseId, "refund_denied")).status, 200);
  const restored = (await q("SELECT status,replacement_review_closes_at FROM lesson_remedy_cases WHERE id=$1", [d.caseId])).rows[0];
  check("explicit human refund denial restores pending review, not instant payout", restored.status === "delivered_review" && restored.replacement_review_closes_at.getTime() === originalDeadline.getTime() && (await ledger(delivered)).to_state === "delivered_pending");
  check("restored make-up still refuses payout before the same 48h deadline", (await api(`/admin/batch-test-payments/${delivered.bookingId}/allocations/0/events`, operator.token, { event: "payout_confirmed" })).status === 409);
  await q("UPDATE lesson_remedy_cases SET replacement_review_closes_at=now()-interval '1 second' WHERE id=$1", [d.caseId]);
  const afterReview = ownReceipt(await api("/batch-tests/me/payments", delivered.student.token), delivered);
  check("only elapsed confirmed replacement clock admits original earning", afterReview.allocations[0].state === "eligible" && afterReview.allocations[0].remedy.allocationHeld === false);
  assert.equal((await api(`/admin/batch-test-payments/${delivered.bookingId}/allocations/0/events`, operator.token, { event: "payout_confirmed" })).status, 200);
  check("one replacement pays out original amount exactly once in simulation", (await ledger(delivered)).to_state === "paid_out" && (await ledger(delivered)).gross_npr === 1000 && (await api(`/admin/batch-test-payments/${delivered.bookingId}/allocations/0/events`, operator.token, { event: "payout_confirmed" })).status === 409);
  check("settled replacement fulfillment closes its durable make-up case", (await q("SELECT status,outcome FROM lesson_remedy_cases WHERE id=$1", [d.caseId])).rows[0].status === "resolved");
  assert.equal((await api("/account-closure", delivered.student.token, { confirmed: true })).status, 200);
  const settledClosure = await api(`/account-closure-review/${delivered.student.id}`, operator.token);
  check("settled fulfilled replacement does not block account closure forever", settledClosure.status === 200 && settledClosure.body.commitments.pendingMakeups === 0);

  // Exercise the older operator ledger route, which must have the same seat revocation
  // and case finality as the new make-up operator portal.
  const refund = await api(`/admin/batch-test-payments/${f.bookingId}/allocations/0/events`, operator.token, { event: "refund_approved", note: "Synthetic documented human approval from original receipt." });
  assert.equal(refund.status, 200, JSON.stringify(refund));
  check("generic human refund revokes original and replacement seats together", (await q("SELECT 1 FROM session_enrollments WHERE session_id=ANY($1::int[]) AND student_id=$2 AND payment_status IN ('paid','test')", [[f.sessionIds[0], replacementId], f.student.id])).rowCount === 0);
  await assert.rejects(q("UPDATE session_enrollments SET payment_status='test' WHERE session_id=$1 AND student_id=$2", [f.sessionIds[0], f.student.id]), /BATCH_TEST_BOOKING_REQUIRED/);
  check("refunded original seat cannot be resurrected by a later test-status write", true);
  const refundedAccess = await api(`/sessions/${replacementId}/access`, f.student.token);
  check("refund approval denies replacement access even though its price is zero", refundedAccess.status === 200 && !refundedAccess.body.isEnrolled && !refundedAccess.body.canJoin);
  const history = await api(`/class-groups/${f.batchId}/remedies`, f.student.token);
  check("refunded case remains readable without any new participant actions", history.status === 200 && history.body.lessons.find((l) => l.originalSessionId === f.sessionIds[0]).case.status === "resolved" && !history.body.lessons.find((l) => l.originalSessionId === f.sessionIds[0]).canRequest);
  const acceptedOfferId = (await q("SELECT id FROM lesson_remedy_offers WHERE case_id=$1 AND accepted_at IS NOT NULL", [caseId])).rows[0].id;
  const replayedAcceptance = await api(`/lesson-remedies/${caseId}/accept`, f.student.token, { offerId: acceptedOfferId, requestKey: acceptedKey });
  check("committed acceptance replay after refund returns history without reviving either seat", replayedAcceptance.status === 200 && replayedAcceptance.body.changed === false && replayedAcceptance.body.replacementSessionId === replacementId && (await q("SELECT 1 FROM session_enrollments WHERE session_id=ANY($1::int[]) AND student_id=$2 AND payment_status IN ('paid','test')", [[f.sessionIds[0], replacementId], f.student.id])).rowCount === 0);
  check("no simulated class decision creates real cash refund debt", Number((await q("SELECT count(*) AS n FROM refunds WHERE session_id=ANY($1::int[])", [[f.sessionIds[0], replacementId, d.replacementId]])).rows[0].n) === 0);

  // A very busy class must not push an older active case beyond the queue's row cap.
  const busy = await fixture({ count: 501, monthly: false });
  const busyRequest = await request(busy, 0); assert.equal(busyRequest.status, 200, JSON.stringify(busyRequest));
  const studentQueue = await api("/lesson-remedies", busy.student.token);
  const teacherQueue = await api("/lesson-remedies", busy.teacher.token);
  check("student queue prioritizes active cases and declares truncation", studentQueue.status === 200 && studentQueue.body.truncated === true && !!studentQueue.body.truncationReason && studentQueue.body.lessons[0].case?.id === busyRequest.body.caseId);
  check("teacher queue excludes hundreds of lessons without a request", teacherQueue.status === 200 && teacherQueue.body.lessons.length === 1 && teacherQueue.body.lessons[0].case.id === busyRequest.body.caseId && teacherQueue.body.truncated === false);
  const ownOperatorCase = (await api("/admin/lesson-remedies", operator.token)).body.lessons.find((l) => l.case?.id === busyRequest.body.caseId);
  check("operator queue keeps existing active cases accessible before unrelated lessons", !!ownOperatorCase);
  const declined = await resolve(operator, busyRequest.body.caseId, "refund_review", { confirmed: false, requestKey: randomUUID() });
  check("all operator outcomes require explicit reviewed-evidence confirmation", declined.status === 400);

  const contextFixture = await fixture();
  const contextRequest = await request(contextFixture); assert.equal(contextRequest.status, 200, JSON.stringify(contextRequest));
  const contextCaseId = contextRequest.body.caseId;
  const teacherContext = (await api(`/class-groups/${contextFixture.batchId}/remedies`, contextFixture.teacher.token)).body.lessons.find((l) => l.case?.id === contextCaseId).case;
  check("teacher receives the student's make-up explanation, not a context-free request", teacherContext.requestNote === "Synthetic request for the original purchased lesson.");
  const teacherReason = "I cannot offer that date; please contact me about another time.";
  assert.equal((await api(`/lesson-remedies/${contextCaseId}/decision`, contextFixture.teacher.token, { decision: "reject", note: teacherReason, requestKey: randomUUID() })).status, 200);
  await q("INSERT INTO lesson_remedy_events(case_id,actor_id,actor_role,event,from_status,to_status,detail) VALUES($1,$2,'operator','resolve','review_required','review_required',$3)", [contextCaseId, operator.id, JSON.stringify({ note: "PRIVATE OPERATOR EVIDENCE MUST NOT LEAK" })]);
  const studentContext = await api(`/class-groups/${contextFixture.batchId}/remedies`, contextFixture.student.token);
  check("student receives teacher's clear reason but no operator's private evidence notes", studentContext.body.lessons.find((l) => l.case?.id === contextCaseId).case.teacherDecisionReason === teacherReason && !JSON.stringify(studentContext.body).includes("PRIVATE OPERATOR"));

  // Reproduce the ordinary booking/create order deterministically. The owner holds the
  // teacher advisory and then reads that user's row. A make-up may wait for the advisory,
  // but cannot already hold the user UPDATE lock and create a cycle with that owner.
  const lockingFixture = await fixture();
  const lockingRequest = await request(lockingFixture); assert.equal(lockingRequest.status, 200, JSON.stringify(lockingRequest));
  const lockingCase = lockingRequest.body.caseId;
  async function assertTeacherLockPrecedesUsers(label, operation) {
    const owner = await connect(); let pending; let settled;
    try {
      await owner.query("BEGIN");
      await owner.query("SET LOCAL statement_timeout='5s'");
      await owner.query("SELECT pg_advisory_xact_lock(838201,$1)", [lockingFixture.teacher.id]);
      // Attach the rejection handler immediately so an HTTP timeout never becomes unhandled.
      pending = operation().then(response => ({ response }), error => ({ error }));
      let blocked = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        blocked = (await q("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=838201::oid AND objid=$1::oid AND NOT granted) AS waiting", [lockingFixture.teacher.id])).rows[0].waiting;
        if (blocked) break;
        await new Promise(resolveWait => setTimeout(resolveWait, 100));
      }
      assert.equal(blocked, true, `${label} must be waiting at its teacher schedule advisory`);
      await owner.query("SET LOCAL lock_timeout='1s'");
      await owner.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [lockingFixture.teacher.id]);
      check(`${label} cannot hold a teacher user lock while waiting for the teacher schedule lock`, true);
    } finally {
      try { await owner.query("ROLLBACK"); } finally { owner.release(); }
      // HTTP has a 30s bound; release the advisory before waiting for its result.
      if (pending) settled = await pending;
    }
    if (settled?.error) throw settled.error;
    assert.equal(settled?.response.status, 200, JSON.stringify(settled?.response));
  }
  await assertTeacherLockPrecedesUsers("Make-up offer", () => offer(lockingFixture, lockingCase));
  await assertTeacherLockPrecedesUsers("Make-up acceptance", () => accept(lockingFixture, lockingCase));
  // A booking's first read is not a promise that remains true while it waits for
  // the target row. Hold an uncommitted teacher edit, prove that exact blocking
  // relationship, then let the booking see the committed interval/quote under lock.
  const bookingRace = await fixture();
  await q("INSERT INTO account_security(user_id,email_verified_at) VALUES($1,now()) ON CONFLICT(user_id) DO UPDATE SET email_verified_at=now()", [bookingRace.student.id]);
  await q("INSERT INTO user_onboarding(user_id,phone,profile_photo_key,completed_at) VALUES($1,'9800000000',$2,now()) ON CONFLICT(user_id) DO UPDATE SET phone=EXCLUDED.phone,profile_photo_key=EXCLUDED.profile_photo_key,completed_at=EXCLUDED.completed_at", [bookingRace.student.id, `synthetic/profile-${bookingRace.student.id}.jpg`]);
  const existingStart = Date.parse(bookingRace.snapshot.lessons[0].startsAt);
  const teacherGrant = (await q("SELECT id FROM test_teaching_grants WHERE teacher_id=$1 ORDER BY id DESC LIMIT 1", [bookingRace.teacher.id])).rows[0].id;
  const seatsBefore = (await q("SELECT session_id,payment_status,payment_method,payment_reference FROM session_enrollments WHERE student_id=$1 ORDER BY session_id", [bookingRace.student.id])).rows;
  const receiptBefore = (await q("SELECT receipt FROM batch_test_payments WHERE booking_id=$1", [bookingRace.bookingId])).rows[0].receipt;

  async function assertBookingUsesLockedDetails(label, setClause, values, responseMatches) {
    const target = (await q("INSERT INTO sessions(teacher_id,teacher_name,subject,topic,date,duration,max_students,enrolled_count,price) VALUES($1,'Synthetic teacher','Maths','Synthetic ordinary race lesson',$2,30,10,0,500) RETURNING id", [bookingRace.teacher.id, new Date(existingStart - HOUR)])).rows[0].id;
    await q("INSERT INTO test_classes(session_id,teacher_id,grant_id) VALUES($1,$2,$3)", [target, bookingRace.teacher.id, teacherGrant]);
    const owner = await connect(); let pending; let settled;
    try {
      await owner.query("BEGIN");
      await owner.query("SET LOCAL statement_timeout='5s'");
      const ownerPid = (await owner.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await owner.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [target]);
      // Only static fixture SQL reaches this helper; no user input is interpolated.
      await owner.query(`UPDATE sessions SET ${setClause} WHERE id=$1`, [target, ...values]);
      pending = api(`/sessions/${target}/book`, bookingRace.student.token, { paymentMethod: "esewa" })
        .then(response => ({ response }), error => ({ error }));
      let blocked = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        blocked = (await q("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock') AS waiting", [ownerPid])).rows[0].waiting;
        if (blocked) break;
        await new Promise(resolveWait => setTimeout(resolveWait, 100));
      }
      assert.equal(blocked, true, `${label} booking must wait for the exact teacher-edit row owner`);
      await owner.query("COMMIT");
    } finally {
      try { await owner.query("ROLLBACK"); } finally { owner.release(); }
      // Always free the held row before awaiting the already-bounded HTTP call.
      if (pending) settled = await pending;
    }
    if (settled?.error) throw settled.error;
    const response = settled?.response;
    check(`${label} is rechecked from the current locked lesson before payment`, response?.status === 409 && responseMatches(response.body));
    check(`${label} refusal writes no enrollment, receipt reference or consumed seat`, (await q("SELECT 1 FROM session_enrollments WHERE session_id=$1", [target])).rowCount === 0 && (await q("SELECT enrolled_count FROM sessions WHERE id=$1", [target])).rows[0].enrolled_count === 0);
    const seatsAfter = (await q("SELECT session_id,payment_status,payment_method,payment_reference FROM session_enrollments WHERE student_id=$1 ORDER BY session_id", [bookingRace.student.id])).rows;
    const receiptsAfter = (await q("SELECT receipt FROM batch_test_payments WHERE booking_id=$1", [bookingRace.bookingId])).rows;
    check(`${label} refusal preserves every original seat and the sole original payment`, JSON.stringify(seatsAfter) === JSON.stringify(seatsBefore) && receiptsAfter.length === 1 && JSON.stringify(receiptsAfter[0].receipt) === JSON.stringify(receiptBefore));
  }
  await assertBookingUsesLockedDetails("Concurrent overlapping reschedule", "date=$2", [new Date(existingStart + 10 * 60000)], body => /overlap/i.test(body?.error ?? ""));
  await assertBookingUsesLockedDetails("Concurrent overlapping duration increase", "duration=$2", [90], body => /overlap/i.test(body?.error ?? ""));
  await assertBookingUsesLockedDetails("Concurrent price change", "price=$2", [550], body => body?.refreshRequired === true);
  await assertBookingUsesLockedDetails("Concurrent lesson topic change", "topic=$2", ["Synthetic changed lesson promise"], body => body?.refreshRequired === true);
  await assertBookingUsesLockedDetails("Concurrent expired reschedule", "date=$2", [new Date(Date.now() - 2 * HOUR)], body => body?.started === true);
}
