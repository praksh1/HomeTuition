# October launch readiness

Owner target: real-user testing in Nepal by the end of October 2026.
This is a release checklist, not a statement that Fadko is ready or that store approval is guaranteed.

## Immediate regression release

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
