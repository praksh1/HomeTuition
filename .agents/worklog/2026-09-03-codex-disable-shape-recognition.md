# Disable automatic whiteboard shape recognition

- Date: 2026-09-03
- Agent: Codex (implementation), with a separate read-only Codex audit
- Branch: `codex/shape-recognition-disabled`
- Base commit: `bc0aa17`
- Status: in progress — implementation and source/unit checks complete; integration build and browser proof still required

## Requested

Remove automatic freehand-to-shape conversion from the active classroom whiteboard after a real
teacher test showed handwriting being changed into arrows or other unintended shapes. Preserve
freehand ink, explicit Excalidraw tools, whiteboard sync, viewport follow, undo/redo, attachments,
pointer handling, and read-only student behavior. Keep the standalone recognition experiment for
possible later research. Work on an uncontaminated branch from the exact product commit, test it,
document it, and do not deploy or change production before owner review.

## Changed

- Created this branch in an isolated Git worktree from exact commit `bc0aa17`; did not reuse or
  merge `claude/slice5-shape-recognition-wip` (`c908d7f`) because that branch also carries unrelated
  preview-infrastructure changes and a worklog deletion.
- In `artifacts/sikshya/components/SmartBoard.web.tsx`, removed the recognition and conversion
  imports, the `consideredStrokes` registry, the complete `tidyFreehand` callback, its invocation,
  and its hook dependency. `handleChange` still publishes viewport changes and batches board sync.
- Added `artifacts/sikshya/components/SmartBoard.activation.test.ts`, which fails if the production
  board imports recognition code or contains any of the previous activation/conversion symbols.
  A second assertion confirms the dormant recogniser itself remains in the repository.
- Replaced the two browser scenarios that expected automatic correction. They now require a rough
  circle and handwriting to remain live, undeleted `freedraw` elements; verify the ink reaches a
  read-only student; and verify the explicit rectangle and arrow tools still create those types.
- Updated the browser-test README, `WHITEBOARD.md`, `HANDOVER.md`, `CLAUDE.md`, the owner correction
  backlog, the memory index, and the recognition barrel comment so no document claims automatic
  conversion is active.

## Decisions and assumptions

- Removed the recogniser from the active import graph instead of hiding it behind a false flag.
  This avoids shipping and accidentally reactivating the unwanted behavior.
- Retained `components/recognition/` and its isolated tests because the owner asked to save useful
  experimental code for possible future work.
- Explicit Excalidraw tools are preserved by leaving the `<Excalidraw>` component and its UI/tool
  configuration untouched. No classroom screen, socket, API, membership, payment, video, or state
  management file changed.
- Claude's desktop process was running, but the current Codex computer-control bridge exposed only
  browser tabs and no native applications. Claude's CLI was not installed on `PATH`. To avoid more
  usage spent retrying inaccessible UI, Codex performed the slice and assigned a separate read-only
  audit; no message was falsely claimed as sent to Claude.

## Verification

- `node --test --experimental-strip-types "utils/**/*.test.ts" "components/**/*.test.ts"` from
  `artifacts/sikshya`: passed, **156/156**, including both new activation guards and all retained
  recognition research tests.
- `node scripts/design-lint/run.mjs`: passed at the branch baseline, **223 hex / 429 font sizes**;
  no new leaks. No ratchet update was needed because the changed production code only deleted
  logic and imports.
- `.\node_modules\.bin\tsc.cmd -p tsconfig.json --noEmit`: passed after rerunning outside the
  sandbox so TypeScript could follow the already-installed dependency junctions.
- A separate read-only audit independently confirmed that `SmartBoard.web.tsx` was the only active
  caller and that the minimal change did not touch explicit tools, sync, files, viewport, pointer,
  or read-only behavior.
- Browser and performance checks have not yet passed. They must be rerun after integration in the
  main checkout, where Metro can resolve the original pnpm workspace layout.

## Problems and surprises

- The first three pnpm checks in the isolated worktree tried to install the monorepo because the
  worktree had no dependency links. Network access was restricted, so they entered registry retry
  loops. Those processes were stopped; the existing root and app `node_modules` were then exposed
  through verified, worktree-local junctions. No dependency version or lockfile was changed.
- The first direct TypeScript check reported missing social-login modules even though they were
  installed. This was a sandbox read restriction through junction targets, not a source error;
  the same command passed with filesystem access outside the sandbox.
- A staging-configured `node scripts/build.js` reached Metro but failed because Metro resolved
  `expo-router` through a pnpm path outside the isolated worktree. This is a worktree-layout issue,
  not evidence that the product branch builds. The build and real browser suite remain pending.
- The existing board browser suite also contains a hard-coded Linux screenshot path for its
  library test. If that fails on Windows after integration, record it separately rather than
  weakening the whiteboard assertions.

## Fabrications found

None found. This slice removed an unwanted behavior and stale technical claims; it did not add or
inspect user-facing numbers, availability claims, or money copy.

## Deliberately not changed

- No recognition algorithm files or their research tests were deleted or rewritten.
- No WebSocket protocol, scene merge/version logic, persistence, membership check, business rule,
  classroom overlay, Daily configuration, payment configuration, infrastructure, secrets, or
  production deployment changed.
- No manual phone/laptop drawing claim is made. Automated browser assertions have been updated but
  have not yet run successfully against this isolated build.

## Remaining risks / next pickup point

1. Review `git diff` and commit/push this clean isolated branch.
2. Integrate the commit into `codex/staging-preview-integration` together with the already-reviewed
   email and copy cleanups.
3. Run the complete workspace typecheck, app unit tests, design linter, app build, `test:board`, and
   `test:perf` from the main checkout. Fix only genuine regressions; document environment failures.
4. Deploy only the staging preview, verify its bundle targets the staging Railway API and excludes
   the known production API, then give the owner the clickable preview for manual drawing.
5. Do not merge or deploy to production until the owner confirms that handwriting stays ink and
   explicit shape tools still work on the real teacher/student classroom screens.
