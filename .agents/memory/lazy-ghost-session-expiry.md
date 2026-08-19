---
name: Lazy ghost-session expiry
description: Seed/bot "live" sessions never flip to completed on their own; expire them lazily on read — but measure staleness from when the class actually started, never from its scheduled slot.
---

Seeded or test-generated sessions can be inserted with `status: "live"` but there is no teacher action that ever ends them (no real class was taught). If the UI only trusts the stored `status` column, these become permanent "ghost" live sessions cluttering Live Now feeds.

**Why:** discovered while removing bot-generated live sessions from the student teacher-profile screen — the sessions had a `date` far in the past but `status` still `"live"`.

**How to apply:** on any endpoint that filters `status = "live"`, compute an end-of-session timestamp for rows currently marked live and bulk-update any that have already passed to `"completed"` before returning results. This avoids needing a cron job/worker and keeps the fix contained to the read path.

**Measure from `startedAt`, not from `date`.** This is the part that matters and it is not
obvious. `date` is the slot the class was *booked into*; `startedAt` is when the teacher
actually pressed start. Judging staleness from the scheduled slot means a teacher who begins
late is running a class the sweeper already considers expired — and because the sweep runs on
*read*, the student's own act of opening their Sessions tab ended their teacher's live class
underneath them. The class vanished mid-lesson and the cause looked like anything but a student
loading a list.

The live code (`routes/sessions.ts`) reads `const begunAt = s.startedAt ?? s.date`, falling back
to the scheduled date only for rows written before that column existed. Keep that fallback
ordering; reversing it reintroduces the bug.

A read path with a write in it is worth treating carefully in general: anything it touches can
be changed by a user who was only looking.
