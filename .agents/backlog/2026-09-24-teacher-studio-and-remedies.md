# Teacher studio, booking reliability and learning follow-ups

Owner request: 24 September 2026. Promote the verified support work to production; the owner is the current tester. No purchases or real-payment activation authorized. Preserve the accepted classroom and all existing purchased promises.

## Implementation queue

- [x] Dashboard Upcoming and Sessions Upcoming now share nearest-first server pagination and the same end/overtime cutoff. Real-API regression includes 181 lessons, exceeding both old page limits.
- [x] Repair reproduced post-commit notification failures, ambiguous lost checkout responses, and stale-quote recovery. Existing atomic capacity, duplicate-booking, cutoff and student-conflict protections retained; 143 real-API booking checks pass. This is not a claim that every unspecified payment error has been reproduced.
- [x] Read-only timetable preflight on the date step exposes every affected lesson (up to three conflicts per lesson); all lesson editors stay in one screen. Other-class links remain server-authorized/editability-gated; publish rechecks under its existing lock.
- [x] English / Nepali / Both / Other choices with required custom value, optional course outline, independent-tutor copy. The four-step flow remains; no unsupported promise of a complete one-screen wizard replacement.
- [x] Explicit joining decision required for new classes. Late joining is offered only for eligible ongoing tuition; fixed-course and purchased-promise rules unchanged.
- [x] Search/filter/grouped date sets, compact laptop rows and phone-sized actions; schedule shortcut. List no longer launches a checkout/settlement read for every published card. Reassess density with the owner's actual full-time workload.
- [x] Expanded publication confirmation shows description, language, price, capacity and exact lessons, with the paid-commitment warning.
- [ ] Design one simple make-up/remedy workflow for student absence and teacher non-delivery. Product proposal first; no new automatic refund/forfeiture policy without owner approval. Preserve original entitlements and prevent duplicate refund plus replacement access.
- [x] Quiz first release implemented and feature-tested: local text-based PDF/text conversion inside Homework, private drafts, per-question confirmation, immutable publication, one server-graded practice attempt, hidden open answer key, paged teacher results and notifications. See `docs/FADKO-QUIZZES-2026-09-24.md` for limits (no OCR/essays/answer variants; PDF conversion on web) and `.agents/worklog/2026-09-24-codex-queued-learning-release.md` for deployment evidence. A checked box here is not itself a live-release claim.

## Carry-forward work (not forgotten)

- Four classroom items are implemented in `2026-09-24-classroom-followups.md`: student count parity; clear-board access on teacher phone; usable participants sheet with 50 students/10 raised hands; authorized student participant directory/private messaging. See the classroom-followups worklog for verified release state, not this checkbox alone.
- Support roadmap remains in `docs/FADKO-SUPPORT-FREE-FIRST-2026-09-24.md`: review/publish private guides; independently reconcile provider payments; evidence attachments/vision with consent and access controls; deeper diagnostics; operator workspace; measured provider/pilot quality. Refunds and bans stay human-only. Production approval does not activate a paid provider or grant permission to send private evidence externally.

## Proposed make-up policy (discussion, NOT active policy)

One case per original enrollment/lesson, with an optional replacement offer and explicit student acceptance. Original lesson and evidence remain unchanged. Teacher absence should not force a student to accept a new date; preserve the existing refund review route. A student no-show may request a teacher-approved courtesy replacement, but neither automatic refund nor guaranteed replacement is promised. Any replacement must be conflict-checked, capacity-aware, linked to its original entitlement and non-chargeable; accepting/holding/completing/refunding must be auditable and mutually consistent. Timeout and cancellation details require owner agreement before implementation.

Detailed proposal and quiz boundary: `docs/FADKO-LESSON-REMEDIES-AND-QUIZZES-2026-09-24.md`. Completed boxes above mean implemented and verified in isolated tests; production release evidence belongs in `.agents/worklog/2026-09-24-codex-teacher-studio.md`, not inferred from this checklist.
