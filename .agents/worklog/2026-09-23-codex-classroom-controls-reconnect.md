# Classroom controls, reconnect and reactions

- Date: 2026-09-23
- Agent: Codex
- Branch: codex/classroom-whiteboard-ux
- Base commit: e9848d5
- Status: deployed and verified on Preview; production unchanged

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
- Rendered student floor / teacher roster: 272/272 at 390, 412, 768 and 1440px, including
  approved-camera enabled/click coverage added following the CI assertion finding below.
- Rendered classroom chat: 26/26. Phone whiteboard suite: 18/18.
- Targeted toolbar geometry: 30/30 at 360, 390, 768, 1366, 1440 and 1920px.
- Full whiteboard regression suite: 134/134, including rejoin image pixels, explicit file
  delete/Undo, page isolation, eraser protection, PDFs and viewport following.
- Supplemental real-canvas page-history test: 5/5; changing pages clears history and keyboard
  Undo cannot bring the previous page's content into the new blank page.
- App unit suite: 559/560; the sole remaining failure is the unchanged support-menu assertion
  described below. Current-class journey contracts pass 7/7.
- Preview workflow 35932278266 passed all release gates, including a real two-party LiveKit
  call (48/48) and the complete API-backed teacher/two-student permission flow (61/61).
- Post-deployment checks against the actual isolated Preview: 38/38 across six toolbar widths,
  real image pixels on catch-up, equal-version/empty snapshots and material unlock/remove/Undo.
- Served HTML and all three initial JS bundles exactly matched the release build and targeted
  the staging API. Staging `/api/readyz` returned HTTP 200 after deployment.
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

Preview run 35930879450 stopped before deployment at the full-classroom camera-enabled assertion
(60/61 checks). The test incorrectly required `aria-disabled="false"`; React Native Web emits
that attribute only when disabled, otherwise omitting it. Reproduced the enabled DOM with
`label: Turn on camera, disabled: null` and verified an actual click reaches the LiveKit callback.
Use Playwright `isEnabled()` plus the exact action label instead; disabled/listener/revocation
checks remain intact. No application permission changes for this correction.

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

Application commit `d545e9f401ab613d8443503132ab6f9bb5f5b55f`, followed by test-only correction
`dfbee5035382e1074c85ea49c8ed56ca1463fcd9`, pushed to `codex/classroom-whiteboard-ux`.

- Successful release: https://github.com/praksh1/HomeTuition/actions/runs/35932278266
- Preview: https://hometuition-preview.praksh-dhakal.workers.dev
- Cloudflare Preview version: `f25f4628-72a9-4d47-b8ae-ba84c02cd96c`
- Railway GitHub status confirms `dfbee5035382e1074c85ea49c8ed56ca1463fcd9` deployed successfully
  to `hometuition-api-staging`, service `cc10a94f-b24b-47bc-ae5c-ec2a9307cfa0`, deployment
  `64de0b90-03bc-4d34-8bb1-cb47e8265365`.

No production merge/deploy. Physical iPhone/Android camera/mic and dropped-call retry should
still be retested by the owner on Preview. Reload Preview before testing. The Files control
manages the current board page; PDF sheets remain separate objects, not automatically separate
whiteboard pages. Reactions are live/ephemeral, not a persisted message-reaction history.

Release-result additions to this log are local handoff notes after the verified code push;
they deliberately do not trigger another deployment just to record deployment metadata.
