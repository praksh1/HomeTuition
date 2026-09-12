# Prelaunch class booking and call pilot

- Date: 2026-09-11
- Agent: Codex
- Branch: codex/batch-test-booking
- Base commit: 94719a7
- Status: in progress — isolated on `codex/batch-test-booking`; not deployed or activated

## Requested

Explain/remove confusing migration-style teacher panel. Continue commission work and allow the
owner to test student booking and real calls without real payments for roughly3–4months.

## Decisions and assumptions

This is prelaunch testing, not an established paying customer migration. Preserve existing data
without presenting an established-customer migration panel. Keep older tools collapsed.
Reuse explicit teacher/student test grants and kill switches. No globally free checkout, no
payment-key removal, no production NODE_ENV=test, no fabricated receipt or earned money.
New batch bookings must freeze exact offer/lesson subset, respect capacity and student schedule,
and map to real sessions atomically. A test seat never becomes a paid seat implicitly.
Pilot activation stays preview-first. Real media can consume the existing provider allowance;
no purchases or paid recording authorized. Provider access must be checked before promising calls.

## Changed

Teacher page: migration panel becomes collapsed Earlier test tools. It was navigation to older
test screens, NOT evidence of paying customers. Existing classes, Monthly homework/chat and
their access rules were not removed.

Added batch-specific test contracts, lesson/session mappings and bookings. An authenticated
quote freezes the published version and included future lessons; confirmation rechecks version,
time, capacity, teacher/student eligibility and student timetable under transaction locks.
Concurrent/repeated confirmations reuse one booking and one session per lesson. The existing
session membership, classroom socket, call route and server time windows remain authoritative.
Teacher receives an in-app test-booking notice, not a paid receipt. Materials/homework group
entitlements for new batches remain a separate implementation slice.

Test bookings write `test` / `test_access` / null payment reference. They never call the gateway,
allocate commission, create refund money, or convert into paid rows. Materialised sessions are
excluded from the legacy teacher-plan quota and duplicate schedule-conflict counting. Direct
single-lesson booking of these sessions is refused: book through the class offer.

First booking freezes the batch and parent program, including via older editors and SQL trigger
backstops. This deliberately also blocks parent draft editing and starting another period on
that parent during this pilot: copy the class for another test. Status/start/count updates needed
for calls remain allowed. This is NOT the final paid rescheduling/consent design.

Added fixed UTC `TEST_ACCESS_UNTIL` (future, valid, at most124days away), plus the two existing
switches and individual operator grants. Operators can grant through that fixed date instead of
renewing every7days. Existing deployments with no date keep their existing switch behavior;
new batch booking requires a date. Every included lesson must finish before the deadline. An
individual grant expiring does not erase an already-held lesson; the global deadline/kill switch
still closes test membership everywhere. No production settings have been changed in this work.

Student offer has explicit no-charge quote, date/subset review, confirm and existing lesson links.
Teacher gets Test lessons directly on My classes. Repeated clicks are blocked while pending;
a stale/failing quote must be refreshed. BS-first dates and design tokens reused.

## Verification

Local four-workspace typecheck passed with escalated dependency access; API units527, app373,
design ratchet unchanged94hex/282sizes. Rendered class setup75checks and test booking24checks
at390/1440widths passed. Screenshots are temporary under local Temp/fadko-test-booking-ui-*.

CI runs use disposable Postgres16, never staging/production, and include typecheck, units,
program API, new batch booking races/late joining/locks/room/socket tests, old grant suites and
rendered UI. Run34666112838 passed the initial set. Added broader old-suite coverage afterward.
Full rerun 34666967951 for f5c9718 PASSED: program API 601, batch booking 40, teacher test grants
26, student test access 108, class setup UI 75, booking UI 24; units and typecheck also green.
Real media, real phones and deployed signup/booking journey not yet proven.

## Problems and surprises

- The initial late-joining fixture used the period end as enrollment cutoff. Canonical snapshots
  require the last lesson start, so the fixture was invalid; corrected, not weakened validation.
- Run34666548597 failed the old test-student suite: its Before/After lessons overlapped, its helper
  ignored creation failure and later used an undefinedid. Corrected separate slots and immediate
  status assertion. Did not claim to run this against untouched main.
- Run34666708171 then had107pass/1fail: old suite omitted X-Fadko-Platform, so the legitimate old
  client fallback returned Daily rather than configured echo. Added the web header in the fixture;
  provider selection itself is untouched.
- Sandboxed typecheck could not resolve packages behind external dependency links. Escalated
  frozen install said already up to date and escalated typecheck passed. No dependency/version
  change was required; do not report these packages as repaired or missing from the project.
- Railway staging inspected read-only: both test switches true, VIDEO_PROVIDER=echo, no Daily
  service key attached. A passing echo room/socket test is NOT real video evidence. Production and
  staging session numbers overlap; sharing Daily credentials without room isolation could mix
  environments. Do not just attach a key/change the provider.
- New additive DDL runs in the existing asynchronous boot guard. Verify the completed guard log
  after staging deployment before activation. A DDL failure can affect scheduling/quota queries
  that now reference mapping tables; the log explicitly warns of this instead of claiming all
  other features work. No production migration/drop/db:push performed.

## Fabrications found

Migration copy implied established paying users; owner confirmed this is private prelaunch testing.

## Deliberately not changed

Real charges, provider choice, existing Monthly homework/chat, paid contracts.

## Remaining risks / next pickup point

Finish full CI, deploy matching staging API/frontend, configure stage-only fixed deadline and
operator grants, then verify the actual preview journey. Real video requires isolated rooms plus
confirmed account allowance/credentials; do not buy or promise free unlimited calls. New-batch
homework/group chat adapter, real checkout, receipt reconciliation, commission and payouts remain
unbuilt. Existing Monthly homework/chat untouched. No automatic paid conversion at pilot expiry.
