# Teacher billing transition and approved production release

- Date: 2026-09-11
- Agent: Codex
- Branch: codex/program-batch-foundation
- Base commit: 357c222
- Status: in progress

## Requested

Release approved class-planning work. Start retiring teacher tier purchases in favor of the
approved commission model, preserving old source and existing Monthly homework/chat.

## Changed

Production push restricted to approved 357c222. Separate working changes: central legacy-sale
policy; server refusal before either legacy teacher-plan charge; Teaching & earnings page;
old storefront preserved under components/legacy and restoration map under .agents/archive.
Monthly management continues; only the no-plan sales screen changes when sales are paused.

## Decisions and assumptions

70/30 and no extra student fee are existing approved beta rules. This does not migrate existing
purchases, create live lessons, or enable any real batch payment. Sales default paused outside
isolated tests; explicit LEGACY_TEACHER_PLAN_SALES=enabled restores legacy sales, paused overrides
test defaults. Do not confuse this with student collection or classroom entitlement.

## Verification

Local full typecheck passed; API units525/0; app units373/0; teaching-billing rendered26/0
at390/1440; design baseline94/282 unchanged. Phone screenshot inspected. New real API gate
checks paused tier/monthly sales against a gateway-configured isolated server, unchanged plan
rows and existing allowance reads; awaiting CI.

## Problems and surprises

Production push initially refused because auto-review treated prior acceptance as preview-only.
Asked exact release approval; owner explicitly approved 357c222; then pushed that SHA to main.
No bypass. First archive patch attempted delete/add same target and was rejected atomically;
replaced with an update. Initial UI typecheck found readingWidth is a constant, not a hook field;
corrected import.

Production workflow34649308410 stopped before frontend deployment: refund fixture created two
same-teacher classes at the same instant. Backend357c222 deployed successfully. Corrected fixture
scheduling (d93a63d, then0b9969a) including the same pattern in round/alert/browser-refund suites;
kept monetary assertions and concurrent moves intact, created their setup classes sequentially.
Near-start timing test now uses separate teachers, preserving its one-minute boundary.
Those TEST-ONLY commits went to main separately; billing implementation has not gone to main.

## Fabrications found

New listings have no paid enrollment or live session mapping yet. A test Program ledger is not
a paid batch. Do not report that the first paying student currently unlocks these classrooms.

## Deliberately not changed

Existing plan rows, paid student terms, ordinaryTeachingAccess, membership, Monthly portal,
homework/submissions/feedback, chat storage, Daily/LiveKit and refund calculations.

## Remaining risks / next pickup point

Validate sale refusals through real API and rendered new page; preview only for new billing work.
Build batch-specific purchases/allocations and session mapping before new classroom access.
Preserve group homework/chat with their own enrollment-scoped authorization; never use a
teacher subscription purchase as the gate for students' purchased learning records.
