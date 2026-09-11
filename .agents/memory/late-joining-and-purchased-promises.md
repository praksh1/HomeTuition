# Optional late joining and clear lesson pricing

Owner approved 11 September 2026, after the simplified class setup.

- Ongoing tuition may explicitly allow late joining; fixed courses remain closed after start.
  Existing listings default off. This supersedes the blanket no-proration rule in the earlier
  tuition-period decision. Readiness checks for sequential courses are not implemented.
- Students buy only future, not-yet-started lessons and pay upfront before gaining access.
  Joining never resets the shared period or promises past recordings/private catch-up teaching.
- Price = original full tuition × remaining lesson count / original lesson count, rounded ONCE
  to nearest whole NPR (half up), consistent with the current whole-NPR ledger. Example: 5000,
  18 original, 11 remaining = 3056. Do not sum rounded original lesson allocations for this quote.
- Published offers show exact lesson count, durations, timetable, total and approximate average
  per lesson. Average is explanatory, not a pay-per-lesson checkout option.
- Publication names actual count and price; one-lesson ongoing tuition gets a specific warning.
- First confirmed purchase must lock that group's commercial promise. Schedule changes require
  a separately audited rescheduling/remedy workflow; materials and announcements may still be
  added. These paid-Batch protections are RELEASE BLOCKERS, not already-built checkout.

Implementation boundary: this change only persists per-batch draft joining policy, freezes it in
published snapshots and serves time-stamped preview estimates. No joining, seat reservation,
real receipt, student access or payout is enabled. Capacity must be rechecked atomically at future
purchase time; price/lesson subset/version must be recomputed from server time and frozen with the
confirmed purchase, including races with lesson start. Allocate the ACTUAL late payment using the
approved 70/30 model across the purchased subset; do not alter existing buyers' allocations.

Existing Monthly, Single Class, video providers, membership and payment gates remain unchanged.
