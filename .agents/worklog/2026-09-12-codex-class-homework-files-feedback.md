# New class homework: files and teacher feedback

Date: 2026-09-12
Branch: `codex/class-homework-files-feedback`

## Owner request

Continue upgrading Fadko while the owner tests the earlier profile and class-message changes
together. Preserve and improve homework from the older Monthly experience without mixing its IDs
or tables into the new teaching-class system.

## Delivered

- A teacher can attach an optional photo or PDF question sheet when setting homework.
- A student can hand in words, a photo/PDF, or both. Selecting a file does not upload it by
  itself: the student selects it, sees its name, can remove it, and then explicitly presses Hand
  in.
- A student may replace an earlier answer. The screen says plainly that replacing work clears the
  earlier feedback.
- A teacher sees each student's answer privately, can open the submitted file, write individual
  feedback, and optionally attach a marked copy.
- The student sees the returned feedback and can open the marked copy.
- The existing R2 upload policy remains the authority: photos/PDFs only, 10 MB maximum, and the
  server checks the stored object rather than trusting the browser's filename or type.
- A question sheet is visible only to the teacher and booked students in that class. An answer or
  marked copy is visible only to the submitting student and the teacher. Other classmates are
  refused.
- The old Monthly homework implementation and its database tables/routes were not changed.

## Data and deployment safety

The only new database structure is additive: `class_group_homework_files`. It references the
already-additive class homework tables. There is no changed or dropped column. The API's existing
idempotent start-up guard creates it before routes are served.

Files are stored using the existing Cloudflare R2 service and credentials. No service was added,
no purchase was made, and no credential was printed or committed.

## Verification

- Full workspace typecheck: pass across libraries, API, app, scripts and mockup sandbox.
- Focused contract/UI tests: 8 passed, 0 failed.
- API unit suite: pass.
- Sikshya unit suite: 399 passed, 0 failed before the three new app tests; focused new tests add 3.
- Design lint: no new leaks, baseline unchanged at 94 hex literals / 282 raw sizes.
- `git diff --check`: clean.
- The real disposable-Postgres batch journey was extended to prove teacher-only feedback and
  student-only returned feedback. It is run by the repository safety workflow because this
  Windows workspace has no disposable local PostgreSQL instance.
- GitHub safety run `34731018484`: passed.
- Railway staging deployed commit `da26ba9`; the new feedback endpoint changed from 404 to the
  expected unauthenticated 401, proving the new route is live without using a real account.
- GitHub preview run `34731289398`: passed in 5m43s, including typecheck, disposable Postgres,
  program/attendance journeys, rendered browser checks, production-isolation checks and served
  bundle verification.
- Preview: `https://hometuition-preview.praksh-dhakal.workers.dev`.

## Not claimed

- No production deployment.
- No real payment.
- No change to Daily or LiveKit.
- No claim that an upload completed until the server verifies the object in R2.
- No claim that a teacher read the file; this feature records feedback, not view analytics.

## Next useful slice

After owner preview testing, add the same deliberate attachment interaction to new class messages
and improve class materials from URL-only to secure teacher-uploaded handouts. Keep both behind the
same batch authority and existing R2 policy.
