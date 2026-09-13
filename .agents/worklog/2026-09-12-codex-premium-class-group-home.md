# Premium class-group home

Status: deployed to preview; awaiting owner review
Branch: `codex/premium-class-group-home`

## Goal

Give each newly published, test-booked class one premium home with Next lesson, Homework, Class messages, Materials and Help. Preserve the older Monthly portal without pretending a batch id is a recurring-class id.

## Architecture boundary

- New class groups use new additive tables and a single access function.
- Existing Monthly homework and chat tables/routes remain unchanged.
- Teacher access comes from ownership of the Program behind the batch.
- Student pilot access comes from that student's own `batch_test_bookings` row.
- Future real purchases can be added as another entitlement source in the same access function.
- No real payment, payout, refund, gateway, Daily or LiveKit behavior changes here.

## Work performed

- Added four new class-group tables for messages, homework, text-first submissions and materials. The boot guard only uses `CREATE TABLE/INDEX IF NOT EXISTS`; no existing table or column changes.
- Added `classGroupAccess()` as the single entitlement boundary. The teacher must own the Program behind the batch; a pilot student must hold their own test-booking row.
- Added one shared class home for teacher and student: a prominent next lesson, Class messages, Homework, Materials and Help.
- Added persistent class messages, teacher-set homework, student text-first hand-in, and teacher-curated notes/HTTP(S) links.
- Late students read conversation only from their booking time. Older pinned notices may be returned separately; ordinary older conversation is not exposed.
- Added **Open class home** to the confirmed test-booking card. Next lesson now chooses the next future lesson rather than blindly choosing lesson one.
- Recorded the owner's separate Profile/contact/location/refund decision in memory and a dedicated backlog file.

## Verification

- Repository-wide typecheck: pass across libraries, API, app, scripts and mockup.
- API unit tests: 547 passed, 0 failed (includes 3 new class-group contract checks).
- App unit tests: 393 passed, 0 failed (includes 3 new class-home checks).
- Design lint: no new leaks; baseline remains 94 hex / 282 sizes.
- `git diff --check`: clean.
- Extended `test:batch-booking` by 12 real-API/real-Postgres checks covering teacher/student/outsider access, messages, homework, submissions and materials. This requires the disposable CI database and has not run locally.
- GitHub disposable-database safety workflow `34717496079`: pass, including all-workspace typecheck, 547 API units, 393 app units, schema push, API build, Program suite, extended batch-booking suite, video/proof/access suites, browser checks and cleanup.
- Staging API branch safely fast-forwarded to `1b15a7c`; the additive boot guard deployed without touching existing tables.
- Preview workflow `34717691076`: pass. It verified rendered Program/profile/class-planning surfaces, bundle isolation, exact staging API target and the deployed Cloudflare Worker.
- Live verification after deployment: preview HTTP 200; unauthenticated staging `GET /api/class-groups/1` returns 401, proving the protected route is present rather than missing.

## What went wrong / remains unverified

- The first local typecheck ran inside the restricted filesystem and could not traverse package junctions, producing false missing-dependency errors. Re-running the same repository typecheck with dependency read access passed.
- Local static export reached Expo configuration but Windows denied a read of the already-installed Apple-auth config plugin. No app-source error was reported; the preview workflow remains the authoritative clean export.
- The new flow has not yet been rendered in the deployed preview or touched on a real phone.
- File attachments and teacher feedback/marking are deliberately not copied yet. The first slice is persistent and useful, but text-first. Existing Monthly file homework/chat remain unchanged.
- Real-purchase entitlement does not exist yet. When it does, it must be added inside `classGroupAccess()` rather than copied across routes.
