# Teacher pricing and settlement redesign — discussion draft

Status: proposal only. No live billing, refund, allowance or settlement behavior changed.
Owner is considering replacing existing tiers with 45 classes per month (90 minutes maximum,
multiple per day) and pay-per-class, potentially prepaid or funded from earnings at a 70/30 split.

## Recommended product structure

Present two choices: Flexible (no subscription; proposed 30% of net eligible student tuition) and
Monthly (prepaid fixed fee for up to 45 classes in an explicit 30-day billing cycle). Do not launch
a two-by-two prepaid/postpaid matrix. A fixed per-class prepaid credit could be introduced later,
but adding it now produces a third fee model. A 30% commission is revenue sharing, not merely
delayed payment of a fixed subscription price. Do not charge both without explicit disclosure.

Prices remain undecided pending participant capacity, video cost, provider charges, taxes and
refund-cost modelling. Student tuition is set separately by the teacher. Students see single
classes or scheduled courses, never the teacher's platform billing plan.

Monthly includes scheduled teaching capacity, not a promise of 45 student course meetings.
Count actual scheduled occurrences (including recurring course dates) once; prohibit overlapping
classes; preserve existing purchased course terms during migration. Pick a capacity cap and
explicit overage terms before sale. Unused subscription slots can expire at the cycle end with
clear advance disclosure; do not silently auto-bill or convert to debt. Reserve capacity when
booking dates, restore qualifying canceled unused slots, and make platform-failure replacements
free. Teacher-failure repeat misuse needs a policy, not unlimited free replacement credits.

## Common settlement and refund protection for both plans

The teacher's prepaid platform fee does not remove protection for student tuition. Keep student
funds pending until the relevant class is delivered and its complaint window has closed, subject
to a licensed provider's supported marketplace arrangement. Do not call an internal DB ledger
escrow or assume an ordinary merchant account permits holding and distributing third-party funds.

Proposed ordinary complaint window: seven days after each scheduled class. Teacher response:
three days; initial decision: two days after response/deadline. Target undisputed release:
14 days after class end, then the next published weekly payout. Show each actual eligible date;
weekly batching can add up to six days. One appeal with explicit deadlines; disputed amounts stay
frozen until resolution even beyond day 14. Other students/classes remain payable unless there is
evidence of a wider account problem. Provider/legal chargeback rights may outlast this window.

Recommended allocation: valid refunds reverse student tuition before applying the percentage.
Example: NPR 10,000 collected less NPR 2,000 refunds = NPR 8,000 eligible tuition; proposed 70/30
split is NPR 5,600 teacher / NPR 2,400 platform, before separately specified tax/provider treatment.
Do not pay 70% of gross and fund a full refund only from the remaining 30%.

Teacher non-delivery: reverse affected unpaid teacher entitlement and corresponding platform
commission; restore prepaid capacity or offer replacement under the published terms. Platform
failure: platform funds its own nonrecoverable service/provider costs and restores teaching
capacity; refund undelivered tuition. Student absence from an otherwise delivered class is
ordinarily not refundable; disclose cancellation rules before booking. Mixed/uncertain network
failure receives evidence review and optional mutually accepted make-up, not automatic blame.
Mandatory rights override policy limits. No teacher debt/clawback or reserve should be introduced
without clear contract terms and lawful/provider-supported collection arrangements.

No automatic claim of teaching quality from board strokes, mic activity or connection duration.
Use attendance/reconnection/provider outage events to establish delivery facts; review actual
complaints with teacher response. No mandatory recordings of children as a default evidence tool.

## Recurring student courses and Nepal context

Keep teacher platform plan separate from student course. Offer a published set of class dates,
Nepal time, BS/Gregorian display and parent-facing receipts. Hypotheses to validate with teachers:
SEE/+2 revision cohorts, evening tuition, weekend doubt-solving, sibling attendance pricing and
parent reminders. Do not claim validated market demand.

For NEW course contracts, consider selling an explicit 25-class package over 30 days, with up to
five make-up opportunities for missed promised classes. Refund undelivered promised meetings
proportionally after the agreed deadline; recognize/release course tuition per delivered class,
not the whole package upfront. A make-up is the replacement of one owed meeting, not an extra
delivered entitlement. Current rules promise daily recurring meetings and use a 25-held floor;
do not silently rewrite existing purchases or treat five missing promised classes as free losses.
Moving from current binary refund rules to partial course refunds requires explicit approval.

## Costs and commercial positioning

Daily published rate at research time: first 10,000 participant-minutes per account per month free,
then graduated video rates starting at USD 0.004 per participant-minute. The free allowance is
shared across the platform, not per teacher. At that starting marginal rate, 45 x 90 minutes with
one teacher + ten students costs USD 178.20 before free allowance/volume discounts, payment fees,
support and taxes. Camera off does not justify assuming a participant is unbilled. No final NPR
plan price should be published until actual usage scenarios and provider agreement are modeled.

Suggested positioning: “Start teaching without a monthly commitment” and “Teach regularly with a
predictable monthly fee.” Commission is easier to justify when Sikshya supplies discovery,
booking, classroom and support. Existing private-tuition teachers bringing their own students may
prefer a fixed plan. Test these hypotheses; do not promise student acquisition.

## Implementation sequence after decisions

1. Agree capacity, monthly price, commission base, provider/tax treatment, cancellation and appeal
   deadlines, reserve policy and migration treatment. Confirm collection, delayed settlement,
   teacher payouts and refunds with the actual licensed payment partner.
2. Build a pure calculator and preview against examples, zero bookings, full/partial refunds,
   canceled classes, recurring occurrences, late disputes and negative balances.
3. Add versioned fee terms and a money ledger with idempotent payment/refund/payout events. Snapshot
   fee terms on each booking; never retroactively apply a teacher plan change. Distinguish collected,
   pending, disputed, refundable, payable and actually paid. Protect allocation/payout concurrency.
4. Build teacher payout statements and operator dispute workflows, then payment-provider sandbox
   reconciliation. Preserve booking atomicity and membership; do not make a payment UI a fake receipt.
5. Shadow calculations without money movement, small opt-in pilot, then explicit production release.

## Sources checked 2026-09-05

- https://www.daily.co/pricing/video-sdk/ — usage pricing; illustrative costs above.
- https://docs.khalti.com/api/refund/ — full/partial refunds; this is not proof of marketplace payout support.
- https://khalti.com/info/terms/merchant/ — merchant obligations; confirm applicable signed agreement.
- https://www.nrb.org.np/psd/payment-systems-oversight-report-2080-81-2023-2024/ — payment regulatory framework.
- https://lawcommission.gov.np/content/12167/12167-the-consumer-protection-act-2/ — consumer protection,
  including education services. A blanket no-liability clause is not a reliable substitute for
  Nepal-specific legal review. Exact classification of Sikshya's proposed arrangement is unresolved.

## Next pickup

Discuss the two-choice model with owner. No final prices or legal allocation have been approved.
Current code actually has base plus four tiers, alongside the recurring monthly product. Older
REFUNDS.md passages are historical specifications, not proof that live custody/payout exists.
Verify production/provider capabilities before making any claim that real student money is held.
