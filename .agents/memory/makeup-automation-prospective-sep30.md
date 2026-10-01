# Prospective make-up automation safeguards

Owner approval: September 30, 2026. This supersedes older proposal-only notes for new
make-up financial terms, not existing purchases or legacy Monthly contracts.

- Teacher response: 48 hours. Offered dates expire after 7 days or before the lesson starts.
- Replacement must finish within 30 days of the original scheduled lesson end.
- Verified teacher non-delivery, failure to arrange an eligible requested replacement,
  teacher absence at the replacement, or student absence at a teacher-fault replacement:
  full affected-lesson refund entitlement; no teacher payout and no retained platform fee.
- Student absence at an accepted courtesy replacement: 70% student refund, 30% retained
  by Fadko, no teacher payout, only after explicit prior warning and prospective terms.
  Integer rounding must favour the student and balance to the original allocation.
- Reliable replacement delivery starts a fresh 48-hour dispute window before eligibility.
- Outages, incomplete observation, contradictory evidence and unresolved disputes remain
  held for human review. Zero attendance rows do not prove absence.
- Keep the approved quota: 2 per paid 30-day tuition period; short courses 1 per 10
  purchased lessons rounded up, maximum 3; single lessons excluded; no rollover;
  verified teacher failure does not consume the courtesy quota.

The rule engine must be deterministic, not an AI refund/ban agent. Freeze policy at
purchase and bind acceptance to the exact original payment, lesson, student and offer.
Idempotent jobs share locks with payout, dispute and refund selection. Existing purchases
retain their frozen rules; do not apply this new absence penalty retroactively.

Implementation status is recorded in the September 30 reliability worklog. The new v2
engine and durable adapter are shadow-only, not connected to checkout, scheduled execution
or real provider refunds. Current practice bookings collect zero real funds. A refund
intent is not a completed bank transfer, and a test pass is not live payment verification.
