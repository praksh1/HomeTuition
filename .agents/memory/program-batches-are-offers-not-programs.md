# Program Batches are offers, not Programs

Owner decision, 2026-09-10: a Learning Program is reusable editorial content. One scheduled run is
a Batch. A Batch owns its 1–10 capacity, one all-inclusive NPR price, ordered Nepal-time lessons and
the enrollment cutoff derived from Lesson 1. A Program may have multiple Batches.

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
device testing. No duplicate-batch or saved-template feature was implemented in this slice.
