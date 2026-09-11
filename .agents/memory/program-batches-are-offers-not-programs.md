# Program Batches are offers, not Programs

Owner decision, 2026-09-10: a Learning Program is reusable editorial content. One scheduled run is
a Batch. A Batch owns its 1–10 capacity, one all-inclusive NPR price and ordered Nepal-time lessons.
Fixed courses close enrollment at Lesson 1. The 11 September ongoing-tuition extension closes at
the shared period start instead (even if Lesson 1 is later). A Program may have multiple Batches.
See `tuition-periods-are-shared.md`; absence of a period link remains a fixed course.

Never put these fields on the Program itself, and never describe the existing
`learning_program_enrollments` rehearsal row as a Batch enrollment: it is unique by student and
Program and cannot represent a student joining different runs. Until a Batch-specific commercial
contract exists, show no seats remaining, Join, Pay, refund or payout claim.

Public Batch reads come from an immutable validated snapshot. If the parent Program is unpublished,
archived or republished to a different version, or if the teacher becomes unapproved/suspended, the
offer is withheld until its relationship is true again.

Teacher planner is now a three-step UI (size/price → schedule → review). Repeat-date generation is
only a draft helper, not a new recurring billing model: UTC calendar arithmetic generates Nepal
date/time inputs to the existing API. First weekday must match; holidays are not skipped. Applying
generated dates is not saving, and saving is not publishing. Do not combine those actions silently.
`test:batch-planner` covers browser interaction with synthetic API; native controls still need owner
device testing.

Owner correction, 11 September: unchanged published batches must not be published repeatedly.
Compare the actual offer on both client and server; ignore publication version only when comparing
content, not the parent Program's version. UI review is read-only until Edit details. Publish requires
fresh price/schedule acknowledgments. Batch template reuse creates a NEW draft from saved source
settings and clears ALL dates. It does not copy enrollment/payment/publication, or duplicate the
Program itself. Copies still require a fresh schedule and review; local copied values are not saved
until Save succeeds.

Paid-Batch edits are a checkout RELEASE BLOCKER, not a shipped safeguard: no Batch-level paid
enrollment exists yet. The Program rehearsal is not that system. Before enabling payments, bind and
freeze the purchased Batch version/terms and implement audited changes/cancellation/remedies.

Owner decision, 11 September: a teacher cannot publish overlapping lessons, across Batches,
Programs, Single Classes, Monthly classes or make-ups. Conflicting drafts stay saveable with
warnings. Use full occupied intervals, not just equal start times. End-to-start adjacency is
allowed, no compulsory break; different teachers may teach simultaneously. Student purchase
conflicts should also be blocked when Batch checkout is built; not an existing checkout feature.
