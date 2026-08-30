# Teacher public profile and Book & Pay design-system conversion

- Date: 27 August 2026
- Agent: Codex
- Branch: `claude/excalidraw-whiteboard-sync-gjoqaz`
- Base commit: `eb4f4f7` (`Write down where the visual work has got to, and the pattern underneath it`)
- Status: complete; verified, committed and pushed

## Requested

Continue the screen-by-screen visual upgrade at
`artifacts/sikshya/app/(student)/teacher/[id].tsx`. Remove its design-lint violations, audit its
claims for fabricated data, make pay-per-class versus monthly billing unmistakable, preserve the
atomic booking flow, verify with typecheck/tests/design lint, render if possible, and commit and
push frequently.

The owner also asked that all future Claude/Codex work leave a durable, detailed account. This
entry is the first use of the shared format added in the same task.

## Changed

- Converted `app/(student)/teacher/[id].tsx` from 20 hex literals and 26 raw `fontSize`
  declarations to zero of each. Colours now come from `useColors()` and type/spacing/responsive
  choices from `useLayout()`; touch targets use `HIT_SLOP_MIN`.
- Reworked the teacher hero, facts, tabs, class cards, reviews, loading, empty, failure, booking,
  and payment states without changing the API calls or booking flow.
- Added honest, distinct UI states for a failed profile request and failed supporting-detail
  requests. The existing requests still run as before; only their presentation state changed.
- Made back navigation safe for a directly opened web URL: go back when history exists,
  otherwise return to the student area.
- Renamed the free teacher-follow control from `Subscribe` / `Subscribed` to `Follow` /
  `Following`. Its endpoint, state, and `testID` are unchanged. This avoids confusing it with
  the separate paid monthly-class product.
- Removed the registration-only `sessionsThisMonth` zero and the incomplete "Sessions Hosted"
  total. Replaced the remaining counter label with the server's honest meaning: cumulative
  `Paid bookings`.
- Changed an unrated teacher from `0.0` to `Not yet reviewed`; added honest fallback copy where
  a teacher has not supplied a biography.
- Made every one-off price say `for this class` and added explicit copy that it is a pay-per-class
  purchase, not a monthly plan. Monthly classes remain a separately labelled product.
- Rendered `PaymentSheet` only when a selected session really exists, removing the hidden
  `price ?? 0` path and its possible fabricated `NPR 0`.
- Updated `components/SessionCard.tsx` so its price says `per class` and uses tabular numerals.
- Corrected the previously converted `components/TeacherCard.tsx` from "students" to "paid
  bookings" because the same audit proved the underlying field is not a unique-student count.
- Ran `lint:design:update`; the ratchet is now 393 hex / 481 sizes, down from 413 / 507 before
  this pass. Updated `DESIGN.md`, `HANDOVER.md`, and the UI-upgrade backlog accordingly.
- Established the cross-agent handoff convention requested by the owner:
  `CLAUDE.md` now requires a task log, `.agents/memory/MEMORY.md` links the durable rule,
  `.agents/memory/cross-agent-work-log.md` explains it, and `.agents/worklog/README.md` contains
  the reusable format. Added `/.pnpm-store/` to `.gitignore` because local pnpm bootstrapping
  created that disposable cache in this workspace.

## Decisions and assumptions

- `CLAUDE.md`, `.agents/memory/MEMORY.md`, `HANDOVER.md`, `DESIGN.md`, and
  `.agents/backlog/ui-upgrade-progress.md` were read in the requested order before application
  code was edited.
- Application changes remain limited to UI and UI state. Booking queries, payment calls, database
  writes, and access state are outside this task.
- `totalStudents` is treated as a paid-booking count because `sessions.ts` increments it once for
  each successful paid enrollment. It is not treated as unique students.
- Session lists use the existing paginated endpoint with its default limit of 20. Summing the
  loaded upcoming/live/completed arrays therefore cannot support a lifetime "Sessions Hosted"
  claim, so that statistic was removed instead of replaced with another estimate.
- A free follow and a paid monthly class are different products. Only the user-facing wording was
  changed; follow behaviour was deliberately preserved.

## Verification

- `pnpm --filter @workspace/sikshya run typecheck` — passed after fixing one local variable that
  shadowed the typography-token variable.
