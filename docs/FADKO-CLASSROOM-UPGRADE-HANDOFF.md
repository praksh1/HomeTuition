# Fadko classroom upgrade handoff

Date: 19 September 2026
Branch: `codex/unified-messages-inbox`
Status: implementation reviewed and corrected for this staged slice; not deployed.

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

## Verification

- Sikshya unit suite: **488 passed, 0 failed**.
- Whiteboard page and laser contracts: **9 passed, 0 failed**.
- Design lint: **passed; no new token leaks**.
- `git diff --check`: clean (only the repository's normal LF/CRLF warnings).
- Sikshya typecheck: no classroom errors; it is still blocked by the existing unresolved package
  junctions for `@react-native-community/datetimepicker`, `expo-crypto`, social auth packages and
  `livekit-client` in this restricted checkout.
- API typecheck: no classroom errors; it is still blocked by the existing unresolved `jose` and
  `livekit-server-sdk` package junctions in this restricted checkout.
- Static web export could not be run in this sandbox because the build requires the deployment
  domain environment variable (`REPLIT_INTERNAL_APP_DOMAIN`, `REPLIT_DEV_DOMAIN` or
  `EXPO_PUBLIC_DOMAIN`). This is an environment gate, not a page-feature failure.

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
6. Test the existing PDF/photo path on a small Android/WebView and a laptop. Do not use a large
   textbook as the first test; the existing size cap and lazy rasterisation still apply.

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

1. Run the browser QA above in Preview.
2. Fix any page/bridge issues found by the real device pass.
3. Add the permission protocol and cursor/laser utilities with pure rules first.
4. Run the LiveKit Cloud proving session without changing the production provider.
5. Only after those gates pass, commit and push this complete tree and deploy Preview; keep
   Production on Daily until an explicit provider decision is made.
