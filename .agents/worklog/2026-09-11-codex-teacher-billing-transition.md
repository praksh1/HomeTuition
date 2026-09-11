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
rows and existing allowance reads: PASS in preview workflow34650571223 at44e3af0, API601/0.
Discover182, legacy planner123, simple setup75, billing26; Worker85f10411-7900-479c-b350-546892fa9bf2.
Final dashboard wording7ee8800 in preview workflow34651201862: SUCCESS; Worker
0dbac4b1-bc9a-4188-ac03-8b11bd99c173. Exact served HTML and three bundles verified after CDN
propagation (first attempt stale, retry passed). Railway staging status success; both staging
and production health endpoints returned status ok. No real phone test of this new page yet.

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

Second production run34650408869 reached148 refund passes but4 failures: my fixture allocator
shifted a20-hour student-drop fixture beyond its24-hour cutoff. Gave that case a dedicated teacher
and added a strict24-hour fixture guard (bcb4796 on isolated codex/release-validation worktree at
%TEMP%/fadko-production-release-fix; cherry-picked into preview as9d00431). Current production
run34650955160 passed refunds, then failed video-tests: its second session started one hour
ahead, overlapping the first session (one minute ahead, lasting an hour). Creation was refused
and the suite interpolated undefined into its timestamp setup SQL. Test-only9d02a87 moves the
setup to two hours ahead and asserts creation before SQL; the actual expired-session timing
assertion still runs against three days ago. Main run34651777283 is pending for that correction;
cherry-picked into preview as a5676d5. That run passed video and stopped on session-tests' two
identically booked live-recovery fixtures. Test-only74a3ab0 uses consecutive booked slots while
the earlier call remains connected; missing-activity-table case starts the already-created second
class instead of double-booking a third. No recovery assertions removed. Cherry-picked f489bb4.
Then inspected downstream browser fixtures rather than waiting for each duplicate failure:
7503a13 (preview cherry-pick19c87fb) separates filter fixtures across days at10:00 Nepal time,
away from their17:00 Monthly class, separates dashboard setup before ageing its old row, closes
the finished rejoin browser/call, and gives the independent late-call scenario its own teacher.
Added creation/start failure checks. Main workflow34652719052 now running at7503a13.
Never push preview HEAD to main: it now includes billing changes
which have NOT been approved for production. Keep release fixture fixes on the isolated worktree.

## Fabrications found

New listings have no paid enrollment or live session mapping yet. A test Program ledger is not
a paid batch. Do not report that the first paying student currently unlocks these classrooms.

## Deliberately not changed

Existing plan rows, paid student terms, ordinaryTeachingAccess, membership, Monthly portal,
homework/submissions/feedback, chat storage, Daily/LiveKit and refund calculations.

## Remaining risks / next pickup point

Sale refusals verified through real API and rendered new page; preview only for new billing work.
Final preview-only copy follow-up: existing Monthly link says Open monthly class, and legacy
single-class refusal links to View teaching access, not a promise of purchasable plan options.
App typecheck/design passed. Tried nonexistent test:session-create package script (no script ran);
corrected to the actual scripts/session-create-tests/run.mjs, requiring a fresh localhost bundle.
Local Metro build failed before the entry module because this Windows dependency layout could
not resolve @babel/traverse from react-native-worklets. No dependency/lockfile changed and the
render suite did not run. Fresh CI installs/builds have passed; use the final preview CI build
for deployment. Do not claim the changed legacy link label was separately browser-tested here.
Finish production workflow34652719052 and verify exact served build. Owner reviews Teaching &
earnings at preview /subscription before the billing transition is released to production.
Build batch-specific purchases/allocations and session mapping before new classroom access.
Preserve group homework/chat with their own enrollment-scoped authorization; never use a
teacher subscription purchase as the gate for students' purchased learning records.
