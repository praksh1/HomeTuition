# Remove fabricated login demo accounts

- Date: 2026-09-03
- Agent: Codex
- Branch: codex/staging-preview-integration
- Base commit: 900097d
- Status: complete — implementation checked; batched render pending

## Requested

Continue removing known fabricated public-facing claims while Claude works on a non-overlapping
whiteboard slice.

## Changed

- Removed the teacher-login hint naming `ram@example.com`, `sunita@example.com`, and "any email".
- Removed only the two now-unused presentation styles; login behavior, auth calls and routing are
  unchanged.

## Decisions and assumptions

The named accounts do not exist in the isolated staging database, and "any email" is false. There
is no honest replacement hint, so removal is clearer than invented demo credentials.

## Verification

- App TypeScript clean; 168 app tests passed.
- Design check improved login from 11→10 raw font sizes with no regression. The baseline was
  lowered to 418 total sizes; the remaining login debt is pre-existing and was not expanded.
- Direct grep found none of the fabricated account strings after the edit.
- Render will be batched into the next staging build. This change is not yet live.

## Problems and surprises

The first patch used stale style context and applied nothing. Re-read the exact block and reapplied
only the intended deletion; no partial source or worklog was left by that failed attempt.

## Fabrications found

Removed the already logged fake demo-account hint. No new fabrication found.

## Deliberately not changed

No authentication, role gate, social sign-in, password flow, tokens, other login styling, backend,
database, deployment or production state.

## Remaining risks / next pickup point

Render teacher and student login after the next batched build; do not claim this is live beforehand.
