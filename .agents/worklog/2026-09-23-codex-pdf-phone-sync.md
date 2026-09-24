# Multi-page PDFs, phone zoom and teacher hidden-call controls

- Date: 2026-09-23
- Agent: Codex
- Branch: codex/classroom-whiteboard-ux
- Status: in progress

## Requested

Owner reported different PDF scale on two iPhones, a second 14-page PDF apparently finishing
without appearing, and asked for teacher microphone/camera controls while LiveKit is hidden.
No new recording attachment arrived with this request. Do not claim it was reviewed.

## Changed

- SmartBoard: document imports use dimensions already obtained by pdf.js instead of decoding all
  sheets again concurrently; abort obsolete work; release canvases even on errors; report success
  only after placement. New documents get separate canvas space and focus on their first sheet.
- boardScenePackets: bounded scene/file packets keep multi-page imports below the existing
  4 MiB classroom WebSocket limit, keeping picture bytes with their elements. No raised server cap.
- SmartBoard: teacher Zoom menu, zoom in/out, 100%, Fit current sheet. Centre-preserving zoom
  publishes to the class. Re-measure/publish on editor/browser viewport resize. Student uses the
  same classroom header inset so identical phones have matching canvas geometry.
- Teacher classroom, VideoCall, LiveKitEmbed and ClassroomControlDock: hidden-call mic/camera
  toggles reuse actual provider operations, report provider-confirmed state, disable during
  disconnection, and keep the call mounted. Native fallback and Daily do not falsely offer them.
- Permanent repeat-import/zoom/pixel checks in board-tests; provider-driven hidden-control checks
  in livekit-tests; unit coverage for frame splitting. PDF fixtures are synthetic, not user files.

## Decisions and assumptions

Preview/staging only. Always-follow remains mandatory for students. Different aspect ratios fit
the teacher rectangle without cropping; identical phone sizes must match. PDF sheets are objects
on the selected board page, not newly allocated board pages; Files can locate/remove each sheet.
The existing 25-page import and per-picture limits remain. No purchases or real account writes.

## Verification

- Old build + synthetic detailed 14-page PDF: one scene packet measured 6,094,972 characters,
  above server maxPayload 4 * 1024 * 1024. The local canvas itself eventually rendered the fixture;
  this does not reproduce every possible physical iPhone failure, but establishes the wire bug.
- TypeScript passed with shared dependencies accessible outside the filesystem sandbox.
- New packet tests 2/2. Local staging-targeted build passed with API identity verification.
- LiveKit rendered controls 135/135, including a 320-point rail; real component and controlled
  fake provider, not live media.
- Phone PDF checks observed: 14 sheets, separate document positions, same scale, synced zoom,
  Fit, last sheet, remove/reimport, rotation. Complete board regression: 145/145.
- Existing phone tool/layout regression: 18/18. Final typecheck passed.
- Detailed synthetic 14-page PDF now emits 3 packets of 2,612,192 / 2,612,193 / 870,722 characters,
  each below the unchanged 4 MiB limit. Progress toast moved above navigation, pointer-transparent.
- Visual inspection of teacher/student phone canvas screenshots confirms matching PDF bounds.
- Design lint unchanged baseline: 56 hex literals / 211 font sizes. git diff --check clean.

## Problems and surprises

- Sandbox cannot resolve several shared Node dependencies; escalated typecheck resolves them.
  Do not interpret missing modules as product source errors or reinstall/reset the workspace.
- First repro waited 14 seconds and sampled before a detailed PDF finished. Repeated with actual
  scene-output readiness; distinguished slow rendering from transport failure.
- Test harness needed a font adapter when native-web dock was added to LiveKit-only harness.
- Initial overlap assertion counted invisible collapsed menu buttons. Corrected to measure
  visible primary controls, inspected screenshots, and reran successfully.
- First repeated-PDF test used a build from before single-page PDF groups were included; final
  rebuild includes the corrected group list and passes the remove/reimport scenario.

## Fabrications found

None found. Import progress previously could clear before successful placement; this pass makes
the intermediate preparation and completed placement distinct.

## Deliberately not changed

Production, paused AI support, classroom scheduling/accounting, provider credentials and student
floor authorization. No claim of native LiveKit SDK or physical Safari testing.

## Remaining risks / next pickup point

Finish full board/phone gates, latest hidden controls at narrow sizes, final typecheck. Push exact
branch and run isolated Preview workflow; verify served asset and API identity afterwards.
Owner should validate their own 14-page PDF on the two physical iPhones after deployment.
