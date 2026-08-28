# Classroom video usability and chat alerts

- Date: 28 August 2026
- Agent: Codex
- Branch: `claude/excalidraw-whiteboard-sync-gjoqaz`
- Base commit: `b7691fb` (`Record classroom hotfix deployment`)
- Status: implementation, automated verification, commit, push and branch-preview deployment complete; owner verification pending

## Requested

Correct the second round of teacher/student classroom problems found in two owner recordings:
Daily was too small to understand or operate; screen sharing was not realistically viewable; the
camera button unexpectedly hid the whole call; the maximize button did nothing; the student's
Book button did nothing; incoming Sikshya chat had no visible/haptic alert; and the student's
duplicate waiting banner covered Daily. Preserve the now-working Excalidraw tools and Sikshya
slide-over chat, then redeploy the Claude branch preview.

Recordings supplied by the owner:

- Teacher/laptop: `Screen Recording 2026-08-28 001625.mp4`
- Student/phone: `Video_20260828_001658_250_1.mp4`

## Changed

- Updated only the two requested classroom screens:
  - `artifacts/sikshya/app/(teacher)/classroom/[id].tsx`
  - `artifacts/sikshya/app/(student)/classroom/[id].tsx`
- Replaced the previous “tiny or hidden” video behavior with two presentation states while
  keeping the same Daily instance mounted:
  - a substantially larger draggable compact call (token-derived, approximately 480×240 on the
    recorded laptop layout and the available phone width, approximately 288×288 in the recorded
    portrait viewport);
  - an expanded call/screen-share stage filling the usable area between the session header and
    HUD.
- The app-owned maximize button now genuinely toggles Expand Call / Restore Compact Call. It no
  longer calls the browser-inoperative screen-orientation lock.
- Removed the camera-shaped whole-call hide/show control from both HUDs. Camera and microphone
  remain Daily controls inside the now-usable call frame; resizing does not leave or remount the
  call.
- Removed the student's Book/Materials button because the student has no separate materials
  state. The shared board is already the material surface, so the button could not honestly do
  anything.
- Simplified the HUDs to actions that are real:
  - teacher: Materials, Chat, Expand/Restore Call, End Session;
  - student: Chat, Expand/Restore Call, Leave Session.
- Added a tokenised numbered unread badge to the classroom Chat action. It counts only incoming
  messages, clears when the slide-over opens, caps visually at `9+`, and does not count the
  sender's own messages.
- Added a short platform vibration attempt when an incoming classroom message arrives while chat
  is closed. This is best-effort: Android/native browsers generally support it; iPhone Safari may
  ignore web vibration. The persistent unread badge is the guaranteed UI signal.
- Removed the duplicate student “Awaiting your teacher…” floating notice that covered Daily. The
  existing honest board waiting state remains and was moved toward the bottom, below the enlarged
  call and above the HUD.
- Hid the redundant presence chip on compact screens and while the call is expanded, preventing
  it from competing with the larger call. Daily's participant controls remain visible.
- Moved other floating notices below the compact call. Urgent notices can still appear over an
  expanded call by design; they must remain visible during time-limit/access failures.
- Preserved the `box-none` overlay carriers, Excalidraw toolbar safe bands, slide-over chat,
  Daily internal chat/PIP disablement, and single app-owned floating video architecture.

## Decisions and assumptions

- The recordings proved that protecting every pixel of whiteboard at the expense of a usable
  call was the wrong trade. Compact video must be large enough for Daily controls; screen share
  belongs in an explicit expanded state.
- “Camera” must mean camera. A parent HUD button that hides the entire provider frame is removed
  rather than relabelled as camera control.
- The old maximize action was actually an orientation-lock request. It silently failed on the
  web preview and did not enlarge Daily. The icon now controls video size directly on every
  platform.
- A student Book button on a board that is already open had no second destination or state. It
  was removed rather than inventing a materials workflow.
- No attempt was made to duplicate Daily's mic, camera, reaction, hand-raise, People or screen
  share state in React Native. Enlarging Daily keeps those provider controls authoritative and
  avoids a second control system that can drift.
- The unread indicator is royal blue (`primary`), not crimson. The design system reserves
  crimson for Sikshya identity and Live Now; unread chat is an action/attention cue, not brand or
  destructive state.

## Verification

- Both owner recordings were inspected read-only through temporary localhost servers bound only
  to `127.0.0.1`; nothing was uploaded externally. The servers were stopped and the temporary
  browser tabs closed after inspection.
