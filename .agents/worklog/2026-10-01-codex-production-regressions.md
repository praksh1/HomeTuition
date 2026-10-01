# Production lesson and messaging regressions

- Date: 2026-10-01
- Agent: Codex
- Branch: codex/sep30-reliability-and-launch-readiness
- Base commit: 0c1cfb58
- Status: local fixes verified; exact-export and release gates in progress, not yet deployed.

## Requested

Repair the owner's recorded Production lesson crashes, typing delay, newest-message opening,
unbracketed counts and confusing replacement form. Audit the wider teacher/student journey,
then move routine make-ups toward deterministic automation with reliable evidence and the
original payment allocation. Preserve phone browser testing until native apps are released.

## Changed

- DropClass now distinguishes a linked class-purchase response from legacy cancellation
  quotes. Missing money cannot crash the lesson or create a guessed refund; zero-based
  allocation position 0 remains valid. The action preserves the original lesson identity.
- Direct/class messages use newest-first virtualized lists and exact newest offset on
  opening/refocus, not a 120 ms estimated scroll-to-end. Unchanged refreshes reuse rows;
  pre-send reads cannot discard successful sends; earlier class history is retained.
- Classroom input state lives in its composer, not the board/call parent. Failed or
  disconnected sends retain the draft; Enter sends, Shift+Enter and IME remain supported.
- Cached message date formatters remove repeated Intl constructor work while typing.
- Shared count labels use parentheses in Classes, Notifications and student-directory
  filters, including known zeroes, without changing the existing Production grouping.
- Replacement dates respect the original finish, server time and full replacement duration
  within the existing deadline. Invalid dates are rejected beside the form before a request.
  A specific, explained Replace undelivered lesson action replaces the separate confession
  toggle; I taught this lesson has a distinct review path. This is still explicit teacher
  acknowledgement, not fabricated proof of absence.
- New crash/long-history/typing/count tests are wired into the non-deploying booking CI
  workflow. Its timeout is a 40-minute ceiling, not an artificial delay.

## Decisions and assumptions

The approved prospective September 30 policy remains unchanged. This is a participant UI
regression release: no server, schema, gateway, payout, teacher verification or owner-access
changes. Preview and Production are divergent tracks; only reviewed scoped patches are paired.

## Verification

- The owner's 6:28.93 laptop recording shows Production URLs. Decoded selected local frames;
  no physical iPhone/Android execution or phone-performance score is claimed.
- Before changes, both public roots and API readiness returned 200. Production entry was
  entry-aa4e17e87f221dd76192a6d268e801b8.js; readiness alone did not disprove the crash.
- Exact old actual-export crash reproduced at 320 px with enrolled:true, canDrop:false and
  sparse linked-allocation data: Something went wrong / Please reload / Try Again.
- 39 drop contract unit cases; 285 bundled component assertions, including position 0.
- Workspace typecheck passed. 708 app pure tests passed (before the final position fixture
  update; exact-source rerun remains required). API pure tests: 886 passed, no failures.
- Production design ratchet passed at its existing 56 hex / 211 raw-size baseline.
- Count browser fixtures: Notifications 75, roster 54, Classes 60 at 320/390/1440 px.
- Make-up helper 11 tests and 105 form assertions at 320/390/1440 passed.
- Message source is also tested with 250 variable-height rows and CPU slowdown. Final
  paired export/CI totals and release identifiers must be appended after actual execution.

## Problems and surprises

The old lesson fixture answered enrolled:false and masked the actual newer response shape.
Count changes existed on Preview, not on the Production screens in the recording. The old
fixed tail-scroll delay fails with a realistic long conversation; in-class typing still
updated the entire board/call parent despite earlier standalone chat work.

## Fabrications found

No claim that v2 automatic refunds are active. The current rule engine/storage adapter are
shadow-only: authoritative observation-health writing, frozen checkout/offer consent and
deadline execution are not integrated. No attendance rows is not proof of non-delivery.
A refund intention/test simulation is never proof of a completed real bank refund.

## Deliberately not changed

No real accounts, messages, lessons, identity files, tickets, financial rules, provider
credentials, purchases, migrations, operator provisioning or phone browser lockout changed.
Preview's pre-existing Schedule pagination and Start/Join changes are not copied into this
Production release. No API redeployment is needed for this UI repair.

## Remaining risks / next pickup point

Fresh participant export, real-route synthetic fixtures and non-deploy exact-source CI must
pass before a scoped participant Worker release. Never deploy a loopback synthetic export.
Then audit the live entry hash/readiness. Physical phone testing remains needed.
Next automation phase: authoritative observed-delivery coverage, prospective frozen consent,
idempotent deadline processing under shared payout locks, provider reconciliation and genuine
exception-only handling. Native LiveKit/app store readiness and operator provisioning remain
separate launch gates; do not represent the entire application as launch-ready.
