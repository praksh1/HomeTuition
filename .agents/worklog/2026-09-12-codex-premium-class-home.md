# Premium enrolled-class home — 12 September 2026

## Owner direction

After approving the public sharing correction, the owner asked for the approved preview to be released and for continuous work toward a premium platform. Previous review had also established that teachers and students should see their own payments or earnings, not Fadko's internal allocation or custody figures.

## Production release

- Integrated the complete owner-tested preview application onto `origin/main` without conflicts.
- The application tree at release commit `94b7d0d` matched the approved preview application tree; the only additional diff was the accumulated worklog documentation and equivalent fixture fixes already on main.
- Ran the dedicated safety workflow on `94b7d0d`; run `34710947423` passed all compile, unit, design, disposable-database, API and browser gates before main was advanced.
- Pushed `94b7d0d` to `main`. GitHub run `34711131979` performs the full production deploy and served-bundle verification. It was still running when this entry was written and must be followed through to completion.

One attempted guard command stopped before pushing because PowerShell interpreted Git's silent successful output as a false value. No remote state changed. The corrected guard checked `$LASTEXITCODE`; `origin/main` was then proven to be an ancestor of the release commit before the push.

## Premium phase 1: participant-safe class home

### Problem found

The dedicated teacher/student statements already filtered platform accounting correctly, but `GET/POST /batch-tests/:id` still returned the full internal receipt. `BatchTestPanel` then showed both the teacher and Fadko allocations, gross held funds and platform earnings to ordinary participants. This contradicted the owner-approved product rule and made the first screen after enrolment look like an internal reconciliation console.

### Changes

- Reused the existing role-filtered `participantReceiptView` at the class endpoint, so the server no longer sends Fadko allocation, platform earnings or gross custody data to teachers or students.
- Replaced the receipt/accounting console in `BatchTestPanel` with a compact enrolled-class home:
  - a clear enrolled/ready state;
  - the next lesson and one primary action;
  - the participant's own test payment or the teacher's expected test earnings;
  - a link to the appropriate full payment/earnings history;
  - the remaining lesson schedule behind one optional disclosure.
- Kept the operator reconciliation ledger unchanged. Operators still need the internal split and exception evidence for support and reconciliation.
- Preserved the simulation boundary: no payment provider, wallet, card, PIN or real-money mutation was added.

The first implementation keyed the new home only to `booked`. That works for a student but not a teacher: a teacher owns the class rather than booking it. Corrected the readiness rule to use a participant booking for students and generated lesson links for teachers, then added a rendered teacher-ready case.

## Verification

- Sikshya typecheck: pass.
- API server typecheck: pass.
- Sikshya unit suite: 390 pass, 0 fail.
- Batch booking browser journey: 76 checks pass at 390 px and 1440 px, including both student-enrolled and teacher-ready states and negative assertions for platform allocation text.
- Design ratchet: unchanged at 94 hex literals / 282 raw sizes; no new leaks.
- `git diff --check`: clean.

The local real-database booking suite correctly refused to run because no disposable local PostgreSQL URL was provided. Do not point it at a shared database. The exact API journey must be run in the repository's GitHub safety workflow, which provisions its own disposable PostgreSQL service.

Local dependency-backed typechecks initially failed inside the restricted filesystem sandbox because Windows junction targets under `node_modules/.pnpm` were denied. The same commands passed outside that restriction; this was environmental, not a source change.

## Boundaries and next work

- No schema change, migration, production-data edit, purchase, real payment or video-provider change.
- This is the first premium learning-home slice, not the full learning portal.
- After owner review, the next slice should introduce a typed class-group home that can reuse the proven Monthly homework and class-message capabilities without ever treating a new batch ID as a legacy recurring-class ID. The intended hierarchy is: Next lesson, Homework, Class messages, Materials, Help.

## Safety-workflow correction

The first dedicated safety run reached the real batch-booking API journey and stopped on its final
automatic-cancellation assertion. The product transition had succeeded: the student's participant-
safe receipt said `replacement_pending`. The stale assertion also expected the operator-only
`needsAttention` flag in that student response, contradicting the privacy boundary this phase adds.
The journey now verifies the student-visible state through the student response and verifies the
support-attention flag through the operator ledger. No settlement, cancellation or API behaviour
was changed by this correction.
