# Fadko classroom upgrade handoff

Date: 19 September 2026
Branch: `codex/premium-classroom-pages`
Status: implementation reviewed, corrected and browser-verified; ready for Preview, not Production.

## Codex review corrections

- Fixed restart restoration so activating the saved page cannot overwrite its restored drawing
  with the new server process's empty placeholder.
- Made **Clear this page** persist the empty active page while retaining every other page. The
  earlier implementation deleted the entire stored multi-page board, so the other pages vanished
  only after a later server restart.
- Added a server-side laser rate boundary in addition to the client's throttle, preventing a
  modified teacher client from flooding every connected phone with pointer frames.
- Extended the real restart suite to prove both the active page and a previously selected page,
  including image bytes, return after a restart.
- Bound every scene delta to the page where it originated. A final Page 1 pen update arriving
  after the teacher selected Page 2 is now stored on Page 1 and can never leak onto Page 2.
- Protected startup restoration with a board revision. A rename, template change or page switch
  made while storage is loading can no longer be silently overwritten by the older saved copy.
- Kept page management available when a page is locked, so **Unlock** remains reachable while
  drawing and document insertion are correctly disabled.
- Made delete and clear explicitly destructive: page deletion asks for confirmation and clearing
  consistently says it affects this page for the whole class.
- Removed an empty-update render loop caught by the first production bundle and changed the
  slowdown harness to wait for the real board canvas instead of guessing with a fixed delay.

## What was preserved

The existing classroom remains the source of truth. Daily is still the default provider, the
current Excalidraw board still owns drawing, object selection, undo/redo and file placement, and
the classroom socket still owns chat, reactions, presence, reconnect and teacher-led viewport
following. Nothing in this slice silently enables LiveKit or recording.

## Delivered in this slice

### Video window

- Desktop/laptop classroom entry starts in the working `normal` video size; phones still start
  compact so the board remains primary.
- The existing hide, restore, minimise, maximise, drag and rotate state machine is unchanged and
  shared by teacher and student routes.
- Call-window coverage is now 25 pure tests; the new test protects the responsive entry decision.

### Synchronized whiteboard pages

- Teachers now have a compact page capsule: previous/next, page count, add page and a page menu.
- A thumbnail drawer gives teachers a quick visual jump list, while the page menu now exposes
  bounded move-up/move-down controls for reordering without making the board look like an admin
  table.
- Pages can be selected, duplicated, renamed, reordered, deleted (the final page is protected),
  locked/unlocked and assigned a lightweight background template: blank, lined, graph, dots,
  math-grid, coordinate plane or music staff.
- Each page has its own Excalidraw scene and image-file map. Switching pages clears the old scene
  before applying the new page's full state, so annotations cannot leak between pages.
- Students receive the same active page and follow teacher navigation. They remain read-only, and
  a locked page is also read-only for the teacher until it is unlocked.
- Student page status is deliberately compact and read-only; it does not draw disabled editing
  controls that look actionable.
- Teachers have an ephemeral laser-pointer mode. Pointer coordinates are normalized to the board,
  throttled to 50 ms, server-authorized, and auto-expire on every viewer; they never enter the
  saved Excalidraw scene.
- The teacher can explicitly bring everyone back to the teacher's current viewport after a
  student has temporarily panned away; this is a real re-broadcast, not a local-only toast.
- Page changes are teacher-authorised on the server. A student cannot select a private page or
  mutate a scene by sending a fabricated page id.
- Existing one-page clients remain compatible: missing page metadata means `page-1`, and old
  persisted scene arrays are still restored.
- Multi-page metadata and scenes persist through the existing `session_board.scene` JSONB field
  using a versioned envelope. No schema migration or manual `db:push` is required.
- Native phones use the same WebView board and bridge; page metadata is queued until the board is
  ready, just like scene and viewport catch-up.

## Files changed for the classroom slice

- `artifacts/sikshya/utils/callWindow.ts`
- `artifacts/sikshya/utils/callWindow.test.ts`
- `artifacts/sikshya/utils/whiteboardPages.ts`
- `artifacts/sikshya/utils/whiteboardPages.test.ts`
- `artifacts/sikshya/hooks/useClassroomSocket.ts`
- `artifacts/sikshya/components/SmartBoard.web.tsx`
- `artifacts/sikshya/components/SmartBoard.tsx`
- `artifacts/sikshya/app/board.tsx`
- `artifacts/sikshya/app/(teacher)/classroom/[id].tsx`
- `artifacts/sikshya/app/(student)/classroom/[id].tsx`
- `artifacts/api-server/src/ws/classroomHub.ts`
- `artifacts/api-server/src/lib/boardStore.ts`
- `artifacts/api-server/scripts/board-persistence/run.mjs`
- `artifacts/sikshya/scripts/board-tests/harness.mjs`
- `artifacts/sikshya/scripts/board-tests/tests.mjs`
- `artifacts/sikshya/scripts/perf-tests/run.mjs`
- `docs/FADKO-CLASSROOM-UPGRADE-HANDOFF.md`

