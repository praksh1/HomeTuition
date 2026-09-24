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

## Problems and surprises

The mobile roster was capped at 62% height. Student presence was explicitly desktop-only. Existing direct-message POST accepts arbitrary users and has no block controls; do not expose a classmate shortcut without addressing these safeguards.

Initial roster harness retained the search/filter from the new stress case, hiding subsequent fixtures; isolated its state. A new horizontal filter row clipped the final filter in the narrow laptop drawer; replaced it with shorter wrapping filters and reran. Typechecks caught the auth id's string/number union and an untyped test navigation marker; both corrected. A PowerShell diff command lacked quotes around a parenthesized route and failed read-only; no files were changed by it.

Review caught a block/reaction race: reactions now use the same pair transaction lock as sending and blocking. Added a failure-isolated startup warmup for the additive block table, with writes still failing closed if its schema is unavailable. Rate limiting returns HTTP 429 rather than an access-denied status.

## Fabrications found

None found so far; the ambiguous presence label describes an authoritative connected-student count, not invented attendance.

## Deliberately not changed

Financial policy, provider configuration, accepted LiveKit publishing permissions and unrelated root worktree files.

## Remaining risks / next pickup point

Implement and verify changes at phone, keyboard-reduced and laptop viewport sizes, including 50 students / 10 raised hands. Record exact release status before handoff.
