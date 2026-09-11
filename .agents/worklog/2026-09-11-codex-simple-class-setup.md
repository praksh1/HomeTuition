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