## Verification

- Full workspace typecheck: **all four checked packages clean**.
- Sikshya unit suite: **493 passed, 0 failed**.
- API unit suite: **572 passed, 0 failed**.
- Rendered teacher/student whiteboard suite: **65 passed, 0 failed**. It covers separate page
  scenes, delayed updates naming their origin page, student follow, lock/unlock, laser start/stop,
  viewport return, erasure, clear confirmation, photo sharing and a real two-page PDF.
- Small-phone board suite: **18 passed, 0 failed** at 393px, 375px and 360px. All tools remained
  reachable, no horizontal overflow appeared, and drawing still worked.
- Throttled performance suite: **no blocking problems at 6x CPU slowdown**. A 500-object lesson
  rendered in about 2.4 seconds in that run; the worst incremental stroke was 412 ms, below the
  suite's unusable boundary.
- Static Preview web export: **built successfully** and verified to name Fadko and target the
  staging API.
- Design lint: **passed; 65 hex literals / 211 raw sizes, exactly the existing baseline**.
- `git diff --check`: clean (only the repository's normal LF/CRLF notices).
- The database-backed classroom/lobby and restart-persistence scripts were not rerun in this
  Windows worktree because there is no local Postgres/API on ports 55432/8080. Their new page-race
  assertions are committed for the staging/CI gate; this is the remaining automated evidence gap,
  not evidence that those paths passed.

## Required browser QA before Preview deployment

1. Open a teacher classroom on a laptop and on a narrow phone viewport.
2. Add a lined page, draw a mark, add a second page, draw a different mark, then switch pages.
   Confirm each page keeps only its own work.
3. Duplicate a page, rename it, change its template, lock it, and confirm the teacher cannot draw
   until unlocking it.
4. Join the same session as a student. Confirm page changes and page backgrounds arrive without a
   refresh, and that the student never sees editing controls.
5. Refresh/reconnect the teacher and confirm page names, order, templates, lock state and scenes
   return. Start a new lesson and confirm the deliberate board reset still clears all pages.
6. Test the existing PDF/photo path on a small Android/WebView and a laptop. A two-page PDF is
   already proven in Chromium; do not use a large textbook as the first real-device test because
   the existing size cap and lazy rasterisation still apply.

## Intentionally next, not faked here

- Collaborative cursor labels (the laser pointer itself is now delivered).
- Teacher-controlled `Teacher only / Everyone / Selected students` editing permissions. The
  current authoritative rule remains teacher-only; a permissions protocol should be added before
  exposing student drawing.
- Drag-to-reorder, true PDF-to-page import and per-page viewport history. The first slice now has
  thumbnail navigation and bounded move-up/move-down controls; drag interaction is intentionally
  left for a later touch-safe pass.
- Teaching utilities (timer, poll, raise-hand and random picker).
- Daily's provider-independent custom controls and LiveKit Cloud proving run. The existing
  LiveKit web adapter and secure token route remain available behind configuration, but Daily must
  stay the default until Cloud credentials, real phones and Kathmandu-latency testing pass.

## LiveKit readiness checklist

The next provider task should verify, in a staging account only:

- `VIDEO_PROVIDER=daily` remains the default and a safe client provider identifier is all the
  browser receives.
- `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are server-only secrets.
- Teacher/student membership, room naming and identity are derived by the API, not query params.
- Join/leave, mic, camera, screen share, device selection, active speaker and reconnect work in
  two browsers and at least one real Android/iPhone before switching the flag.
- No recording/Egress button is exposed until consent, retention and cost rules are approved.

## Handoff order

1. Deploy this branch to Preview and run the browser/device QA above.
2. Fix any page/bridge issues found by the real-device pass; do not promote to Production first.
3. Run the database-backed classroom/lobby/persistence gates in the staging environment.
4. Add the permission protocol and collaborative cursor labels with pure authority rules first.
5. Run the LiveKit Cloud proving session without changing the Production provider. Keep
   Production on Daily until an explicit provider decision is made.
