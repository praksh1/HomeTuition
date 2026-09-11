# Actionable schedule conflicts and concise Nepali student offers

- Date: 2026-09-11
- Agent: Codex
- Branch: codex/program-batch-foundation
- Base commit: c8029ea
- Status: local verification passed; preview deployment pending

## Requested

Owner's phone screenshots show verbose un-actionable conflict messages and Gregorian-only student
headers. Highlight conflicting lessons, offer direct editing/other schedule links when safe, never
offer moving a paid commitment to fix the new lesson, and shorten student information.

## Changed

Structured conflict facts (no English-message parsing), highlighted dates, focused lesson editor,
safe other-class links and recheck action. New compact student offer card: price/count/dates first,
calendar preference (BS default) applied to Nepal-local dates, full timetable and policy details
behind explicit buttons. One preview notice rather than repetition throughout the card.

## Decisions and assumptions

Existing Single/Monthly commercial rules are not rewritten here. Paid single-class conflicts are
identified by authoritative paid enrollment rows and expose no edit-other shortcut. Existing Monthly
or uncertain editability similarly directs the teacher to change this lesson. New Batch checkout
still does not exist; future paid-Batch restrictions remain a release blocker, not claimed shipped.

## Verification

Full workspace typecheck passed after final edits. API units 522/0; app units 373/0;
design ratchet unchanged (94 hex / 282 sizes). Real Chromium Discover 182/0 and
class setup 75/0. Inspected phone screenshots of the compact offer and conflict panel.
The conflict journey proves paid-target copy, safe-link filtering, direct focused editing,
and the other schedule's exact authenticated ID. Real API/database gate runs in isolated CI.

## Problems and surprises

Date formatter must use Nepal calendar-day carriers, not the handset timezone. Raw ISO formatting
would shift an early Nepal lesson to the previous day on an overseas device.

The first new browser test attempted Save while still on the details step, where Save isn't
available, and stalled. Corrected the journey to reach Review before Save; all 75 checks passed.
Screenshots are temporary under %TEMP%/fadko-simple-class-aIeSvG and program-discover-shots.

## Fabrications found

No paid Batch status is invented. Do not label another batch unpaid: its checkout simply isn't
enabled. Source IDs are returned only in the authenticated owner's schedule review.

## Deliberately not changed

Payments, refunds, membership, video, existing paid-contract rescheduling rules, schema, capacity,
real enrollment and production. No new dependency or purchase.

## Remaining risks / next pickup point

Deploy isolated preview and check CI real-database gates and served build before owner testing.
Future paid Batch checkout must lock purchased terms and feed this conflict resolver's edit policy.
