# Prelaunch batch test pilot (11 Sep2026)

Owner clarified there are no established paying users: this is private prelaunch testing.
Do not repeat earlier memory claims that the site is taking real payments as a verified fact.
Keep financial/security boundaries anyway; a public URL is not a license to invent paid receipts.

Booking preview deployed at 8b704a6; stage deadline Jan 10, 2027 UTC configured. Actual teacher
screen confirms expired/inactive grant; awaiting operator sign-in to extend both synthetic test
accounts. Separate video isolation 388ad4e passed CI but is NOT deployed or enabled; awaiting
Daily dashboard access/allowance check and credential authorization. See both Sep 11 worklogs.

`codex/batch-test-booking` adds explicit batch test contracts/bookings/session mappings.
Follow the worklog for current commit/deployment status. Fixed TEST_ACCESS_UNTIL + both test
switches + approved/verified teacher and onboarded verified student grants are required.
Operators may grant through the configured date; it is not rolling120days on every request.

No test payment credentials, references, paid rows, refunds, commission or earnings. Freeze the
published offer and future subset. Atomic idempotent capacity checks; session access reuses
membership.ts, never a public room. First booking locks batch AND parent program (including old
editors); use copy for another test during this conservative pilot. Old Monthly learning remains.

Preview currently echo, not real video. Never call echo proof a genuine teacher/student call.
Before attaching shared Daily credentials, isolate staging rooms from production: both databases
can have session1 and default providers derive the same room name. Check costs, no purchases.

Legacy browser test requests must send X-Fadko-Platform:web. Otherwise Daily compatibility fallback
is intentional, not evidence the configured echo provider was changed by test booking.
