# Prelaunch class booking and call pilot

- Date: 2026-09-11
- Agent: Codex
- Branch: codex/program-batch-foundation
- Base commit: 94719a7
- Status: in progress — isolated on `codex/batch-test-booking`; not deployed or activated

## Requested

Explain/remove confusing migration-style teacher panel. Continue commission work and allow the
owner to test student booking and real calls without real payments for roughly3–4months.

## Decisions and assumptions

This is prelaunch testing, not an established paying customer migration. Preserve existing data
without presenting an established-customer migration panel. Keep older tools collapsed.
Reuse explicit teacher/student test grants and kill switches. No globally free checkout, no
payment-key removal, no production NODE_ENV=test, no fabricated receipt or earned money.
New batch bookings must freeze exact offer/lesson subset, respect capacity and student schedule,
and map to real sessions atomically. A test seat never becomes a paid seat implicitly.
Pilot activation stays preview-first. Real media can consume the existing provider allowance;
no purchases or paid recording authorized. Provider access must be checked before promising calls.

## Changed

Teacher page: migration panel becomes collapsed Earlier test tools.

## Verification

Pending.

## Problems and surprises

New class listings currently have no batch booking/session bridge. Existing single-lesson test
access is real, but cannot be presented as if it already enrolled a whole new batch.

## Fabrications found

Migration copy implied established paying users; owner confirmed this is private prelaunch testing.

## Deliberately not changed

Real charges, provider choice, existing Monthly homework/chat, paid contracts.

## Remaining risks / next pickup point

Build and verify batch-specific test booking before enabling it. Exact end-to-end checks must
include no-grant refusals, retries/races, immutable booked terms, late joining, individual room/socket
access, kill switch/expiry, and test money excluded from earnings/refunds.
