# Learning Programs and managed-marketplace direction

Owner decision, 2026-09-07: evolve Fadko into a managed marketplace for structured learning, not
an online school that owns every curriculum and not a directory of disconnected calls.

- Student offers are **Single Class** and **Learning Program**. Do not call the student product a
  teacher "Monthly Plan".
- Programs support school subjects, practical skills, languages, exam preparation and custom
  topics. School/grade fields are conditional, not universal.
- Owner clarification, 2026-09-11: explicitly include neighbourhood/after-school tuition by
  college students and schoolteachers, language consultancies, MBBS/Engineering/Lok Sewa exam
  preparation, IELTS/TOEFL, and music/arts/drama teachers. Do not force all of these into a school
  syllabus or assume every offer is a finite course. Consultancy/team administration is not
  already implemented merely because language Programs exist.
- Owner payment decision, 2026-09-11: students/families must pay BEFORE the teaching they buy
  begins. Do not offer attendance on credit or guarantee collection after delivery. Student
  payment timing is separate from teacher payout timing and teacher platform-plan fees.
  For ongoing tuition, advance renewal for each period is the proposed design; exact period
  boundaries, enrollment rules and any course installments remain to be approved, not invented.
  This does not change previously purchased terms or enable a real payment gateway.
- The common learning loop is Prepare -> Learn live -> Discuss -> Practice -> Progress. Monthly
  Discussion Mode remains exclusive to the eligible recurring/monthly student product.
- Teachers remain independent providers by intended model and supply their own expertise/content;
  Fadko supplies discovery, structure, classroom, payment record, evidence and support. The legal
  classification depends on the real relationship, not the contract label.
- Desired payment direction: student pays through Fadko using an NRB-licensed provider; tuition is
  allocated lesson-by-lesson; eligible teacher earnings are paid on a published weekly cycle after
  the complaint window. An internal ledger is not to be called escrow or a wallet.
- Beta commercial contract approved by the owner on 2026-09-10: launch Flexible only; teacher
  share 70%, Fadko share 30%; no separate student fee; a 48-hour lesson complaint window; only the
  affected lesson allocation is frozen; a teacher cancellation first offers a make-up and then an
  approved affected-lesson refund; weekly payout is provisionally Wednesday pending provider bank
  timing. These terms must be snapshotted per purchase rather than read from mutable constants.
- Teacher Pro remains a future option, separate from what a student buys. Do not build a confusing
  prepaid/postpaid 2x2 grid.
- Existing Monthly and Single Class contracts remain unchanged. Phase 3 starts with a shadow
  ledger and test enrolments only: no gateway, collection, real payout or real refund is enabled.
- Provider, gateway/tax treatment, parent contracting and production payout cutoff remain open and
  still block real-money activation.
- Preserve existing purchased terms and atomic booking/membership rules. New program/ledger work
  must be introduced alongside current recurring structures, then migrated explicitly.

Full product and implementation plan:
`../backlog/2026-09-07-learning-program-managed-marketplace.md`.
