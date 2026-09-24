# Classroom chat: keyboard-safe follow-up

- Date: 2026-09-23
- Agent: Codex
- Branch: codex/classroom-whiteboard-ux
- Base commit: dfbee5035382e1074c85ea49c8ed56ca1463fcd9
- Status: in progress; local checks passed, final release checks pending

## Requested

Keep working on the classroom fixes while the owner cannot upload a large teacher recording.
The previously linked Sep 23 16:31 recording is readable locally and was already reviewed in
the preceding pass. No newer recording or new teacher-side failure was inferred.

## Changed

- `hooks/useVisibleViewport.ts`: subscribe only while a surface is open; follow the browser's
  visible height and top offset with animation-frame-coalesced resize/scroll handling. Keep native
  keyboard handling, older-browser fallback and user pinch zoom intact.
- `components/classes/ClassroomChatDrawer.tsx`: phone sheet and web drawer fit above a software
  keyboard, including viewport panning. Short displays omit decorative handles/reaction helper
  text to preserve message space. Readable phone input text, 44px latest-message target, explicit
  web disabled/expanded/live-region semantics, and the IME keyCode 229 guard used by RN Web itself.
- `scripts/classroom-chat-ui/run.mjs`: six widths/orientations, visual-viewport keyboard fixture,
  actual scroll clipping bounds, connection loss/draft/reopen/send checks and IME keyboard checks.
  Uses real browser clicks and rendered component styles. The keyboard fixture is NOT a physical
  iPhone/Safari or Android software-keyboard test.
- Added the rendered chat suite to both Preview and future production release gates; no gate
  was removed, skipped or relaxed. The production workflow is not dispatched by this task.

## Decisions and assumptions

Preview only. The frontend-only follow-up does not modify board state, server messaging,
LiveKit permissions, payments or the paused AI-support rollout. No new dependencies or purchases.

## Verification

- Reproduced two failing checks before the fix: phone composer and Send remained below the
  simulated visible keyboard boundary while the layout viewport stayed full height.
- Expanded rendered suite: **144/144** after the final IME/reaction/reconnect additions.
- Repository typecheck passes. Design guard passes at unchanged 56 hex / 211 raw-size baseline.
- Examined phone and tablet keyboard/reaction screenshots, not just element counts.
- Browser viewport behavior reference: https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
  and https://developer.chrome.com/blog/viewport-resize-behavior .

## Problems and surprises

- Old chat tests checked that the latest message existed in the DOM, not that it was visible.
  Replaced this with clipping bounds and a bounded wait for the smooth scroll to finish.
  An initial 250ms sample was too early; the actual scroll completed within the 2-second bound.
- A composing-input test initially counted the textarea itself as matching message text. Inspect
  the controlled draft and harness message records instead; ordinary IME composition was already
  preserved. Added the separate keyCode 229 case after inspecting RN Web's installed handler.
- The narrow tablet keyboard layout initially left only 71px of message height with reactions.
  Shortened the redundant connection subtitle on short screens to give the history more room.

## Fabrications found

None found. No claims of real phone keyboard testing or delivery acknowledgments were introduced.

## Deliberately not changed

Production, AI-support rollout, class membership and provider publishing authority. No new video
was assumed from the upload error. The existing support-menu unit-test mismatch remains outside
this classroom change (documented in the preceding worklog).

## Remaining risks / next pickup point

Run final checks, push the exact classroom branch, and deploy using the existing gated isolated
Preview workflow. Confirm the deployed build; retain physical iPhone/Android testing as a limit.
The preceding pass's post-release worklog additions are included in this next legitimate change.