- Teacher recording evidence: Excalidraw tools were visible, but the Daily frame was a narrow
  strip at the upper right and the bottom HUD contained Paperclip, camera/hide, Chat, ineffective
  maximize and End controls.
- Student recording evidence: the portrait call was too small, the waiting notice covered its
  top/control row, the board repeated the waiting explanation below it, and the bottom HUD
  contained the no-op Book, call-hide, Chat, ineffective maximize and Leave controls.
- `pnpm.cmd exec prettier --write` on the two classroom screens — passed.
- `git diff --check` — passed; Git printed only the checkout's known LF-to-CRLF notices.
- `pnpm.cmd --filter @workspace/sikshya run typecheck` — passed.
- `pnpm.cmd run typecheck` — passed. As before, the repository artifact filter printed `No
  projects matched`; the focused Sikshya typecheck is the direct evidence for the changed files.
- `pnpm.cmd --filter @workspace/sikshya run test` — passed 154/154 tests. Node printed the known
  module-type performance warnings; no assertions failed.
- `pnpm.cmd --filter @workspace/sikshya run lint:design` — passed at the existing 223 hex / 429
  raw-font-size baseline; no new raw design values.
- Production web build — passed with the documented Railway API endpoint baked in.
- Commit `fe6fa0f` (`Fix classroom video usability and chat alerts`) — created and pushed to
  `origin/claude/excalidraw-whiteboard-sync-gjoqaz`.
- Wrangler 4.124.0 dry-run — passed against the explicit branch Worker name and read 242 assets.
- Branch-preview deployment — succeeded against the explicit Claude branch Worker.
- External HTTP verification — preview returned 200 and served the new build. Production
  returned 200 and remained on its separate prior build.
- Live-bundle string verification — `Expand video call` and `Restore compact call` are present;
  `Hide teacher video`, `View class materials`, and the duplicate waiting-banner sentence are
  absent.
- Signed-in browser smoke check — the branch preview loaded the teacher dashboard successfully.
  No class was started, resumed or ended merely to manufacture a visual test.

## Problems and surprises

- Windows Computer Use selected a window labelled Windows Media Player but captured the
  Claude/Codex application instead. Automation stopped immediately because controlling the
  ChatGPT/Codex UI is prohibited and would risk interacting with the wrong application.
- The plain `python` command was not on PATH. The bundled workspace Python executable was used
  only to run two temporary read-only localhost file servers.
- Stopping the servers while browser video streams were open produced expected local
  `ConnectionResetError` traces. No source process, upload or remote service failed.
- Native/browser vibration support is not uniform. In particular, iPhone Safari may not buzz.
  The unread count badge is therefore persistent until the chat sheet is opened and must be the
  primary notification signal.
- The UI could not be safely driven through a real class after deployment without changing live
  class state: the teacher route may resume a completed class and calls create/join provider
  rooms. The owner remains the required two-party interaction verifier.

## Deliberately not changed

- No API, database, Drizzle schema, migration, membership check, session status transition,
  booking/payment path, Daily room/token configuration, socket transport, chat message payload,
  whiteboard synchronization, call teardown timer, or materials data flow changed.
- Daily internal chat and PIP remain disabled; there is still exactly one Sikshya chat and one
  app-owned call container.
- The `is_online` cleanup remains isolated in
  `stash@{0}: WIP Codex is_online cleanup paused for classroom bugfixes` and was not included in
  this build or deployment.
- The production Cloudflare Worker was not deployed.
- No dependencies were added or installed.

## Remaining risks / next pickup point

- Owner must verify with one teacher laptop and one student phone:
  - Daily mic, camera, People, reactions, hand raise and More controls are readable/tappable in
    compact mode;
  - compact video remains draggable without stealing board touches;
  - Expand fills the usable call stage and Restore returns to the draggable panel;
  - teacher screen share can be started and stopped, and the student can read it expanded;
  - an incoming message creates a numbered blue badge before the recipient opens Chat;
  - Android/other supported devices buzz; iPhone Safari may not;
  - opening Chat clears the badge and still uses only the Sikshya slide-over;
  - the student waiting state does not cover the call;
  - there are no Book, whole-call camera/hide, or dead orientation buttons;
  - Excalidraw tools remain visible/tappable after compact, expanded, chat and restore transitions.
- If Daily still feels crowded at the new compact size, change only the token-derived compact
  dimensions; do not bring back a call-hide button or enable Daily's second PIP.
