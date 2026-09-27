# Identity documents and first-use audit — 26 September 2026

Owner decisions in this thread supersede earlier school-ID-only proposals:
- Teacher citizenship documents require operator approval before accepting bookings.
- Students must submit their own citizenship document OR one parent's citizenship if they have none, regardless of age. School ID alone is insufficient. Students may book while review is pending.
- Parent details identify the parent, not the student. Consent/relationship must be captured separately. No public parent role or student-identity verification claim is implied.
- Delete approved uploaded documents 90 days after approval; retain encrypted ID number, legal name, DOB and issuing municipality/district for private reference.
- Rejected submissions: delete after 30 days. Active fraud holds: review every 90 days, do not silently release.
- Minimum child information only. Never include legal identity fields in profile/classroom/AI-support responses.
- Owner confirmed in the 26 September follow-up: retain private reference details for ONE YEAR after account closure. Active fraud holds remain separate. Use a calendar-year anniversary, not an assumed 365 days.
- Owner approved on 27 September: a closure request leaves the account usable while Support resolves upcoming paid lessons, pending payouts/refunds, make-ups and open disputes. Start the one-year reference-retention clock only when closure is completed, not when requested. No automatic cancellation, refund or forfeiture.

## 27 September correction — current product policy

The owner subsequently removed the student/parent citizenship requirement. Students may book without submitting identity documents. Do not collect citizenship from a student or parent in the active signup, Profile or direct upload route. Preserve the private student/parent form and schema in source for a separately approved future decision; do not expose or activate them by a feature flag alone. Teachers still need their own citizenship submission and operator approval before accepting bookings. Earlier student-document rules above are historical design notes, not active requirements.

Implementation status is in `.agents/worklog/2026-09-26-codex-identity-and-first-use.md`. No identity collection, migration, production enforcement or deletion scheduler has been activated. Never claim foundation modules mean the upload/review flow is complete.
