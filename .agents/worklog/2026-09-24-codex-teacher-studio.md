# Production support promotion and teacher studio reliability

- Date: 2026-09-24
- Agent: codex
- Branch: codex/teacher-studio-sep24
- Base commit: d6aa2f2
- Status: in progress

## Requested

Promote completed support work; retain prior classroom TODOs; repair agenda ordering and simulated booking errors; simplify creation, timetable conflict resolution, and class management. Propose make-up policy; retain document-to-quiz roadmap.

## Changed

Approved support branch merged into production main at d6aa2f2. Prior classroom work preserved. Owner backlog recorded in `.agents/backlog/2026-09-24-teacher-studio-and-remedies.md` and persistent memory.

## Decisions and assumptions

No purchases or paid provider activation. Refunds/bans remain human decisions. Make-up policy is a proposal, not an authorization to change financial rules. Quiz remains a separate follow-up.

## Verification

Support focused tests: 23/23 locally before promotion. Full production gate 35970043187: compile, design, and server rules passed; app rules 561/562. See remediation below. Production web has NOT yet deployed this release.

## Problems and surprises

An obsolete source assertion still expected the assistant to be disabled as “Soon.” The support assistant is now implemented and tested; updated the assertion to require its actual route plus automated-assistant and human-refund-review disclosures. No production gate removed or bypassed.

Dashboard asks for latest 40 sessions before sorting locally; Sessions asks for latest 100. Closest lessons can be excluded by server pagination. Booking notification preparation can throw after enrollment commits, misleading the caller into believing the booking failed. Repairs in progress.

## Fabrications found

Class creation retains outdated joining/payment-unavailable copy despite working simulated checkout; will align copy with actual capability without suggesting real payments are enabled.

## Deliberately not changed

Classroom/LiveKit controls, payment provider configuration, autonomous financial actions, new make-up entitlements, and quiz publishing.

## Remaining risks / next pickup point

Complete production gate and confirm exact served build/API readiness. Add database and browser regressions before merging teacher workflow repairs. Production automatic API deployment is independent of the web gate; monitor both.
