# Open simulated checkout for the private beta — 13 Sep 2026

## Owner decision

Remove the per-teacher and per-student operator-grant step from simulated checkout. The live site
is still private testing, no settlement account is attached, and the owner needs ordinary verified
accounts to rehearse enrolment, class homes, calls, homework, refunds and the accounting views.

## Implementation

- The two server switches and fixed `TEST_ACCESS_UNTIL` deadline remain the global kill switch.
- Anonymous, suspended, unverified and incomplete student accounts remain blocked.
- The class teacher must still be active, approved and email-verified.
- Reading a listing or quote creates no grant or financial row.
- A successful `fadko_test` confirmation automatically records any missing teacher/student grant,
  bounded to the fixed deadline and identifiable by a null `granted_by` plus the reason
  `Automatic private beta simulated checkout`.
- Existing active operator grants are reused.
- Declined simulations and every later refusal roll back without access or booking rows.
- Enrolments remain `test` / `test_access`, session price remains zero, and no gateway reference or
  real payment call exists.

The interface now calls this “Simulated checkout” and explains that signed-in, verified students
can use it without money. Operator-created wording was removed from student and teacher screens.

## Verification

- API build: pass
- API TypeScript: pass
- Sikshya TypeScript: pass
- API unit suite: pass
- Sikshya unit suite: 420 pass, 0 fail
- rendered batch checkout at both viewports: pass
- `git diff --check`: pass

The real-Postgres batch journey was extended to prove quote/decline write nothing, success creates
exactly bounded automatic audit rows, and generated enrolments remain test-only. This Windows host
has no disposable PostgreSQL service; that journey must run in the existing CI PostgreSQL job
before release.

The first CI run proved every new checkout assertion, then exposed a test-harness race later in
the journey: the inbox helper returned after the first of two asynchronously persisted homework
notices, while its caller immediately expected both. The helper now waits for the caller's expected
count. This does not change product notification delivery; it makes the existing two-notice proof
measure what its assertion says.
