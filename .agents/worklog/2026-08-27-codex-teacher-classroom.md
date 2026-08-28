# Teacher classroom edge-to-edge whiteboard

- Date: 27 August 2026
- Agent: Codex
- Branch: `claude/excalidraw-whiteboard-sync-gjoqaz`
- Base commit: `dd3b8df` (`Record teacher profile handoff`)
- Status: complete; ratchet locked, awaiting real teacher-side touch verification

## Requested

Upgrade only `artifacts/sikshya/app/(teacher)/classroom/[id].tsx`. Make the SmartBoard/Excalidraw
surface edge to edge, move classroom chrome into pointer-safe floating overlays, present video as
a draggable PIP, make chat a slide-over sheet, tokenise all colours and typography, keep the
15-minute/time-limit notices above the board without shifting it, update the design-lint ratchet,
and stop before changing the student classroom.

## Changed

- Made the SmartBoard/PDF surface the full content area with no screen padding, margin, card
  radius, header row, video row, or mode row taking permanent space. The board stays mounted while
  chat opens, so opening a conversation does not recreate the teaching surface.
- Replaced the fixed video split with a persistently mounted, bordered and lightly elevated PIP.
  Its dedicated 44-point grip uses `PanResponder`; movement is clamped to the visible stage and
  re-clamped after rotation. Taps elsewhere inside the PIP still reach the real call controls.
- Added a bottom-centred floating HUD for material, PIP visibility, chat, orientation and the
  existing end-session action. Its full-screen carrier uses `pointerEvents="box-none"`; only the
  visible capsule and buttons capture input.
- Rebuilt chat as an animated bottom sheet over the board. It uses the existing socket messages,
  draft, send function and scroll ref, uses the dedicated `scrim` token, and slides with a short
  transform-only animation. The inert closed layer uses `pointerEvents="none"`.
- Moved photo/PDF actions into an elevated material popover above the HUD. File preparation,
  shareability decisions, native/web pickers and board insertion are unchanged.
- Replaced the in-flow access, not-started, time-limit, alone-in-call, local-PDF and upload-error
  bars with tokenised floating notices. Their carriers use `box-none`; each visible notice alone
  captures touches and enters from the top with a 220 ms transform animation. Warning states use
  `warn`/`warnSoft`; teardown/error states use `destructive`/`destructiveSoft`.
- Replaced the fixed dark classroom chrome with the light design-system surfaces. Actions are
  royal blue, the LIVE identity is crimson, destructive actions are outlined, and all text uses
  `useLayout().t`; money/count/time text uses tabular numerals where applicable.
- Removed the unreachable participant gallery containing hardcoded names and invented active
  statuses. The real socket presence count remains visible; no participant data source changed.
- Removed all 108 hex literals and all 31 raw font sizes from this file. `lint:design:update`
  removed it from the dirty baseline, reducing the project from 393 / 481 to 285 / 450.

## Decisions and assumptions

- All session API calls, socket functions, video-provider selection, room lifecycle, timers,
  teardown, upload preparation, and board synchronisation are frozen for this UI pass.
- Transparent overlay layers will use `pointerEvents="box-none"`; only visible interactive
  surfaces will capture touches. The board remains the default touch recipient.
- Native mic/camera controls are implemented inside `DailyEmbed`, and web controls belong to
  Daily Prebuilt. Adding parent-level mic/camera buttons would require changing the provider
  contract and shared components, which conflicts with the one-file boundary. Those real controls
  will remain inside the floating video surface; this file will not add fake duplicates.
- The same WebSocket chat is now presented by this screen's sheet on every platform. The
  `VideoCall` instance remains mounted but is no longer given duplicate chat presentation props;
  message transport and state remain in the classroom exactly as before.
- `boardExpanded` remains the existing presentation flag and now means the PIP is hidden. Hiding
  it uses `display: none` on the wrapper rather than conditionally unmounting `VideoCall`.

## Verification

- `pnpm --filter @workspace/sikshya run typecheck` — passed after the final PIP/pointer changes.
- `pnpm --filter @workspace/sikshya run lint:design` — passed before the update and reported this
  file improved from 108 hex / 31 sizes to 0 / 0, with no new leaks.
- `pnpm --filter @workspace/sikshya run lint:design:update` — passed; baseline written at 58 files,
  285 hex literals and 450 raw font sizes.
- Final `pnpm --filter @workspace/sikshya run lint:design` — passed against the updated 285 / 450
  baseline with `No new leaks`.
- `git diff --check` — passed before documentation updates.
- No browser/device render or touch test was claimed. The owner explicitly wants teacher-side
  touch propagation verified before the student classroom is touched.

## Problems and surprises

- The initially supplied path/code contained placeholders. Repository inspection identified
  this teacher classroom as the 108-hex target; `app/session/[id].tsx` is only the entry/redirect.
- The existing output was too large for one terminal response, so it was read in explicit ranges.
- The actual mute/camera controls are below this file's abstraction boundary. Moving them into the
  parent HUD would require a new imperative `VideoCall` provider contract and edits to both Daily
  implementations. That expansion was rejected for this one-file pass; the functioning controls
  remain inside the PIP instead of being replaced with decorative buttons.
- Prettier reformatted the whole large file, so the textual diff is much larger than the semantic
  layout change. The API/socket/upload/timer functions were retained and reviewed separately from
  the render/style rewrite.
- The first final lint/status orchestration was rejected by the host because its elevated-action
  usage gate had been reached. After the owner said `resume`, the same read-only design lint ran
  successfully without elevated access; no workaround or code change was needed.

## Deliberately not changed

- `artifacts/sikshya/app/(student)/classroom/[id].tsx` is not part of this pass.
- `VideoCall`, `DailyEmbed`, `SmartBoard`, hooks, API code, and socket code are not being changed.
- No tests or baseline changes were made for the student classroom or shared video components.
- No commit or push was requested in this stop point.

## Remaining risks / next pickup point

- Verify on an actual teacher device that drawing works everywhere outside visible overlays, the
  PIP grip drags without stealing taps from Daily controls, the HUD buttons remain tappable, the
  chat scrim closes the sheet, and rotation cannot strand the PIP off-screen.
- The compact PIP is intentionally large enough to keep Daily's existing native mic/camera/share/
  leave bar usable. Judge that tradeoff on the target budget Android before changing its size.
- Do not begin `app/(student)/classroom/[id].tsx` until the owner confirms teacher-side touch
  behaviour.
