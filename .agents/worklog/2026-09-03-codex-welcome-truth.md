# Welcome screen truth and token cleanup

- Date: 2026-09-03
- Agent: Codex
- Branch: codex/staging-preview-integration
- Base commit: 72b3d9f
- Status: in progress — implementation checked; rendered review pending

## Requested

Continue useful non-overlapping work while Claude handles a whiteboard slice. Remove already
documented fabricated claims and continue strict design-system conversion one screen at a time.

## Changed

- `artifacts/sikshya/app/welcome.tsx`: removed unsupported 5,000+ teachers, 50,000+ students and
  77 districts claims instead of inventing replacements.
- Replaced them with a qualitative description of features verified in this codebase: live video,
  the Sikshya class chat and interactive shared whiteboard.
- Removed all 18 raw colour literals and 10 raw font sizes. The screen now uses `useColors()` and
  `useLayout()` tokens. Both role choices remain equally weighted white cards with blue action
  cues; neither role is falsely presented as the preferred person.
- Reworded subjective `Premier` / `Nepal's best teachers` claims into factual product actions.

## Decisions and assumptions

- Cut the statistics band. Staging currently has only synthetic fixtures, and showing their count
  would be as misleading as the prior marketing numbers.
- Keep the branded navy-to-crimson welcome background: those tokens represent Sikshya identity,
  while all actionable icons/chevrons use royal blue.
- Do not rebuild immediately after this one-file slice. A full Expo web export took about seven
  minutes; batch the next reviewed whiteboard change into one build to conserve owner usage.

## Verification

- App TypeScript clean.
- App tests: 168 passed, 0 failed.
- Design check: welcome improved 18→0 hex and 10→0 raw font sizes; overall 205/419.
- Direct greps found no remaining raw hex/fontSize or old scale/superlative claims in this file.
- `git diff --check` clean apart from normal Windows LF→CRLF warning.
- Not yet rendered and not yet deployed. The currently live preview contains only the earlier
  email-verification fix; do not claim this screen is live before the next build/deploy.

## Problems and surprises

- None in runtime code. The first tokenized draft used a transparent-to-scrim gradient; removed it
  because `transparent` would still be a screen-local colour decision. A single scrim-token overlay
  is cheaper and conforms to the palette.

## Fabrications found

- Three existing logged fabrications removed: 5,000+ teachers, 50,000+ students, 77 districts.
- Two unsupported superlatives removed: `Premier Teaching Platform` and `Nepal's best teachers`.

## Deliberately not changed

No routing, authentication, data fetching, state, API, database, production branch/deployment,
hero asset or app name. The separate teacher-login demo hint remains for the next one-file slice.

## Remaining risks / next pickup point

Run `lint:design:update`, inspect the diff, commit, then batch a staging build with the reviewed
shape-recognition change. Render the welcome screen at phone and laptop sizes before asking the
owner to approve it. If the scrim makes the whole photo too dark, add a semantic hero overlay token
centrally; do not return to a one-off rgba literal.
