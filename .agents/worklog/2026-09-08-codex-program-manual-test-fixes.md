# Learning Programs — owner manual-test corrections

Date: 2026-09-08  
Branch: `codex/programs-manual-test-fixes`  
Status: implementation and non-browser gates complete; preview deployment still pending

## Scope

Correct only the three problems the owner found while manually testing the teacher Learning Program
flow:

1. put an unmistakable, accessible Back control at the top-left of the Programs list, type chooser
   and studio;
2. move lifecycle confirmation out of the bottom of the long document and into an immediately
   visible modal sheet;
3. keep a concrete example visible beside every program field and both learning-path fields, even
   after the teacher starts typing.

No API, schema, publication rule, lifecycle transition, or student-facing surface changed. Nothing
was committed, pushed, merged, deployed, or written to a database.

## Implementation

### Shared back control

`artifacts/sikshya/components/programs/ProgramPieces.tsx` now owns `ProgramBackControl`: an
arrow-left icon plus a visible destination label, a minimum 44-point target, button semantics, and
the same design tokens as the other program controls.

`ProgramHome.tsx` now begins with `Back to Dashboard`; `ProgramTypeChooser.tsx` begins with `Back to
Programs` and removes the old bottom-of-page `Not now` link; `ProgramStudio.tsx` replaces its
text-only back link with the same control. The studio still uses its unsaved-work guard.

### Confirmation modal

`ProgramStudio.tsx` now renders the existing `ConfirmSheet` copy and controls inside a transparent
React Native `Modal`. The modal:

- uses `colors.scrim`, the responsive `gutter`, `readingWidth`, radius and elevation tokens;
- uses a safe-area container and sits at the bottom of the viewport;
- has modal/alert accessibility semantics;
- dismisses through the backdrop, platform close request, or the existing explicit cancel button;
- uses only a short fade and no movement-heavy animation.

The original confirmation copy, destructive emphasis, action callbacks and double-confirmation rule
remain unchanged. The modal is a portal, so it is visible without scrolling even when the action was
pressed near the bottom of the studio. It stays open and disables dismissal while the request is in
flight. Success closes it; failure is shown inside the same modal rather than behind it in the long
editor.

### Persistent examples

`StudioField` now requires a non-empty `example`. `studioSections()` supplies one for every required
and optional field, with tailored school, exam, language, practical-skill and custom wording where
that materially helps. `moduleFieldExamples()` does the same for step name and step outcome.

The examples render as separate `Example: …` text below each input. They are guidance only: no
draft is prefilled and saving still sends only teacher-entered values. The studio header now also
states that students use these details to understand the program and decide whether to join. Every
visible field is explicitly marked `Required` or `Optional`.

## Tests changed

- `utils/learningProgramUi.test.ts` checks every field exposed for every supported type and both
  module fields have non-empty examples.
- `scripts/program-studio/run.mjs` checks all three Back controls are present, visible and at least 44
  points high; every custom-program field has an example; all examples remain unchanged after every
  field is typed into; both module examples render; and delete/archive confirmations intersect the
  viewport without scrolling.
- `scripts/program-journey/run.mjs` checks the chooser and studio Back controls, example persistence
  across real typing, and viewport visibility of publish and delete confirmations. Its chooser
  template-card query excludes the new back-control test id.

## Verification

| Gate | Result |
|---|---|
| Focused `learningProgramUi.test.ts` | 55 passed, 0 failed |
| Full Sikshya app tests | 316 passed, 0 failed |
| `lint:design` | passed; 94 hex / 282 raw-size baseline unchanged, no new leaks |
| `git diff --check` | passed |
| Program render suite bundle | compiled successfully |
| Full program render suite | blocked before Chromium launch: Playwright is not installed on this machine |
| Sikshya typecheck | passed after restoring the branch's already-locked dependencies |
| Live API/browser journey | not run; it requires the same missing Playwright runtime plus its API/database harness |

The first sandboxed render attempt failed because esbuild could not read its temporary directory.
Running outside the sandbox cleared that infrastructure error. TypeScript initially reported four
packages as missing because this branch added them to the lockfile after the prior branch's install;
`pnpm install --frozen-lockfile` restored exactly the locked packages and the typecheck then passed.
An initial use of
`react-native-safe-area-context` inside the isolated component harness exposed an incompatible native
module resolution there; the modal now uses React Native's own safe-area container, and the bundle
reaches the Playwright launch cleanly.

## Unverified

- The modal and back controls have not been visually inspected in Chromium at 390×844 and 1440×900
  in this environment because Playwright is absent.
- They have not been felt on a physical Android/iOS device. The 44-point floor and viewport
  assertions are encoded but need the browser/device run to execute.
- The live create/write/publish/delete journey was updated but not executed here.
- The focused browser bundler compiled all changed component and derivation imports successfully.
