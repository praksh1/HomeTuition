# Premium Profile and account editor

Status: Profile and login fixes are on `codex/premium-profile-account`; exact account-validation correction is awaiting preview testing

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
- Removed the hidden teacher navigator's duplicate role guard. The root guard is now the only role-routing authority, so signing out as a teacher and then signing in as a student cannot be undone by an invisible stale tab tree.
- Added first-error account validation: Save identifies one exact missing field, puts the error beside it, scrolls it into view and focuses Phone when Phone is the problem.
- Errors clear while the person corrects the field; a missing phone can no longer trigger a generic list blaming Province, District and Municipality too.
- Incomplete legacy/test rows are not trusted as user-entered addresses. If the saved row is internally incomplete, the editor and Profile status remain unconfirmed instead of presenting plausible location placeholders as the person's choices.

## Verification

- Sikshya typecheck: pass.
- App units: 455 passed, 0 failed.
- Focused account-form and Profile contracts: 15 passed, 0 failed.
- Rendered Profile journey: 50 passed at 390 px and 1440 px, including incomplete legacy data, exact first-field errors, live error clearing, cascading validation, searchable Nepal pickers, touch floors, no horizontal overflow and no browser exceptions.
- Repository typecheck: all four packages clean.
- Design lint: no new leaks; baseline remains 83 hex / 246 sizes.
- `git diff --check`: clean.

## Deliberate boundaries

- No real payment, refund, SMS or email action was added.
- Login email changes still require Support until a re-verification flow exists.
- Profile photos were not redesigned in this phase; the shared hero keeps a reliable initials fallback.
- Production receives this only after preview testing passes.
