# Premium Profile and account editor

Status: implementation complete on `codex/premium-profile-account`; awaiting preview deployment and owner testing

## Goal

Make Profile feel like one trustworthy account home for teachers and students, and make Nepal contact/location editing usable without expanding dozens of choices into a long page.

## Product decisions preserved

- Login email remains visible and protected; it is not silently editable.
- Phone remains private and required by the server contract.
- Province and district remain server-validated against Nepal's canonical hierarchy.
- Municipality and school retain explicit not-listed/manual fallbacks.
- Teachers can remain independent; students can choose Not applicable for school.
- Refunds remain tied to the original payment method; this work changes no money movement.

## Work performed

- Added one shared premium identity hero and one shared descriptive action row for both roles.
- Rebuilt Account details as a compact private-information card with status, grouped facts and a clear Edit action.
- Removed the student's long, non-actionable “No saved payment method” card.
- Grouped student money and notification destinations under Account & payments.
- Grouped teacher money and notification destinations under Teaching tools.
- Collapsed teacher credential forms behind a summary disclosure; rejected documents still announce that attention is needed.
- Reworked the account editor into Contact, Location and School/teaching sections.
- Replaced expanding Province, District and Municipality lists with a bounded searchable modal.
- Added loading state and a readable-width cap so a failed/slow account fetch cannot masquerade as an empty form.

## Verification

- Sikshya typecheck: pass.
- App units: 441 passed, 0 failed.
- Focused Profile contract: 7 passed, 0 failed.
- Rendered Profile journey: 34 passed at 390 px and 1440 px, including searchable Nepal pickers, cascading choices, touch floors, no horizontal overflow and no browser exceptions.
- Design lint: no new leaks; baseline remains 83 hex / 246 sizes.
- `git diff --check`: clean.

## Deliberate boundaries

- No real payment, refund, SMS or email action was added.
- Login email changes still require Support until a re-verification flow exists.
- Profile photos were not redesigned in this phase; the shared hero keeps a reliable initials fallback.
- Production receives this only after preview testing passes.
