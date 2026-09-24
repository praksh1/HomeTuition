# Classroom follow-ups

- Date: 2026-09-24
- Agent: Codex
- Branch: codex/classroom-followups-sep24
- Base commit: f35a631
- Status: complete

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

### Final production release

**9e2c418** passed full production gate **35991929478** in **27m42s** and deployed at **11:42:50 UTC, 24 September 2026**. Cloudflare version **285b9d65-d0f8-4ed7-8c85-364615b0aa6d**. Independently fetched production HTML and JavaScript return HTTP 200; live entry is **entry-461a1e896eb21eb82a5c5add1c23cbfb.js**, with the correct production Railway URL, Classmates here and Safety & help markers. Railway reports the exact commit deployed successfully; `/api/readyz` returns `status: ok`.

The full gate passed **154/154 whiteboard checks**, **360 roster UI checks**, **148 messaging UI checks**, **78 full classroom/floor checks** (including private student-to-student delivery at 360/1440 widths with the call route retained), and **48 real LiveKit call checks**. The permanent gate also passed the retained teacher-studio checks: **143 booking API**, **111 class-setup UI**, **90 booking UI**, **38 Sessions UI**. Server/app units and all other integration journeys passed; no gate was bypassed.

Signed-in production smoke check in a temporary tab: refreshed to the new release, opened Dashboard, Messages and New conversation. The production teacher has no direct-message contacts, so no new conversation was sent and no block/report was exercised against real accounts. Browser error log was empty. No enrollment, class, support ticket or payment was created; the temporary tab was closed, leaving the owner's preview tabs intact. Full in-class/peer/safety verification is the isolated multi-account browser/API evidence above, not a claim of new physical-phone or production-class testing.

## Problems and surprises

The mobile roster was capped at 62% height. Student presence was explicitly desktop-only. Existing direct-message POST accepts arbitrary users and has no block controls; do not expose a classmate shortcut without addressing these safeguards.

Initial roster harness retained the search/filter from the new stress case, hiding subsequent fixtures; isolated its state. A new horizontal filter row clipped the final filter in the narrow laptop drawer; replaced it with shorter wrapping filters and reran. Typechecks caught the auth id's string/number union and an untyped test navigation marker; both corrected. A PowerShell diff command lacked quotes around a parenthesized route and failed read-only; no files were changed by it.

Review caught a block/reaction race: reactions now use the same pair transaction lock as sending and blocking. Added a failure-isolated startup warmup for the additive block table, with writes still failing closed if its schema is unavailable. Rate limiting returns HTTP 429 rather than an access-denied status.

The generic presence event counts sockets including the teacher and duplicate tabs; it is not a student count. The new header uses only the floor's unique connected-student count and shows an unavailable/reconnecting state until that arrives. The final full-screen classroom regression opens the student directory at 360 and 1440 widths, sends a private message to another enrolled test student and verifies the classroom route remains open.

The production gate correctly refused a test teacher's fixed 17:00 Nepal monthly class because the same fixture had just created an overlapping one-time class at wall-clock now + 1 minute. The independent monthly conversation test now has separate teacher/student fixtures. No runtime scheduling validation was relaxed. Added class-chat to isolated CI so this suite runs before promotion as well. Syntax and whitespace checks passed; the subsequent database rerun is recorded below.

Fixture repair **df4f663** passed every isolated check in **35989731785**, including class-chat against real PostgreSQL. Main was fast-forwarded. Then **d435d1c** retained the previously passing teacher-studio API/UI and classmate-message UI suites in the permanent production workflow (they otherwise ran only on feature branches). The earlier web run **35990196823** was superseded; the replacement full gate is **35990388918**. No application change was included in this workflow-only follow-up.

Gate **35990388918** passed through the expanded teacher booking tests, payments, support and upgrade checks, then stopped at `test:one-chat`: another old fixture reused the same teacher for now+1-minute and fixed 17:00 lessons. **9e2c418** gives the independent course its own teacher and stops immediately on failed fixture creation instead of issuing SQL with an undefined id. Audited the other fixed-time course fixtures: late-joiner, upload-browser and portal create distinct teachers; teacher-leave already uses a known-free slot; learning-program cross-format conflicts are intentional assertions. Added one-chat, late-joiner, teacher-leave and monthly-contract checks to early CI. Runtime conflict checks remain unchanged. Production web is still the previous accepted build.

Expanded isolated CI **35991334932** passed on **9e2c418**, including the four additional legacy suites. Main fast-forwarded to that exact commit; production gate **35991929478** is running. Uncommitted worklog/HANDOVER updates are documentation only and intentionally not interrupting the release run.

During the final smoke check, a signed-in hard refresh of `/messages` returned to Dashboard during auth hydration. This also occurred before the web release; normal Messages navigation works. Recorded as a separate return-route follow-up, not silently attributed to this release or claimed fixed. One log download initially returned cached early build output; the completed GitHub job-log endpoint supplied the final verification counts/version after stripping ANSI formatting. Final production evidence is above.

## Fabrications found

None found so far; the ambiguous presence label describes an authoritative connected-student count, not invented attendance.

## Deliberately not changed

Financial policy, provider configuration, accepted LiveKit publishing permissions and unrelated root worktree files.

## Remaining risks / next pickup point

Release is live at **9e2c418**; later documentation-only commits do not change that application-release reference. Physical iPhone/Android keyboard and device reconnection remain useful owner checks. Make-up financial rules, quiz conversion and the signed-in cold-refresh return route remain separate backlog work. Keep the permanent teacher-studio and classmate regression steps in future production gates.
