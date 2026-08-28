# Classroom interaction hotfix

- Date: 27 August 2026
- Agent: Codex
- Branch: `claude/excalidraw-whiteboard-sync-gjoqaz`
- Base commit: `63016c9` (`UI: Edge-to-edge architecture applied to both Teacher and Student classrooms`)
- Status: implementation and automated verification complete; branch-preview deployment and owner verification pending

## Requested

Stop all other work and fix four manually observed interaction failures on both classroom
screens: expose Excalidraw's hidden toolbars, remove Daily's second PIP/pop-out control, disable
Daily's internal chat, and prevent the classroom HUD from overlapping the PIP or slide-over chat.
Then commit, push and redeploy only the named branch preview for owner verification.

The affected screens are:

- `artifacts/sikshya/app/(teacher)/classroom/[id].tsx`
- `artifacts/sikshya/app/(student)/classroom/[id].tsx`

## Changed

- Reserved token-derived interactive bands for Excalidraw at the top and bottom of both
  classrooms. Session context begins below the top tool strip, the HUD is raised above the bottom
  board controls, and the board receives safe-area top padding.
- Made the PIP smaller on compact/landscape screens and based its geometry on the real viewport
  orientation. Its drag clamp now keeps it between the protected Excalidraw toolbar and HUD bands.
- Kept all full-screen overlay carriers `box-none`; only visible controls capture touches.
- When chat opens, both classrooms hide the PIP and make the HUD transparent and completely
  non-interactive. The chat sheet's own close control remains available, eliminating stacked
  controls over the sheet.
- Raised the teacher material menu with the HUD so it cannot collide with Excalidraw's bottom
  controls.
- Disabled Daily Prebuilt's fullscreen/pop-out control in
  `artifacts/sikshya/components/DailyEmbed.web.tsx`.
- Set `enable_chat: false` and `enable_pip_ui: false` in
  `artifacts/api-server/src/lib/dailyRoom.ts`. The existing room-repair path applies these false
  settings to old rooms as well as new rooms; changing only the React screens could not remove
  controls configured on Daily's server-side room.
- Added API regression tests for repairing both Daily settings and updated the multiple-repair
  test.
- Made `artifacts/sikshya/utils/classroomChat.ts` keep the classroom WebSocket chat on every
  platform and updated its tests. This prevents the prior browser/native split from returning.
- Updated `.agents/memory/one-chat-per-class.md` with the current 2026-08-27 owner decision and
  exact implementation. Contradictory older text remains below the new superseding note only as
  historical context because the OneDrive-backed file could not be atomically replaced.

## Decisions and assumptions

- The user's current explicit instruction supersedes the older experiment that enabled Daily
  chat on web. One classroom WebSocket conversation is now authoritative everywhere.
- Daily's `enable_chat` and `enable_pip_ui` are room properties, so the minimum complete fix
  includes the API room configuration and its tests. `showFullscreenButton: false` is also set on
  the web frame to remove the client-side control.
- Excalidraw's canvas remains edge-to-edge. The change reserves touch-safe bands for its UI rather
  than rebuilding a permanently boxed whiteboard.
- No session state, membership rule, data fetch, WebSocket lifecycle, booking logic, teardown
  timer, or database query was changed.
- The Cloudflare production Worker `hometuition` is out of scope. Only
  `claude-excalidraw-whiteboard-sync-gjoqaz-hometuition` may be deployed.

## Verification

- `git diff --check` — passed. Git printed only the checkout's LF-to-CRLF notices.
- `pnpm.cmd --filter @workspace/sikshya run test` — passed 154/154 tests on the serial rerun.
- `pnpm.cmd --filter @workspace/api-server run test` — passed 256/256 tests, including the new
  Daily chat and PIP repair cases.
- `pnpm.cmd --filter @workspace/sikshya run typecheck` — passed.
- `pnpm.cmd --filter @workspace/api-server run typecheck` — passed.
- `pnpm.cmd run typecheck` — exited successfully. Its repository artifact filter printed the
  existing `No projects matched` message, so the two focused package checks above are the direct
  evidence for the changed code.
- `pnpm.cmd --filter @workspace/sikshya run lint:design` — passed at the existing 223 hex / 429
  raw-size baseline; no new design-token leaks.
- Production web build, commit, push, Cloudflare preview deployment and live owner verification
  are still pending at the time of this entry and must be appended below before handoff.

## Problems and surprises

- The first parallel app-test/typecheck attempt hit OneDrive/sandbox access failures: TypeScript
  received `EPERM` opening its own installed compiler, and one Node test process temporarily could
  not resolve the installed `nepali-date-converter` package. Serial host-permitted reruns passed;
  these were filesystem/tooling failures, not failed assertions.
- Earlier stale TypeScript build metadata retained types from the now-paused `is_online` cleanup.
  `pnpm.cmd exec tsc --build --clean` removed that stale metadata; clean focused builds passed.
- Optional integration scripts could not run in this Windows checkout: `test:one-chat` and
  `test:classroom` require `psql`, which is not installed; `test:board` requires Playwright, which
  is not installed; `test:call-chat` could not spawn the package-local esbuild shim from the
  OneDrive pnpm layout. No dependencies were installed or project configuration changed merely
  to mask those environment limitations.
- The supplied recording at
  `C:\Users\missk\OneDrive\Videos\Screen Recordings\Screen Recording 2026-08-27 233456.mp4`
  could not be decoded with the available local tools. Windows Media Player opened its first-run
  configuration instead of the recording, and the in-app browser blocks local `file://` media.
  No telemetry choice or security bypass was made. Implementation therefore follows the owner's
  precise bug report plus source/live-preview inspection.

## Deliberately not changed

- The unfinished `is_online` application-layer cleanup is isolated in
  `stash@{0}: WIP Codex is_online cleanup paused for classroom bugfixes`. It is not in this diff,
  build or deployment and must not be resumed until the owner verifies this hotfix.
- No database schema or migration was changed.
- No membership checks, classroom sockets, Daily token acquisition, participant tracking, call
  teardown behavior, materials state, chat message transport, or whiteboard synchronization was
  changed.
- The production Cloudflare Worker is not to be deployed.
- No new packages were installed.

## Remaining risks / next pickup point

- Build, commit and push the exact hotfix files and this documentation, then explicitly deploy
  the branch-preview Worker and append the commit, Cloudflare version and served bundle here.
- The owner must manually verify teacher and student classrooms in portrait and landscape:
  Excalidraw top/side/bottom tools visible and tappable; drawing around transparent overlay areas;
  exactly one draggable PIP; no Daily pop-out/fullscreen or Daily chat; the classroom Chat action
  opens the sole slide-over; and neither HUD nor PIP overlaps that sheet.
- Because the API controls persistent Daily room properties, confirm the Railway API deployment
  has picked up this branch change before interpreting an old room that still shows Daily UI.
