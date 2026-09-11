# Create a class, not a hierarchy

Owner decision, 11 September 2026: the Program → Batch → Period teacher journey is too confusing.
The default teacher entry must be **Create a class**, then what / when / size and price / review.
Regular tuition uses existing shared 30-day periods; short courses use the existing fixed offer;
one lesson links to the unchanged single-session setup. A formal learning path is optional, not
a prerequisite to ordinary neighbourhood tuition, language teaching or practical skills.

Implementation preview: `codex/program-batch-foundation`, worklog
`2026-09-11-codex-simple-class-setup.md`. `/teaching-classes` is the owner list;
`/create-class` and `/teaching-class/:id` are the guided screens. Existing `/programs` and
`/program-batches` remain accessible for earlier work. Do not delete or migrate existing data.

Underneath, preserve the Program/Batch/period contracts. New aggregate endpoints transact the
description and timetable together. `teaching_class_setups` is an additive link/idempotency table,
not an entitlement or payment record. Explicit `presentation: "class"` snapshots permit an empty
formal path without relaxing legacy formal snapshots. No fictional outcomes/modules are inserted.

No signup, operator approval, payment split, refund, Daily/LiveKit or existing Monthly rules change.
New listings still do NOT collect payment, enrol students or create live sessions. Show that clearly.
Only preview is authorised for this implementation; request physical review before production.
