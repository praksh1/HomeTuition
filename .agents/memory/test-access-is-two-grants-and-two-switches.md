# Free access for testing is two grants and two switches, never one

**Decided 4 Sep 2026, building the production-test release candidate.**

The owner has to walk the whole journey — find a class, book it, enter the real Daily classroom —
on the live site, while that site is taking real money from real students.

## What was rejected, and why it keeps looking tempting

Every one of these was considered and refused. They are written down because each is a one-line
change that makes the problem disappear, and someone under time pressure will think of them again:

| Shortcut | What it actually does |
|---|---|
| Remove the payment keys | `paymentMode()` infers the mode from configuration, so this puts the **whole public** into simulated mode — the free door for everyone. |
| A global "simulated payments" flag | Same, with an extra switch nobody will remember to turn back. |
| `NODE_ENV=test` in production | Also unlocks the simulated **teacher plan**, which `chargeForMonthly` refuses outside tests precisely because it grants the right to sell classes. |
| Hardcode the owner's email | Unauditable, un-revocable, and it survives every account change. |
| A client flag the server believes | A flag a client can send is a flag anybody can send. |

## What was built instead

Two operator-granted, expiring, auditable entitlements, and **two independent kill switches**:

- `test_teaching_grants` + `ALLOW_TEST_TEACHING_ACCESS` — lets an approved, verified teacher
  create classes without a plan. Already existed.
- `test_student_grants` + `ALLOW_TEST_STUDENT_ACCESS` — lets a verified, onboarded, unsuspended
  student **book a test class** without paying. Added here.
- `test_classes` — which classes were created under a teaching grant. Keyed by session id.

**A booking skips the gateway only when all three are true:** the switch is on, the student holds
a live grant, and the class is marked. So a granted student pays full price for an ordinary
teacher's class, and an ordinary student pays full price for a test class. Only the intersection
is free.

Two switches rather than one because they close different doors: teaching stops new test classes
being *created*, student stops test classes being *booked* — including ones already marked.

## The three rules that are easy to get wrong

**1. A class is test or it is not, and that is decided when it is created.** Asking at booking
time whether the teacher *currently* holds a grant is wrong in both directions: a grant that
lapses on Tuesday turns Monday's test classes into paid ones nobody paid for, and a grant issued
on Friday makes every class that teacher ever ran retroactively free. Neither is a decision
anybody made. `test_classes` is written once and never re-derived.

**2. The enrolment is `test`, never `paid`, and carries no reference.** Every query that counts
money asks for `payment_status = 'paid'` — earnings, refund debt, the drop route, the
schedule-change compensation, the invitable-students list. A distinct status is excluded from all
of them *by construction* rather than by remembering to add a condition in each place. A
`payment_reference` would be an invented receipt.

**3. Membership answers it once.** `lib/membership.ts` is where a test row becomes a real place,
and the kill switch is read there — so the room URL, the WebSocket and the student's own class
list open and close together. A second `payment_status = 'test'` check written into either door
is exactly the drift that once let an unenrolled student watch a teacher's video.

## Before launch

Turn **both** switches off. Every outstanding grant of either kind stops mattering the same
second, without anybody having to find them. Existing `test` enrolment rows are left exactly as
they are — closing a door is not a refund — and they simply stop opening anything.

## How it is proved

`api-server/scripts/test-student-access/run.mjs`, 61 checks, run with `PAYMENT_WEBHOOK_SECRET`
set — production's shape. On one server, one class: the ordinary student is refused **by the
gateway** and the granted one is enrolled. Nothing but "the gateway was never called" explains
that.
