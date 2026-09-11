# Learning audiences and advance student payment

- Date: 2026-09-11
- Agent: Codex
- Branch: codex/program-batch-foundation
- Base commit: 21889bf
- Status: complete — product decision recorded; no implementation or deployment

## Requested

Discuss Fadko serving neighbourhood tuition, schoolteachers teaching after hours, language
consultancies, MBBS/Engineering/Lok Sewa exam preparation, IELTS/TOEFL, music, arts and drama.
Owner explicitly requires payment before teaching begins, not collection after delivery.

## Changed

Recorded audience scope and advance-payment decision in the existing indexed managed-marketplace
memory note. Proposed two student-facing formats: ongoing tuition with advance renewal and a
fixed-length course paid in advance. These are student offers, NOT teacher subscription tiers.

## Decisions and assumptions

Advance student payment is approved. Exact renewal period/calendar, joining mid-period, installment
support, organization staffing/ownership and payout policy are not newly decided. Existing 70/30
Flexible beta decisions are preserved, not renegotiated or silently applied to legacy products.

## Verification

Read existing managed-marketplace decisions and checked clean working tree before documentation.
No code tests needed or claimed for this documentation-only discussion.

Follow-up: owner asked for a recommendation against other Nepali app standards. Browsed first-party
MiDas eCLASS, mySecondTeacher and Khalti pages. Evidence supports multiple package formats, not a
verified uniform calendar anchor. Recorded sources and a pending recommendation in
`.agents/backlog/2026-09-11-teaching-period-recommendation.md`. No competitor price copied into Fadko;
no proposed 30-day period, proration, calendar policy or recurring debit treated as owner-approved.

## Problems and surprises

Current Batch planner fits a fixed scheduled run. It does not by itself implement ongoing group
renewals or consultancy team administration. Those are separate work, not promised shipped features.

## Fabrications found

None. Explicitly distinguish product recommendations from functionality already available.

## Deliberately not changed

No code, prices, contracts, payment activation, bookings, production data, deployment or purchase.

## Remaining risks / next pickup point

Agree the simple ongoing-versus-fixed student journey and renewal boundary before implementing
checkout. Preserve frozen purchased terms, teacher schedule protection and atomic booking.
