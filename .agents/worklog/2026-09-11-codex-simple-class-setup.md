# One guided Create a class flow

- Date: 2026-09-11
- Agent: Codex
- Branch: codex/program-batch-foundation
- Base commit: bfaff64
- Status: in progress

## Requested

Owner found mandatory Program then Batch creation too confusing. Replace that teacher-facing
hierarchy with one simple class setup. Approval/signup explicitly unchanged. No purchases.

## Changed

- New teacher My classes, Create a class and named class editor. Four steps: description,
  timetable, capacity/full price, review. Formal outline optional, examples for actual descriptions.
- Regular tuition (shared 30 days), short course, and a link to the unchanged single-lesson form.
- Existing BS/AD calendar and native/web time pickers; repeat selected weekdays, exact lesson list;
  visible sticky actions, viewport-bound confirmations, browser/native leave guards, no-op publish.
- Dashboard entry and hidden route registration; older Programs, Monthly and Sessions retained.
- New aggregate GET/POST/PATCH/publish routes join existing editorial and offer contracts. Atomic
  creation and publication, retry keys, optimistic batch AND parent timestamps, schedule lock,
  agent approval/suspension checks, immutable student reads and shared-period bounds.
- New additive teaching_class_setups table (DDL + Drizzle + parity test). No existing column altered.
- Explicit lightweight snapshot type with no invented outcome, learner level or modules; old
  formal snapshot validation stays strict. Student detail skips absent formal-path sections.
- New pure tests, real-API/DB regression checks in test:programs, rendered test:class-setup added
  to preview CI. Owner list bounded to 20 entries with cursor pagination.

## Decisions and assumptions

- This is the default new-teacher flow, not destructive migration of existing programs or classes.
- Underlying Program/Batch separation stays because paid-offer snapshot and timing protections
  should not be removed merely to simplify the UI.
- A description revision is refused at publication when another set of dates is already published
  under that shared class; otherwise incrementing parent version could hide the other offer.
  Timetable/price-only changes remain possible. No automatic republishing of sibling offers.
- Existing signup and agent approval unchanged. No new commercial entitlement rule invented.
- One lesson still opens the established single-session booking flow; new group listings are not
  claimed to create live rooms or accept payment.

## Verification

- App and API typechecks passed after rebuilding shared library types.
- API unit 513/513; app unit 369/369.
- Rendered test:class-setup: 48/48 at 360×640, 390×844, 1440×900, Kathmandu and Chicago zones.
  Real component/calendar/history guard, synthetic transport and native router. NOT a deployed
  end-to-end proof. Screenshots in local temp fadko-simple-class-ksfz1e, visually inspected.
- Design ratchet unchanged: 94 hex / 282 raw font sizes. New files token-only.
- Full real-DB, regression gates and deployed staging walkthrough pending below.

### First deployment verification

- `5c99a8e`: feature commit, pushed. Preview run `34637548400` succeeded: full typecheck,
  real Postgres contracts/parity 572/0, attendance74/0, discovery160/0, legacy planner123,
  new class browser48, build/isolation/deploy all passed.
- `9e41cca`: stops older Program editor rewriting simple classes; adds regression assertions.
  Its redundant run `34638052972` was cancelled to combine the final calendar-label correction.
- Local legacy planner123/123 and Discover160/0; full root typecheck explicitly covered all four
  artifact packages, including fresh generated routes. New browser48/48 passed again after
  idempotent recovery and route-navigation changes.
- Final read found My classes range used viewer-local instants; changed it to Nepal wall-clock
  dates before BS/AD formatting, matching the editor even when a teacher is overseas.
- Browser automation's time-input fill sets DOM but not React state in this environment. Native
  ArrowUp/ArrowDown controls propagated 16:15 properly; this is the previously documented CUA
  limitation, not evidence that typing is broken. Headless Playwright fill works.
- Real staging create/save reached `/teaching-class/12`: explicitly named PREVIEW SEE Maths,
  no outline, 9 Tue/Thu lessons Sep15–Oct13 at16:15 Nepal, 6students, NPR3000 for shared30days.
  No real students or payments. Publication and final release verification still pending.

### Final usability pass and real staging proof

- Real staging class12 published successfully, repeated publication disabled. Public API search
  returns Program6 with explicit class presentation; its public offer is Batch12, 9lessons,
  capacity6, NPR3000, cutoff `2026-09-15T10:30:00Z` (16:15Nepal). No blank formal path shown.
- Prepare next30days reached class13 directly, retained the description/price/capacity, and required
  fresh dates within Oct15 16:15–Nov14 16:15 Nepal. Left that successor as a draft with no lessons.
- Real screenshot of My classes was inspected. AX includes an offscreen retained router screen,
  but screenshot confirms only the current screen is visible; no overlapping panes.
- That inspection showed duplicate same-name cards for successive30days. Corrected to one card per
  stable tuition group, each date set retains its own status and edit action. Different groups and
  fixed courses never merge just because names match. Pure grouping test preserves every item once.
- Added actual grouped-list rendering to the browser suite, including03:00Nepal boundaries in both
  Kathmandu and Chicago. New browser60/60; app370/370; typecheck and design ratchet unchanged.
- `ac75a62` preview run `34638470626` passed: API/DB574/0, attendance74/0, discovery160/0,
  legacyplanner123, simplebrowser48. Final grouped-list commit/deployment pending.

## Problems and surprises

- Initial JSX closure error and wrong reused calendar prop names: typecheck caught them, fixed.
- Stale built DB type declarations initially hid the new exported table; typecheck:libs resolved it.
- Snapshot reuse needs explicit lightweight discriminator; deleting formal required fields globally
  would weaken existing corruption checks. Kept separate contracts instead.
- Save must navigate to a durable class URL and rearm leave guards on that navigation. Browser
  test proves it. Idempotent lost-response recovery also preserves newer typed entries rather
  than replacing them with the recovered older draft.
- Screenshot caught published header still saying draft; corrected, no business-state change.

## Fabrications found

Prevented, not released: blank price rendered as NPR 0 in initial implementation; now says set full
price. Published header no longer calls it draft. No synthetic learning path or outcome inserted.

## Deliberately not changed

Production, purchases, payment processors, commissions, refunds, enrolment, room creation, Daily,
LiveKit, signup, operator approval, old Monthly rules, old saved programs/batches. No dependency
added, db:push, destructive migration or notifications sent. New aggregate publication does not
yet emit followed-teacher news; do not claim notification parity before wiring/testing that.

## Remaining risks / next pickup point

Complete CI, inspect real staging create/save/publish journey, record commit/deployment and fixture
IDs. Then owner physical review, not production. Native time picker/hardware Back need physical
Android/iPhone checks. Older programs remain on their earlier editor; migration is not this slice.
Future enrolment/live-class wiring must use batch/period snapshots and actual paid receipts; this
slice is simpler listing setup, not an operational paid-tuition launch.
