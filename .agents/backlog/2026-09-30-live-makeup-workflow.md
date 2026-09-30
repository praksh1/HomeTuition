# Live make-up workflow — activation gate

The approved policy foundation in `6854935` is not an active workflow. Do not expose a working-looking Request make-up action or claim money is held until the actual ledger/booking paths implement it.

## Approved launch policy

- Two teacher-approved courtesy make-ups per paid 30-day tuition period; no rollover.
- Short courses: ceil(purchased lessons / 10), maximum three. One-lesson courses have no courtesy allowance.
- Teacher non-delivery does not consume student courtesy allowance or remove refund review.
- Pending requests reserve the allowance. Rejected, withdrawn or expired unaccepted requests release it; accepted replacements retain their slot even if missed. One accepted replacement per original purchased lesson.
- Offer expires after seven days or its lesson start, whichever comes first. Replacement must finish within 30 days of the original lesson's end.
- No second charge, earning or tuition-period extension. Original payment allocation remains linked and held; confirmed delivery gives a fresh 48-hour review window. Refund/forfeiture decisions remain human-reviewed, never AI automatic.

## Required implementation sequence

1. Create the additive remedy tables safely and use a disposable PostgreSQL test database, never production or shared Preview as a destructive fixture.
2. Student request/withdrawal and teacher offer/decision routes lock the same original booking/payment row as refunds; enforce quota, purchased lesson identity, closure and dispute constraints transactionally.
3. Acceptance creates linked zero-price replacement with overlap/capacity checks and durable idempotency. Do not place it in the original `batch_test_sessions` lesson-position mapping.
4. Settlement (`synchronizeBatchTestSettlements`) must load actual remedy holds and replacement delivery. Neither a Completed label nor any teacher connection alone confirms full delivery. A refused/expired remedy is not a delivered lesson or automatic refund.
5. Exclude replacement lessons from public paid bookings and route legacy refunds to the original allocation, not a fabricated zero-price refund. Receipts/operator review show original lesson, replacement, student and amount exactly once.
6. Class home, history and support show real Requested/Assigned/Joined/Delivered/Needs review states and explain max allowance; pending request two disables further courtesy requests. Preserve alternative refund review and separately scoped safety support.
7. Update attendance reconciliation, participant access, teacher/student schedule, notifications, materials, disputes and account-closure commitments. Replacement after a period ends must remain accessible without a renewal purchase.
8. Verify concurrent duplicate acceptance, request quota race, refund-vs-acceptance, schedule/capacity conflicts, missing/failed evidence, expired offers, missed replacements, renewal isolation and held-versus-paid receipt totals in PostgreSQL plus real browser journeys.

No new product-policy approval is pending. Production promotion waits for these checks and owner review; no automatic refund/ban or purchase is authorized.
