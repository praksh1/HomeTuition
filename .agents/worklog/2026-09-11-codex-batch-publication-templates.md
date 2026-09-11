# Batch publication and safe template reuse

- Date: 2026-09-11 UTC
- Agent: Codex
- Branch: codex/program-batch-foundation
- Base commit: faedded
- Status: in progress

## Requested

Owner passed guided-planner review but found unchanged batches could be repeatedly published.
Requested a disabled published state, explicit editing, checking paid-student edit protections, and
reusing previous Programs/Batches with mandatory review before publication.

## Changed

- Planner now opens an unchanged published Batch in review mode, with a disabled “Published — up
  to date” footer and explicit “Edit details”. Merely entering edit mode does not enable publish.
  Saved price/capacity/date/time/duration changes enable the update path, subject to fresh review.
- Two labelled accessible checkboxes before every publication: class size/full price, and all
  dates/Nepal times/durations. Editing, switching Batch, and saving reset checks. The final publish
  confirmation remains separate. These are deliberate UI acknowledgments, not proof of reading.
- “Use as template” on each owned Batch creates a separate empty server draft, then copies the
  source's saved capacity, price, lesson times/durations into local editing state. ALL dates cleared;
  no status, version, published snapshot, bookings, payment or students carried over. Original
  unchanged. The notice explicitly says the copied settings are not yet saved. A valid new schedule
  and fresh review are required. No new schema or server clone endpoint.
- Server now serializes publishing under the Program and Batch row locks, and PATCH under the
  same Batch lock. A same-offer repeat returns the existing version/snapshot/publication timestamp,
  `unchanged: true`, with no new domain publication activity. Changed details publish once even
  under simultaneous requests. PATCH rechecks closed status under lock.
- Owner API includes current Program version so republishing a changed parent Program does not
  leave a Batch incorrectly labelled up to date. Equality also checks identifiers and snapshot
  version integrity. Existing approval/ownership/future-date/public visibility gates preserved.
- Added real API/DB tests to `test:programs` for concurrent no-op requests, changed versions,
  immutable old public price, parent-version refresh, cross-teacher refusal and closed-state refusal.
- Updated browser fixtures to include real-shaped published snapshots; added disabled/read-only,
  edit-without-change, re-review and template-date-reset checks at three viewport sizes.

## Decisions and assumptions

- Batch reuse is the delivered first slice. The Program itself is already reusable for multiple
  Batches. Duplicating the whole Program description/modules is not implemented in this slice and
  must not be described as done. A separate copy-to-new-Program workflow remains useful follow-up.
- A template uses the owner's last SAVED draft settings, not the published snapshot and not unsaved
  edits. All source dates cleared, even if in the future; this prevents an accidental duplicate run.
- Matching saved data is decided on both client and server; hiding a button alone is not duplicate
  protection. No-op does not claim another publication happened.

## Verification

- Full four-workspace typecheck passed.
- API units: 500 passed / 0 failed; app units: 365 passed / 0 failed.
- Design ratchet unchanged: 94 hex / 282 sizes.
- Browser checks initially 72/72 passed; additional published-footer visibility assertion added
  before final rerun. Uses real screen/calendar/web leave guard but synthetic API/router/native
  controls. Does not prove real phone behavior or server semantics.
- Final rendered rerun: 75/75 passed at 360×640, 390×844, 1440×900, in Kathmandu/Chicago timezones.
  Inspected published and template screenshots in `C:/Users/missk/AppData/Local/Temp/fadko-batch-planner-vGxwVt`.
- Real database cases run in preview CI, not on this Windows checkout (no local psql fixture).
- Final browser count, preview run, commits and served build recorded below when complete.

## Problems and surprises

- The server unconditionally incremented publication version on every request; it was not merely
  a UI issue. It also read draft fields and lessons outside a common mutation lock. Fixed both so
  concurrent duplicate publication cannot recreate the same bug behind the disabled button.
- Existing program test suite covered Batch schema parity but had no Batch lifecycle tests. Added
  route-level cases rather than claiming the earlier Program suite already proved Batch publishing.

## Fabrications found

- No fabricated money found in this slice. The generic Program money rehearsal is not a paid Batch
  booking; presenting it as a Batch purchase/edit protection would be false.

## Deliberately not changed

No purchase, gateway activation, live payment, Batch enrollment, refund rule, subscription, Monthly,
Single Class, video provider, classroom, schema or database migration. No production release.
No whole-Program duplication yet. No claim that a checkbox proves a teacher read the details.

## Remaining risks / next pickup point

Paid Batch editing is NOT implemented because paid Batch checkout/enrollment does not exist.
`learning_program_enrollments` keys on Program/student, not Batch, and uses `test_confirmed`.
`programCommerce.ts` never references the Batch tables. Before Batch checkout ships: freeze the
accepted Batch/version/price/schedule per booking; atomically serialize enrollment vs material
edits; prohibit silently replacing purchased terms; implement explicit reschedule/cancel and
student notification/remedy rules; test payment callback retries and enrollment/edit races. This
is a release blocker, not a protective rule already present. Owner policy approval required for
exact student remedies, not for preserving the historical purchased agreement.

Next physical review: publish → disabled state → edit → save/re-review → one updated publication;
then Use as template → fresh dates required → review. Promote only after that passes. Whole-Program
copying and paid Batch contract remain separate follow-ups.
