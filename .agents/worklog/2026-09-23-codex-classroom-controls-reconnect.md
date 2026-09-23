# Classroom controls, reconnect and reactions

- Date: 2026-09-23
- Agent: Codex
- Branch: codex/classroom-whiteboard-ux
- Base commit: e9848d5
- Status: local verification complete; Preview release pending

## Requested

Address the owner's Sep 23 recording and five screenshots: overlapping classroom controls,
toolbar-adjacent ink/history and class title, participant action overflow, synchronized student
camera/mic controls, missing images after rejoining, accessible locked-material management, and
modern in-class chat with reactions.

## Changed

- SmartBoard: history/colour/thickness integrated into the desktop editor rail; a compact header
  row on narrower screens; real 44px colour targets. Explicit responsive refresh prevents stale
  laptop toolbar geometry on a phone. Class title aligns with this rail. Removed the duplicate
  floating teacher student-count badge; the class-list button retains the count.
- Full board catch-up restores authoritative elements, including empty/equal-version snapshots,
  and primes Excalidraw's decoded image cache AFTER installing image elements. Native bridge sends
  page context before scenes; page-change state no longer nests React state setters.
- Files panel: ordinary tap/click to locate, lock/unlock, remove an image/PDF sheet, or remove a
  document's sheets on the current board page. Explicit page unlock stays available. Browser
  context-menu stacking is suppressed; selection actions show Unlock for locked selections.
- Imported files now commit to Excalidraw history immediately. Files-panel deletion works even
  after selecting the eraser; Undo restores the material. Changing pages resets local history.
- Student hand/mic/camera/call/chat/menu live in one aligned rail with actual media status below.
  Camera requests use LiveKit's existing permission gate and onLocalMediaChange, not optimistic
  UI state. Teacher participant actions wrap within their drawer rather than the outer viewport.
- Call docks are not mounted over open chat/participant surfaces. Menus open by deliberate click,
  not enter-hover followed by a competing tap. In-class chat supports Enter/Shift+Enter and IME.
- Five live class reactions, a compact composer picker and a non-interactive floating feedback
  lane. Server allowlist, per-member cooldown and room stream cap; client animation cap and
  reduced-motion support. These are ephemeral class reactions, NOT stored per-message reactions.
- Regression tests cover real canvas reconnect pixels, material unlock/delete/Undo, six toolbar
  widths, unified student controls, drawer boundaries, chat interaction and provider permission.

## Decisions and assumptions

Preview review first. AI-support production rollout remains paused. No purchases or changes to
payment, classroom membership or teacher-granted publishing authority.

## Verification

Reviewed all five supplied screenshots and sampled the 66-second recording at six-second intervals.
Completed:
- Repository typecheck and design-token guard pass (baseline not increased).
- API unit suite: 713/713.
- Rendered LiveKit controls: 116/116, including external camera and permission rejection.
- Rendered student floor / teacher roster: 264/264 at 390, 412, 768 and 1440px.
- Rendered classroom chat: 26/26. Phone whiteboard suite: 18/18.
- Targeted toolbar geometry: 30/30 at 360, 390, 768, 1366, 1440 and 1920px.
- Full whiteboard regression suite: 134/134, including rejoin image pixels, explicit file
  delete/Undo, page isolation, eraser protection, PDFs and viewport following.
- App unit suite: 559/560; the sole remaining failure is the unchanged support-menu assertion
  described below. Current-class journey contracts pass 7/7.
- Screenshots inspected in temporary fadko-board-chrome, floor-shots and fadko-classroom-chat
  directories. Local fixtures use controlled provider/account state; they are not a physical
  iPhone or an actual two-person Cloud LiveKit call.

## Problems and surprises

Excalidraw 0.18.1 addFiles scans its current scene for image elements. The previous receive path
called it before installing the scene and skipped equal-version snapshots. The native bridge
also posted catch-up scenes before their page metadata.

Tests exposed two additional issues before deployment: the editor retained desktop geometry
until a new interaction, and imported files were not committed to Undo history until a canvas
gesture. Both corrected. One early full-board run was invalidated by a simultaneous local
rebuild; it was discarded and rerun against a stable build, not counted as a pass.

The full app unit suite has a pre-existing paused-support assertion in accountDetailsUi.test.ts
expecting a disabled "Fadko assistant" menu. Its test and AppShellHeader source are unchanged in
this pass. The other failing assertion expected the old hover-trigger dock; it was updated to
the intentional-click contract and reinforced with actual rendered clicks. Do not call the
entire app unit suite green while the unrelated support assertion remains.

## Fabrications found

None found.

## Deliberately not changed

Production and the paused AI-support rollout.

## Remaining risks / next pickup point

Commit/push the classroom branch, deploy the isolated Preview Worker
and confirm the corresponding staging API revision. No production merge/deploy. Physical
iPhone/Android camera/mic and dropped-call retry should be retested by the owner on Preview.