- `pnpm --filter @workspace/sikshya run test` — passed, 154/154 tests. Node printed existing
  `MODULE_TYPELESS_PACKAGE_JSON` warnings; there were no test failures.
- `pnpm --filter @workspace/sikshya run lint:design` — passed after the baseline update. The target
  moved from 20 / 26 to 0 / 0 and the project baseline moved to 393 / 481.
- `pnpm --filter @workspace/sikshya run lint:design:update` — passed and wrote the new baseline.
- `pnpm run typecheck` — exited 0. It built the shared TypeScript projects, then pnpm reported
  `No projects matched the filters` for the artifact-recursion portion. The explicit Sikshya
  typecheck above had already passed, so the target application was checked independently.
- Browser attempt — started Expo web temporarily on port 8082 with the production API URL supplied
  only as a process environment variable (no `.env` or secret was written). The server answered
  HTTP 200, and the in-app browser opened `/teacher/1` at 390 x 844. Metro repeatedly restarted
  first-bundle progress around 33%, leaving an empty DOM, so the screen was **not visually
  verified**. No browser console errors appeared. The temporary tab was closed, the viewport was
  reset, and port 8082 was confirmed no longer listening.
- Final reruns after the documentation and adjacent-label edits: root typecheck exited 0, app tests
  passed 154/154, and design lint passed at 393 / 481. `git diff --check` also passed after one
  trailing space introduced during diff cleanup was removed.
- Git handoff — implementation and the initial detailed log were committed as `363cb1a`
  (`Convert teacher booking profile to design system`) and pushed successfully to
  `origin/claude/excalidraw-whiteboard-sync-gjoqaz`.

## Problems and surprises

- PowerShell's first raw read of `.agents/memory/MEMORY.md` stalled in the OneDrive-backed
  workspace and returned no text. Reading it with `rg` succeeded; no file was changed by the
  failed attempt.
- The first full `HANDOVER.md` output was truncated by the command-output limit. It was then
  read completely in four explicit line ranges.
- Dependencies were absent. The first pnpm command hit a sandbox/network `EACCES`; an approved
  `pnpm install --frozen-lockfile` completed successfully (1,395 packages, lockfile unchanged).
- Three formatting attempts failed before the approved direct Prettier invocation worked:
  `pnpm exec` did not resolve the command, a Windows `.cmd` wrapper misparsed `(student)` in the
  path, and direct Node initially hit `EPERM` reading a pnpm link. None of the failed attempts
  changed application behaviour.
- The first app typecheck found that a tab callback named `t` shadowed `useLayout().t`; renaming it
  to `tab` fixed the error, and the rerun passed.
- Port 8081 was already owned by an unidentified Node process. It returned HTTP 200, but Windows
  denied command-line inspection, so it was not terminated or reused. The preview used 8082.
- Expo reported pre-existing patch-version recommendations for `expo`, `expo-file-system`, and
  `expo-constants`. Those packages were not changed because dependency maintenance is outside
  this UI pass.
- The local web preview could not complete its first Metro bundle, as detailed under Verification.
  This is an explicit verification gap, not a successful render.
- The first commit attempt failed because this checkout had no Git author identity. The connected
  GitHub account was confirmed as `praksh1`; `user.name=praksh1` and the account's GitHub no-reply
  address were then set **for this repository only**. Global Git configuration was not changed.

## Deliberately not changed

- No business logic, database query, API contract, or booking/payment state has been changed.
- No database column was renamed and no unique-student metric was introduced. The misleading
  `totalStudents` name remains server debt; the UI now describes what it actually counts.
- No dependency versions were changed, despite Expo's patch-version recommendations.
- The unknown process on port 8081 was left untouched.
- No `.env` file, credential, or production data was written or changed.

## Remaining risks / next pickup point

- A real visual pass is still required on a phone or a working Chromium/Metro environment. Check
  long teacher names, the two hero actions at 390 px, class-price wrapping, and pale-fill contrast.
- The next design-system target is `app/(teacher)/session-create.tsx` (8 hex, 14 raw sizes).
- Server follow-up, intentionally not part of this task: rename or replace `totalStudents` so the
  API exposes an accurately named count, and provide a real lifetime-session total if the product
  wants to display one.
