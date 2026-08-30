# Student classroom edge-to-edge whiteboard

- Date: 27 August 2026
- Agent: Codex
- Branch: `claude/excalidraw-whiteboard-sync-gjoqaz`
- Visible base commit: `dd3b8df` (`Record teacher profile handoff`)
- Status: implementation complete; awaiting manual student-side touch verification

## Requested

Apply the manually verified teacher classroom architecture to only
`artifacts/sikshya/app/(student)/classroom/[id].tsx`: an edge-to-edge read-only SmartBoard,
`box-none` overlay carriers, draggable remote-video PIP, student-safe floating HUD, slide-over
chat, semantic/tokenised notices, and zero raw colours/font sizes. Preserve membership checks,
socket connections and DailyEmbed, update the design ratchet, and stop for student-side touch
verification.

## Changed

- Rebuilt the classroom stage so the read-only `SmartBoard` fills the complete screen without
  the former header, tab bar, video row, margins or rounded container taking canvas space.
- Added four transparent, absolute overlay carriers for session context, notices, the bottom HUD
  and chat. The header, notice and HUD carriers use `pointerEvents="box-none"`; only their visible
  children capture input. The closed chat layer uses `pointerEvents="none"`.
- Converted the teacher feed into a persistently mounted, right-aligned PIP with tokenised border
  and shadow. A dedicated 44-point grip owns the `PanResponder`; the rest of the PIP remains
  available to the existing provider controls. Drag coordinates are clamped on release and after
  viewport/orientation changes.
- Kept `VideoCall` focused on the remote teacher by preserving `watchUserName` and
  `onWatchedParticipantLeft`. Removed only the duplicate parent-to-embed chat props, because this
  screen's slide-over is now the one chat surface; the existing socket still owns messages and
  sending.
- Replaced the old mode tabs with a floating student HUD. Its actions focus the shared
  board/materials, hide/show teacher video, open/close chat, rotate the classroom, and leave the
  student's own call. There is deliberately no Start Class or End Session action.
- Made chat a bottom sheet over the still-mounted board, with a tokenised scrim, compact/wide
  heights, accessible close/send controls, and the existing message list and send callback.
- Replaced inline waiting, denial, time-limit and teacher-away bars with lightweight transform-only
  floating notices using `warning` or `destructive` semantic tokens. They no longer change the
  board's layout.
- Replaced all 62 hex literals and 21 raw font sizes in the target with `useColors()` and
  `useLayout()` tokens. The design baseline is now 223 hex literals / 429 raw sizes across 57
  remaining dirty files.

## Decisions and assumptions

- The student's existing room loading, leave behavior, teacher-disconnect recovery, membership
  denial, WebSocket board following, time limit, alone-in-call cutoff and read-only board contract
  are frozen.
- Students may hide/show the PIP, open chat and leave their own view. They cannot start or end the
  class and receive no material-authoring control.
- “Materials” focuses the existing read-only shared board because teacher-uploaded materials
  arrive as part of that board. There is no separate student material data/action in this file;
  adding one would fabricate UI state or expand business logic.
- Native mic/camera controls and web Daily Prebuilt controls remain inside `VideoCall`; the PIP is
  sized to keep those existing controls usable. The parent HUD will not invent duplicate controls.
- As on the teacher side, full-screen transparent overlay carriers use `pointerEvents="box-none"`;
  only visible PIP/HUD/notice/chat surfaces capture input.

## Verification

- `pnpm.cmd --filter @workspace/sikshya run typecheck` — passed after one implementation typo was
  corrected (`colors.canvas` was not a defined token; changed to `colors.background`).
- `pnpm.cmd run typecheck` — passed. Its artifact filter printed “No projects matched”; the focused
  Sikshya typecheck above did compile this screen successfully.
- `pnpm.cmd --filter @workspace/sikshya run test` — passed, 154/154 tests. Node printed the existing
  `MODULE_TYPELESS_PACKAGE_JSON` performance warnings; there were no test failures.
- `pnpm.cmd --filter @workspace/sikshya run lint:design` before updating — passed and reported this
  file improved from 62/21 to 0/0.
- `pnpm.cmd --filter @workspace/sikshya run lint:design:update` — wrote the lower 223/429 baseline.
- `git diff --check` — passed; Git printed only the checkout's existing LF-to-CRLF notices.
- Manual student touch verification has not been performed. The owner will test the whiteboard,
  PIP, HUD, chat and notices on the target device before this file is considered shipped.

## Problems and surprises

- The owner reported committing the verified teacher changes, but this checkout still shows them
  uncommitted and `HEAD` remains `dd3b8df`. They are being preserved untouched; this task will not
  stage, amend or reset them.
- The first repository formatter/typecheck attempts inside the sandbox could not read pnpm-linked
  packages (`EPERM`). The same commands ran successfully with the required host permission.
- The first focused typecheck found one invalid colour property (`colors.canvas`). No such token
  exists; switching the waiting surface to the existing `colors.background` token resolved it.

## Deliberately not changed

- `lib/membership.ts`, `useClassroomSocket`, `VideoCall`, both DailyEmbed implementations,
  SmartBoard, API utilities and the teacher classroom are outside this student pass.

## Remaining risks / next pickup point

- Manually verify on a student account: board pan/zoom across the full screen, drawing touches not
  intercepted by empty overlay areas, remote teacher video content, PIP grip drag/clamping, native
  provider controls, PIP hide/show, Materials returning from chat to the board, chat open/close and
  keyboard behavior, rotation, Leave Session not ending the class, warning dismissal, teacher-away
  countdown, access-denied state and early-class waiting state.
- If that passes, commit this student file, the lowered baseline and these documentation updates.
  Do not silently include or discard the still-visible teacher work; reconcile why its reported
  commit is not reflected in this checkout first.
