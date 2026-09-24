# Classroom follow-ups

- Date: 2026-09-24
- Agent: Codex
- Branch: codex/classroom-followups-sep24
- Base commit: f35a631
- Status: in progress

## Requested

Work on the deferred classroom observations: consistent student presence count, phone clear-page access, a usable large mobile participant roster, and safe classmate messaging. Keep make-up/refund policy and quiz follow-ups visible.

## Changed

- Nearly full-height mobile teacher roster, safe-area/keyboard handling, scrolling permission surface, compact filters and large-list tests.
- Explicit phone page-menu clear action; confirmation names imported material and page scope. Clearing now uses versioned tombstones so Excalidraw Undo can restore the shared page instead of irreversible board_clear.
- Student count moved into the common header with connected-student semantics, plus a connected-classmate directory containing only display names and ids. Private compose stays inside the live call.
- Server-side student-to-student shared-enrollment check, account-suspension check, durable bilateral private-message blocks, message length/rate bounds; safety/report controls preserve message evidence. No new moderation details exposed to students.

## Decisions and assumptions

Presence means connected students including the viewer, excluding the teacher; never total enrolled students. Keep moderation state private to the teacher and the affected student. Clearing a page must be explicitly confirmed and undoable. No automatic refunds, bans or paid services.

## Verification

Full typecheck passes. API units 731/731, app units 562/562, design lint unchanged at 56 hex / 211 sizes. Local messaging UI 148 checks pass including block/report and 50-classmate search/send at phone and laptop width; screenshots inspected. Local roster 360/360 and full whiteboard browser suite 152/152 pass. Strengthened clear/Undo regression additionally verifies imported file pixels: 12/12. CI run 35986533203 passed real PostgreSQL message/membership/block tests; its floor suite caught two obsolete assertions prohibiting even the newly authorized public names/ids. Replaced these with stricter allow-list and moderation privacy checks; rerun required before promotion.

Final isolated CI **35987948273**, commit **8b4a973**, passed: typecheck, design lint, 731 API units, 562 app units, **70 real API messaging tests**, **140 floor/provider tests**, **360 roster UI checks** and **148 messaging UI checks**. Final local roster/messaging reruns also pass; screenshots inspected at `%TEMP%/floor-shots/phone-390-teacher-sheet.png` and `%TEMP%/fadko-messages-ui-Z7LIea/390-classmates-keyboard.png`. These are browser viewport tests, not physical iPhone/Android claims.

Fast-forwarded main from ca3b05c to **8b4a973** under the owner's standing release approval. Full production web gate **35988533456** stopped before deploy on a clock-dependent class-chat fixture overlap. Railway reports successful deployment of 8b4a973; `/api/readyz` returns `status: ok`. Signed-in production Dashboard and Messages still load against the new API; no message, block, enrollment, class or support ticket was created. The production web bundle is still the previous build until its gate and Cloudflare deploy complete.

## Problems and surprises

The mobile roster was capped at 62% height. Student presence was explicitly desktop-only. Existing direct-message POST accepts arbitrary users and has no block controls; do not expose a classmate shortcut without addressing these safeguards.

Initial roster harness retained the search/filter from the new stress case, hiding subsequent fixtures; isolated its state. A new horizontal filter row clipped the final filter in the narrow laptop drawer; replaced it with shorter wrapping filters and reran. Typechecks caught the auth id's string/number union and an untyped test navigation marker; both corrected. A PowerShell diff command lacked quotes around a parenthesized route and failed read-only; no files were changed by it.

Review caught a block/reaction race: reactions now use the same pair transaction lock as sending and blocking. Added a failure-isolated startup warmup for the additive block table, with writes still failing closed if its schema is unavailable. Rate limiting returns HTTP 429 rather than an access-denied status.

The generic presence event counts sockets including the teacher and duplicate tabs; it is not a student count. The new header uses only the floor's unique connected-student count and shows an unavailable/reconnecting state until that arrives. The final full-screen classroom regression opens the student directory at 360 and 1440 widths, sends a private message to another enrolled test student and verifies the classroom route remains open.

The production gate correctly refused a test teacher's fixed 17:00 Nepal monthly class because the same fixture had just created an overlapping one-time class at wall-clock now + 1 minute. The independent monthly conversation test now has separate teacher/student fixtures. No runtime scheduling validation was relaxed. Added class-chat to isolated CI so this suite runs before promotion as well. Syntax and whitespace checks pass; database rerun pending.

## Fabrications found

None found so far; the ambiguous presence label describes an authoritative connected-student count, not invented attendance.

## Deliberately not changed

Financial policy, provider configuration, accepted LiveKit publishing permissions and unrelated root worktree files.

## Remaining risks / next pickup point

Rerun isolated and full production gates with the independent class-chat fixtures; verify the actual deployed bundle. Physical iPhone/Android keyboard and device reconnection remain useful owner checks. Make-up financial rules and quiz conversion remain separate backlog work.
