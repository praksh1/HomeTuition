# October launch readiness

Owner target: real-user testing in Nepal by the end of October 2026.
This is a release checklist, not a statement that Fadko is ready or that store approval is guaranteed.

## Immediate regression release

Completed September 30 on Production 3934050e and Preview a30e7b99: isolated typing/draft
work, bounded read recovery, request-first make-up inbox, separate operator Worker exports,
and exact-source CI/export/live readiness checks. This does not complete automatic
settlement, owner operator provisioning, physical-phone validation or native release.

- Reproduce typing with realistic message history, image/PDF attachments and real draft persistence.
- Keep typing state out of the timeline. Coalesce draft writes; clearing after Send must win over older writes.
- Recover transient read failures within one deadline. Never automatically replay payment or other mutations.
- Keep make-up requests separate from the lesson schedule. Do not label future lessons as teacher-missed.
- Publish the operator desk from its own route tree and Worker; verify it targets the correct API.
- Verify 320/390-pixel phones and wide desktop, actual exports, routes, permissions and token recovery.

## Approved remedy rules

Owner approved these deadlines and safeguards on September 30. New financial terms must be
frozen at purchase and accepted before an absence penalty applies. Existing purchases retain their terms.

| Situation | Student outcome | Teacher outcome | Fadko outcome |
| --- | --- | --- | --- |
| Verified original teacher non-delivery | Hold the original allocation; arrange a replacement or full affected-lesson refund | No payout for undelivered teaching | No fee on the refunded allocation |
| Teacher fails to arrange an eligible requested replacement within 48 hours | Full affected-lesson refund entitlement | No payout | No retained fee |
| Teacher misses a replacement, or student misses a replacement of teacher non-delivery | Full affected-lesson refund entitlement | No payout | No retained fee |
| Student misses an accepted courtesy replacement and previously accepted the warning | 70% affected-lesson refund entitlement | No payout | 30% of that allocation retained |
| Replacement delivered with reliable evidence | Fresh 48-hour dispute window | Eligible only after holds clear and the published payout cycle | Purchased fee breakdown applies |
| Conflicting evidence, outage, interrupted observation or overlapping dispute | Hold; send only the exception for review | No premature payout | No inferred absence penalty |

Offered dates expire after 7 days; replacements must finish within 30 days. The courtesy
allowance remains two per paid 30-day tuition period; short courses receive one per ten
purchased lessons, rounded up, at most three. One-lesson courses have no courtesy allowance.
No rollover. Confirmed teacher non-delivery does not consume it.

The automated outcome is tied to booking, original lesson position, original allocation,
student, accepted offer and immutable policy version. A second replacement is not a new
purchase. Full and partial refund amounts must balance exactly, including rounding in the
student's favour. Repeated jobs or taps cannot create a second financial action.

## Money activation gates

The current class test-payment records collect zero actual funds. A refund entitlement,
refund intent and confirmed provider transfer are different states. None may be displayed
as a completed real refund without provider confirmation.

Required before automatic settlement:

1. Freeze the approved policy and disclosure at checkout; store explicit acceptance.
2. Record reliable delivery/non-delivery evidence and observation health. Missing telemetry
   rows alone do not prove absence. A reported issue is not a verified failure.
3. Persist idempotent original-allocation actions under the same lock as payout selection,
   dispute decisions and refund requests. Holds must exclude that allocation from payout.
4. Reconcile full and partial provider refunds, failures, retries and reversals with receipts.
   Keep simulated records clearly separate. Never duplicate an already-issued refund.
5. Show the student and teacher one readable timeline: original payment, affected lesson,
   replacement, hold reason/deadline, refund status, fee breakdown and payout status.
6. Audit the licensed payment-provider agreement, fees, tax treatment, actual bank settlement
   timing and app-store purchase rules before enabling real collection. Do not call the
   internal ledger escrow or a wallet.

## Native app release gates

