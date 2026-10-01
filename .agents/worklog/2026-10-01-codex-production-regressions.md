# Production lesson and messaging regressions

- Date: 2026-10-01
- Agent: Codex
- Branch: codex/sep30-preview-reliability
- Base commit: 0d5d4c396b05165d62865cf14bf393bcd514e2f0
- Paired Production branch: codex/sep30-reliability-and-launch-readiness
- Production base commit: 0c1cfb58
- Status: in progress

## Requested

Repair the owner's recorded Production lesson crashes, typing delay, newest-message opening,
unbracketed counts and confusing replacement form. Audit the wider teacher/student flow and
move routine make-up handling toward deterministic automation while keeping reliable evidence,
immutable purchase terms and the original payment allocation. Preserve desktop web and phone
browser testing until native releases are actually ready.

## Changed

- Paired local participant patches, not a wholesale merge of divergent release tracks.
- DropClass treats the new linked-allocation response separately from a legacy cancellation
  quote. It never formats missing money fields, guesses a zero refund or shows an untrusted
  cancellation quote. Linked lesson help preserves the original session.
- Shared filterCountLabel and rendered/source guards for Classes, Notifications and roster
  filters, including known zero counts. Production retained its existing grouping.
- Direct/class conversation opening is being tested with 250 variable-height messages,
  not just the old nine/ten-row fixtures. Latest-open/refocus must survive slow layout and
  refresh failure without scrolling through history.
- Replacement date defaults and the calendar honor the original lesson end and the whole
  replacement duration before its deadline. Invalid choices fail beside the form before
  any mutation. The separate confession toggle is replaced by a disclosed specific
  Replace undelivered lesson action and an alternative review path if teaching occurred.
  This remains an explicit teacher acknowledgement, not a fabricated system verdict.

## Decisions and assumptions

The owner's approved prospective policy remains unchanged. This regression repair does not
activate automatic real refunds, retroactive absence penalties or AI financial decisions.
Membership, timing, booking and financial allocation remain server-authoritative. Native app
release and owner operator provisioning remain separate launch gates.

## Verification

- Final paired runtime checks: Production 708 app / 886 API pure tests; Preview 735 app /
  917 API pure tests. Both workspace typechecks and design ratchets passed.
- Fresh exports validate 129 Production / 130 Preview chunks against their respective APIs.
- Actual lesson/drop gates: 372 assertions per track across 40 cases; make-up role routes
  162 and startup recovery seven per track, all synthetic intercepted records.
- Actual message routes: 132 per track with 250 varied rows at 320/390/1440, both roles.
  Zero timeline Intl work during typing; all characters preserved. Controlled 4x-CPU
  input-to-next-frame maxima: Preview 55 ms, Production 74 ms, not physical-device INP.
- Messaging bundled UI 150 plus draft/failure checks, long history 32 and classroom drawer
  168 per track. Preview Schedule export 66 and lesson-action export 1,068 passed.
- First Production exact-source CI b5a4b3b5 / 36821392245 passed server/browser checks but
  stopped during export without a usable exception. It is not a successful release gate.
  Renewed gate uses existing deploy-web memory ceilings, never skips a failed check.
- Export fixture corrections are test-only: wait for renderer quiescence before measuring
  typing; check explicit native/ARIA disabled state and prove blocked coordinate taps.
- Recording metadata: 6:28.93, 2856 by 1744, 30 fps. Extracted twenty-second overview and
  targeted frames. The visible address confirms Production, not Preview. No physical-phone
  execution is claimed; this recording is a laptop browser.
- Public read-only current check: Preview and Production roots and both API readiness routes
  returned HTTP 200. Preview entry-17ae280ff6a3e540eed37f470a73125c.js and Production
  entry-aa4e17e87f221dd76192a6d268e801b8.js match the prior deployed snapshots.
- Red crash reproduction: exact sparse enrolled batch drop-info contract throws
  Cannot read properties of undefined (reading toLocaleString) in the previous DropClass.
  Existing fixtures answered enrolled:false and missed this contract.
- Count tests in each checkout: three pure guards, 75 Notifications and 54 roster browser
  assertions; Preview Classes 69, Production Classes 60. Widths 320/390/1440. Both typechecks
  passed after correcting a Node versus DOM URL type in a test file.
- Replacement pure helper: 11 passing tests. Preview replacement UI: 105 assertions at
  320/390/1440, including original-specific future defaults, invalid time with no mutation,
  closed window, specific acknowledgement and alternative review. Production rerun pending.
- Final exported-route, complete-suite and deployment results will be appended after completion.

## Problems and surprises

- Counts had been fixed in Preview but not the divergent Production screens the user recorded.
  Do not attribute this to the owner failing to refresh.
- Fixed 120-millisecond follow-tail timer expires before a large virtualized conversation
  settles. Old source fails the 250-message newest-row test after 30 seconds.
- Direct/class isolated composers did not isolate the classroom drawer from large parent
  board/call screens; that additional typing path is being repaired separately.
- Cached Wrangler 4.144.0 is available and signed in. Workspace pnpm exec wrangler is not
  installed; npx --no-install attempts the unavailable latest package and exits. Use the
  verified existing cached CLI, without installing dependencies or changing provider plans.
- Default execution helper startup fails. Narrow reviewed local checks succeed.

## Fabrications found

No real refund or launch-readiness claim. V2 automatic remedy code is shadow-only and has
no active observation-health attestation writer, checkout/offer consent integration or
deadline scheduler. Missing attendance rows cannot prove teacher absence. Existing request
holds do correctly link to the original allocation under its lock.

## Deliberately not changed

No purchases, real payment activation, schemas, credentials, owner identity, real account
records, bans, native/browser lockout or financial-policy changes. Preserve pre-existing
.ux-audit directories and the completed uncommitted teacher Schedule follow-up.

## Remaining risks / next pickup point

Finish the paired regression tests against fresh actual exports, then separately scoped
participant releases. Never deploy the existing Preview loopback-only synthetic export.
Add active authoritative delivery observation, immutable consent, idempotent deadline
processing and settlement/provider reconciliation before describing automatic money as live.
Only ambiguous evidence/outages should reach exception review once those gates are in place.
