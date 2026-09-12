# Commission transition preserves teaching and learning

Owner request 11 Sep 2026: retire visible teacher tier/monthly-plan purchases for the new
commission product, keep the source recoverable, and preserve/upgrade Monthly homework and chat.
Approved beta split remains teacher70/Fadko30, no separate student fee. Never double-charge old
subscription fees plus new commission. Existing purchases are not silently migrated/repriced.

New class listings currently have NO real checkout, enrollment, sessions or joining link.
The existing Program test ledger is not a batch purchase. The owner's belief that one paid student
already unlocks these new classrooms was checked and corrected, not adopted as an implementation claim.
Future activation may schedule a teacher's lesson after a first confirmed purchase, but EACH student
must independently pass the canonical membership check. One paying student never opens a public room.

Transition slice: pause new legacy plan sales on the server and hide the old picker; preserve old
classrooms/allowances and Monthly portal access. Storefront source lives in components/legacy;
restoration map .agents/archive/teacher-plans/README.md. A UI archive alone is not a sale gate.

Keep homework instructions, file access, submissions, marking/feedback, persistent group messages,
attachments, unread/read behavior and history. New group portal integration needs its own entitlement
adapter and history policy; do not grant it through a teacher-plan flag or alias a batch to recurringId.
Check late joiners, expired/refunded students, other teachers and attachment recipients explicitly.

Real collection still blocked on gateway/merchant/payout/tax decisions; engineering can proceed in
isolated test enrollment. Do not imply simulated receipts or eligible balances are money paid.
