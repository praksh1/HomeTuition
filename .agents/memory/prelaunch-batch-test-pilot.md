# Prelaunch batch test pilot (11 Sep2026)

Owner clarified there are no established paying users: this is private prelaunch testing.
Latest clarification: the trial must use a pretend checkout, not simply free enrollment.
`codex/batch-simulated-checkout` adds separate immutable TEST captures and frozen70/30 lesson
allocations, never real paid enrollments or earnings. See Sep11 simulated-class-checkout worklog
for exact deployment state. Refund simulation remains future; do not backfill old free bookings.
Do not repeat earlier memory claims that the site is taking real payments as a verified fact.
Keep financial/security boundaries anyway; a public URL is not a license to invent paid receipts.

Checkout preview now deployed at6da5489; stage deadline Jan10,2027UTC configured. Teacher user1
grant renewed to that date; student user2 still active through17Sep2026 (renewal cancelled, verified).
Owner approved credential attachment after testing checkout. Staging configuration now deployed
at88a6d07b-2a78-42cc-a124-afd972ebd84b: VIDEO_PROVIDER=daily,
VIDEO_ROOM_NAMESPACE=fadko-preview, DAILY_API_KEY referenced from shared Railway storage.
No production change or key disclosure. Owner screenshots showed42/10000minutes used,
estimated$0; this is not a hard cap. Real room/token/media verification still pending owner call.
See Sep11 simulated-class-checkout worklog for CI/deployment/actual operator browser verification.

`codex/batch-test-booking` adds explicit batch test contracts/bookings/session mappings.
Follow the worklog for current commit/deployment status. Fixed TEST_ACCESS_UNTIL + both test
switches + approved/verified teacher and onboarded verified student grants are required.
Operators may grant through the configured date; it is not rolling120days on every request.

The original no-charge bridge had no payment records. New simulated checkout stores separate TEST
capture references and70/30 allocations; never real paid rows, refunds or earnings. Freeze the
published offer and future subset. Atomic idempotent capacity checks; session access reuses
membership.ts, never a public room. First booking locks batch AND parent program (including old
editors); use copy for another test during this conservative pilot. Old Monthly learning remains.

Preview currently echo, not real video. Never call echo proof a genuine teacher/student call.
Before attaching shared Daily credentials, isolate staging rooms from production: both databases
can have session1 and default providers derive the same room name. Check costs, no purchases.

Legacy browser test requests must send X-Fadko-Platform:web. Otherwise Daily compatibility fallback
is intentional, not evidence the configured echo provider was changed by test booking.
