# Commission classes: from listing to paid teaching, without losing learning tools

Owner: 11 Sep 2026. Teaching-plan transition is a separate preview from the approved planning release.

## Current evidence, not aspirations

Update11Sep: isolated `codex/batch-test-booking` now implements a test-only batch booking/session
bridge and frozen promises. See `.agents/worklog/2026-09-11-codex-batch-test-booking.md` for gates
and deployment status. The original bullets below describe the pre-pilot baseline. Real checkout,
commission allocation, payouts and new group learning portal are still unbuilt.

Update12Sep: the first new group home is now on preview, and
`codex/class-message-notifications` adds durable per-person message acknowledgements, class-home
unread badges, live refresh, device/browser cues and message-preference-aware notification/email
delivery. Attachments, reactions and marking/feedback parity remain future slices. Real purchases
remain deliberately unbuilt.

- New class setup persists Program/Batch/period snapshots, not live sessions or paid enrollments.
- Existing Program rehearsal is unique by Program/student, so cannot represent multiple batches.
- `membership.ts` gates sessions for BOTH socket and video. Keep that single authority.
- `portalAccess.ts` gates existing Monthly homework/messages and attachment recipients. It keeps
  former students read-only, hides pre-joining conversation except pinned messages, and preserves
  earlier history when a student returns. Do not wipe it when teacher sales are paused.
- Old tier storefront is preserved; new sales paused outside isolated tests in transition preview.

## Next implementation slice (engineering, test-only first)

1. Add batch-specific frozen purchases and per-purchased-lesson allocations. Freeze original offer
   version, exact lesson IDs/times/durations, selected future subset, actual amount, 70/30 split,
   complaint terms and purchase timestamp. Existing buyers retain their original terms.
2. Atomic confirmation: provider receipt must be genuine/unique; revalidate offer/version, capacity,
   server-time cutoff and student timetable; one confirmed payment -> one purchase. For a rehearsal,
   use explicit test enrollment and no provider-like receipt or paid-money total.
3. Lock commercial terms from the first confirmed purchase. Unpaid drafts remain editable; purchased
   timetable/price/lesson promises cannot change via publish, copy, close, parent republish or delete.
   Materials and announcements remain separately editable. Rescheduling needs a distinct audited
   consent/remedy flow, not a shortcut around the lock.
4. Map purchased lessons to sessions with a unique batch/lesson link, idempotently. Session access
   remains per-person and within existing server-time windows. A first buyer never admits every
   student. No free public room, no second billing of each materialised session, no legacy tier
   quota applied a second time to already commission-funded teaching.

## Learning portal slice (after purchase identity is real)

- One ongoing group home: Next lesson, Homework, Class messages, Materials, and Help.
- Preserve existing Monthly routes/data. New group references must be typed by kind and ID; never
  pass a new batch/group ID as a recurring-class ID just because both are integers.
- Reuse existing homework UI/validation, submission and marking behavior. Add an entitlement
  adapter for new groups rather than duplicating permission rules at each file endpoint.
- Preserve message attachments/reactions/pins/unread indicators; state read/seen only when an
  acknowledgement actually exists. Do not equate notification sent with message read.
- Test: teacher, current student, late joiner, returning student, expired/refunded student,
  unrelated teacher/student, storage recipient. Keep previous work accessible where entitled;
  no writing after enrollment expires and no access to other students' submissions.

## Activation gates

Licensed gateway/merchant arrangement, refund execution, payout reconciliation, fee/tax handling
and guardian purchase rules remain unresolved for real money. No provider purchase authorized.
Hide real Pay/Join until their prerequisites work together; never substitute a cosmetic button.

## Product explanation

Teacher: Create a class -> publish exact dates and total price -> students pay upfront -> teach,
assign practice and message the group -> eligible earnings after each lesson's complaint window.
Student: Find a class -> see total/count/dates -> pay -> enter purchased lessons and the group portal.
Those are the target journeys, not a claim that checkout is currently live.
