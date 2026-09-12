# Test fixtures must respect teacher schedules

11 Sep 2026: the cross-product conflict guard made old production CI fixtures invalid.
Several suites created every lesson for one teacher at the same instant, then tested an
unrelated feature. POST /sessions correctly returned409; unchecked setup later produced
undefined IDs, SQL errors, or misleading media failures. Do not weaken the product guard.

- Assert fixture creation before reading its ID. This includes setup that is later aged by SQL.
- Independent cases can use separate teachers or sequential non-overlapping booked slots.
- `artifacts/api-server/scripts/test-support/fixtureSchedule.mjs` allocates local disposable
  database setup slots only. It is not a product scheduler and is not safe for concurrent setup.
- Moving setup dates must not cross the boundary under test. The student cancellation case
  is24hours, not48: one allocator correction shifted20hours past24 and broke the test's premise.
- Recovery tests need a still-connected call from the preceding booked slot, not two identical
  booked slots. Preserve the first call's live status/presence while ageing its scheduled slot.
- Crowding/filter fixtures can use separate future days, away from their Monthly timetable.
- Close browser/call contexts when their scenario is finished. Give independent clock scenarios
  their own teacher rather than inheriting another still-live room.

Release discipline: a production test fix belongs on the isolated release worktree when the
main development branch already contains unapproved preview behavior. Push the test-only
release commit, then cherry-pick into preview. Never push preview HEAD to main to fix a test.