Production's native client still uses the older Daily integration; the current LiveKit
native component is a placeholder. A successful Safari call is not proof of native readiness.
Replace the native video stack using the [official LiveKit React Native integration](https://docs.livekit.io/transport/sdk-platforms/react-native/)
without retaining conflicting native WebRTC forks. Verify real teacher/student devices,
permission denial, phone sleep, reconnect, headphones, camera/mic synchronization, board
materials, rotations, call resizing and safe exit.

Apple distinguishes live one-to-one tutoring from group live services; group services have
different purchase requirements under [App Review Guidelines 3.1.3(d)](https://developer.apple.com/app-store/review/guidelines/).
Check the actual Nepal storefront and payment design before treating the web gateway as an
App Store-compatible group-class checkout. Also review the [Google Play payments policy](https://support.google.com/googleplay/android-developer/answer/9858738).
This is a product-release constraint, not a legal opinion or a promise of store acceptance.

Keep phone browser access working until published store links and verified native readiness
exist. Then introduce an explicit app-first rollout with a rollback switch, deep links,
authentication/payment/email callback exceptions and emergency access. Desktop browser
must remain fully usable. User-agent detection is a navigation aid, not authorization.

## Independent first-time user audit

Use clearly labelled synthetic accounts and no-charge transactions. Test both roles from
registration and verification through discovery/class creation, enrollment, materials,
live teaching, attendance, dispute, replacement, refund and teacher payment projections.
Repeat with low-bandwidth and failed requests. Record real failure causes and screenshots;
do not turn fixture-only passes into a claim of real-money or physical-phone verification.

For teachers, default to the next class and next action. Keep active classes ahead of drafts
and history. For students, lead with enrolled classes; do not show sales/joining prompts for
already-enrolled classes. Use one main action per screen, clear money/deadline labels,
consistent sentence case and mandatory touch-target/overflow checks.

## Operator workload

The desk should show action-needed exceptions, not every scheduled lesson. Automatic cases
need a decision log, deadline, original-allocation trail and outcome reason. Teacher identity
approval, ambiguous delivery, safety reports and provider reconciliation remain deliberate
operator responsibilities. AI can prepare context; it cannot ban users or issue refunds.

## Concrete follow-up findings from September 30 source audit

- CLOSED for this regression release: Student Classes validates all owned-session pages
  before replacing its list. More than 100 dates, complete grouping, stale responses and
  later-page failure were covered by focused tests and exact-source CI. A scalable
  authenticated class-summary endpoint remains a later improvement: complete 15-second
  refreshes can still become costly at large enrollment counts.
- Teacher Schedule also displays only its first 100 dates per selected status. Add a
  clear Load more or cursor-based schedule view, retaining nearest-first Upcoming order.
  This is still open and must not be described as repaired by the student pagination fix.
- Lesson details put Start/Join below the entire roster and message history. With a large
  class this primary action becomes hard to find. Promote it into a persistent accessible
  action area without auto-joining the call or covering messages on narrow screens.
- CLOSED in Teacher Home: retired access-limit fetches/upgrade affordances removed,
  earnings-history action works, total upcoming count and Nepal-local calendar/clock
  labels fixed. Before-first-booking earnings education explains 48-hour review,
  dispute/make-up holds and eligibility versus an actual bank transfer.
- OPEN copy follow-up: inspect remaining generic earnings-release wording and the older
  Contact Support make-up wording in money summaries against the direct request workflow.
- OPEN scale check: the existing 500-lesson make-up list cap may omit older cases.
  Audit and implement a case-centric paginated inbox before claiming full-time teacher scale.
- OPEN owner operator setup: Production's configured owner has no issued operator account;
  Preview has no configured owner ID. Preserve existing login and Cost & Health ownership.
  The published separate portal and fixture sign-in tests do not prove owner sign-in works.
- Railway's CLI warned about existing config-as-code support changing by December 1, 2026.
  Verify current primary documentation and plan the migration separately; it was not changed
  during this reliability release.

## Explicit continuation

Same-chat heartbeat fadko-teacher-schedule-follow-up is ACTIVE hourly for local Preview
teacher Schedule pagination and accessible Start/Join tests only. No deployment, push,
owner-access, schema or financial mutation is allowed in that scheduled scope. Keep the
computer on and the Codex app running for local follow-ups. Broad unattended Production
and money changes were rejected by auto-review; do not bypass that restriction.
