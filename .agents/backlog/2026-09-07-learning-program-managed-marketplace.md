# Learning Programs and the managed marketplace

**11 Sep late-joining update:** optional future-lessons-only late joining is approved for ongoing
tuition. See `../memory/late-joining-and-purchased-promises.md` and the late-joining worklog. Prior
blanket no-proration language is superseded. Preview listing policy/estimates are not paid checkout;
first-purchase offer locking, atomic seats/quote expiry and audited rescheduling remain blockers.

**Teacher UX superseded, 11 Sep:** the owner does not want a mandatory Program → Batch hierarchy.
The approved entry is one **Create a class** flow with an optional outline; regular tuition and
short courses use the existing contracts underneath. Renewals stay under one named class card.
See `../memory/create-a-class-not-a-hierarchy.md`. This changes presentation and aggregate setup,
not the approved commercial model. Do not restart formal required-path UX for ordinary tuition.

Status: approved product direction; architecture foundation in progress. No real payment provider,
teacher payout, new price, production migration or database change has been made.

## The product in one sentence

Fadko is a managed marketplace where an independent teacher sells either a Single Class or a
structured Learning Program; the student pays through Fadko, each paid lesson earns its own share
only after delivery and the complaint window, and the teacher receives eligible earnings in a
published weekly payout.

The structure borrows the useful part of Xueersi's learning journey without copying its expensive
centralised school: Fadko supplies the path and trustworthy transaction record; independent
teachers supply the subject expertise and course content; the whiteboard remains the classroom's
centre.

## Names users see

These are separate relationships and must never share a vague label such as "Monthly Plan":

| Relationship | User-facing choices |
| --- | --- |
| Student buys learning | **Single Class** or **Learning Program** |
| Teacher pays Fadko | **Flexible** or **Teacher Pro** (working names) |
| Teacher receives money | **Weekly payout** of eligible earnings |

Prepaid/postpaid is not a four-product grid. Students pay before access. Flexible teachers fund
Fadko's fee from eligible tuition; Teacher Pro teachers prepay a platform subscription and receive
a lower commission. A delayed teacher payout is settlement protection, not "postpaid teaching".

No public price or percentage is approved. Video, gateway, tax, support and refund costs must be
measured first.

## One flexible learning journey

Every program uses the same inexpensive spine:

1. **Prepare** — outcome, prerequisites, materials and optional readiness check.
2. **Learn live** — teacher video, shared whiteboard, materials and Ask to speak.
3. **Discuss** — Monthly-only final-20-minute Discussion Mode when the teacher starts it.
4. **Practice** — a small assignment and student submission.
5. **Progress** — attendance, completed topics, teacher feedback and the next step.

The template changes, not the underlying system:

| Program type | Required shape | Honest completion evidence |
| --- | --- | --- |
| School subject | grade/level, optional curriculum, subject, topics | syllabus coverage, practice and teacher feedback |
| Practical skill | starting level, equipment, demonstrated outcome | milestones, practice and performance/portfolio |
| Language | current level, target use, skill emphasis | conversation, vocabulary, written/spoken work |
| Exam preparation | exact exam, optional date, syllabus, target | coverage and mock performance; never a pass guarantee |
| Custom | audience, prerequisites, outcome, teacher-defined modules | teacher-defined milestones |

School, grade and institutional affiliation are optional outside school-subject programs. A guitar
teacher, language coach or engineering-registration-exam tutor must not be forced through a school
form. Any official affiliation, licence or exam endorsement is a separately reviewed claim.

## Program and lesson boundaries

A Learning Program is the parent promise. Existing `sessions` rows remain the individual booked
classrooms. Existing `recurring_days` rows remain the traceable occurrence ledger where applicable.

The new parent must eventually hold, or version references to:

- owner teacher;
- program type and publication state;
- title, honest outcome, description and teaching language;
- intended learner, starting level and prerequisites;
- optional curriculum/exam reference with a source and `official | teacher_supplied | none` status;
- equipment/material requirements;
- capacity and delivery format;
- enrolment and cancellation terms version;
- ordered modules and lesson objectives;
- start/end or rolling availability;
- price terms snapshot rather than a live mutable price;
- completion method, explicitly non-accredited unless separately authorised.

Do not turn `recurring_sessions` into another wide mutable object in place. Existing purchases and
refund calculations depend on its current shape. Introduce the parent alongside it, then migrate
new programs behind an explicit version/capability. Old contracts keep their original promises.

## Managed-marketplace money flow

The desired money path is:

`student -> licensed payment provider -> Fadko transaction ledger -> pending lesson allocation ->
eligible teacher earning -> weekly payout`

Fadko must not call an internal database balance escrow, a wallet or safeguarded funds. Confirm the
actual collection, split-settlement, delayed-payout, refund, chargeback, KYC and reconciliation
arrangement with an NRB-licensed provider and Nepal advisers before real money moves.

Every amount is integer paisa/lowest provider unit once a real gateway is selected; existing NPR
integer fields must not silently change interpretation. Every external callback is idempotent and
stores the provider, event/reference, received time, verification result and reconciliation state.

The ledger must distinguish:

- payment requested;
- provider-confirmed collection;
- allocated to future lesson;
- lesson delivered but in complaint window;
- disputed/frozen;
- eligible for teacher payout;
- platform fee eligible;
- refund owed;
- refund submitted;
- refund provider-confirmed;
- payout batched;
- payout submitted;
- payout provider-confirmed;
- payout/refund failed or reversed.

An API response or UI must never say paid, refunded or paid out before the provider confirms it.

## Lesson allocation

A student program payment is divided across the paid lesson occurrences frozen in that purchase.
For example, NPR 4,000 for eight paid lessons creates eight NPR 500 allocations. Rounding policy
must be deterministic, with any remainder assigned explicitly and the allocations summing exactly
to the provider-confirmed amount.

Each allocation moves independently:

`future -> delivered_pending -> disputed | eligible -> paid_out`

A make-up replaces one owed lesson; it does not create a second earning. Teacher cancellation
leaves the original allocation unearned until a valid make-up is delivered or the amount is
refunded/credited under the purchased terms.

## Payout policy to validate with provider and advisers

Working product recommendation, not live behaviour:

- Publish a weekly payout day and a visible cutoff.
- Ordinary undisputed lesson earnings become eligible after the complaint window, then enter the
  next payout batch.
- New/high-risk teachers may have a longer disclosed reserve; established teachers may have a
  shorter one. Never change a purchased term retroactively.
- Dispute only the affected allocation unless evidence supports a wider account restriction.
- Refund from future allocation/pending earnings before eligible unpaid balances; never silently
  debit a personal bank account.
- Negative balances and clawback need express contract and provider/legal approval.
- Calculate and record any required TDS separately from platform commission and gateway fees.

## Refund rules that stay understandable

The future policy should be outcome-neutral and evidence-based:

- Teacher/platform cancellation before delivery: replacement or full affected-lesson value.
- Teacher ready and student no-show: ordinarily delivered/non-refundable under disclosed terms.
- Student cancellation with sufficient notice: use the purchased cancellation version.
- Teacher non-delivery: no teacher earning for that allocation; replacement or refund.
- Fadko-wide technical failure: restore teaching capacity and fund the platform-caused remedy.
- Mixed/uncertain connectivity: human review or mutually accepted make-up, not automatic blame.
- Program withdrawal: refund future not-yet-held lessons, not merely lessons the student skipped.
- Mandatory consumer/payment rights override product windows.

Session activity, media telemetry and whiteboard activity help explain delivery; none alone proves
teaching quality or decides a refund. Default universal recording remains rejected.

## Premium experience direction

Premium means calm hierarchy and trustworthy state, not heavy effects. Every new flow follows
`DESIGN.md`, uses semantic tokens, meets 44x44 targets, works with large text and keyboard/screen
reader, and remains responsive on a cheap Android phone.

Teacher journey:

1. **Choose what to teach** — five plain program templates, with relevant examples.
2. **Promise an outcome** — guided, specific and honest; no invented AI claims.
3. **Shape the path** — lightweight ordered modules, lesson objectives and practice.
4. **Schedule and price** — one clear student offer, capacity and terms.
5. **Preview as a student** — exactly the storefront contract before publication.
6. **Teach** — Today's class and preparation, not a generic dashboard of cards.
7. **Understand earnings** — collected, pending, disputed, eligible and paid are visibly distinct.

Student/parent journey:

1. Find by outcome, level, language, schedule and trusted teacher evidence.
2. Read one scannable program page: outcome, who it is for, path, timetable, price, teacher and
   cancellation policy.
3. Pay once for the selected offer and receive a real receipt/status.
4. See one program home: next class, preparation, progress, messages and help.
5. After class, see notes/practice/feedback rather than an expensive mandatory recording.

Avoid generic card grids, icon-only unfamiliar actions, decorative gradients, fake urgency,
unverified outcome claims and blank failure states. Every loading, empty, offline, payment pending,
payment failed, class changed and refund state needs one clear explanation and next action.

## Implementation sequence

### Phase 0 — contract and prototypes

- Settle names, versioned terms, capacity, complaint window, payout cadence and migration policy.
- Obtain written capability answers from the intended licensed payment provider.
- Create realistic teacher/student/operator prototypes for four pilots: Grade 10 Mathematics,
  Beginner Guitar, Spoken English and Engineering Registration Exam Preparation.
- Run a pure cost/ledger calculator; no money movement.

### Phase 1 — Learning Program foundation

- Add versioned program/module/objective structures alongside current recurring classes.
- Build pure validation and state transitions first.
- Add teacher draft/preview/publish APIs and UI.
- Add student program detail and program home using simulated/test enrolment only.
- Preserve existing sessions, bookings and membership.

### Phase 2 — learning loop

- Attach lessons, materials and homework to program modules.
- Add teacher feedback and honest progress summaries.
- Add parent-facing view/notifications with minor-consent rules.
- Pilot the four program types on web and real phones.

### Phase 3 — shadow money ledger

- Add versioned transaction, allocation and balance entries without moving money.
- Mirror current simulated bookings into the ledger and reconcile invariants.
- Build teacher statement and operator reconciliation screens.
- Load/concurrency/failure-test callbacks, allocation, disputes and batches.

### Phase 4 — licensed-provider sandbox

- Integrate provider sandbox and signed callbacks.
- Confirm collection, refund and payout semantics against provider records.
- Run a tightly scoped synthetic pilot; no production money until reconciliation is proven.

### Phase 5 — explicit migration and launch

- Preserve existing purchased terms.
- Publish new agreements, fee versions and support playbooks.
- Opt in a small verified cohort, observe, then expand deliberately.

## Decisions still required before money code

- Which NRB-licensed provider supports marketplace/submerchant or delayed settlement?
- Who is merchant/supplier of record in the signed arrangement?
- Exact complaint and payout windows?
- Flexible and Teacher Pro prices/commission bases?
- Student service fee and refundability?
- Taxes/TDS/VAT and invoice/receipt ownership?
- Chargeback and negative-balance treatment?
- Minor/parent contracting and privacy language?
- Treatment of existing monthly purchases during migration?

None may be filled with a convenient constant and presented as settled.

## Immediate payment-surface safeguard

The shared payment sheet previously collected an eSewa/Khalti mobile number and MPIN inside
Fadko and claimed “256-bit SSL” and “No redirect”, even though no official provider checkout is
connected. The foundation branch replaces it with a provider-selection boundary that:

- never asks for a wallet PIN;
- makes no claim that money moved;
- waits for the server before confirming the booking;
- tells the user that a live payment must open the provider's secure checkout; and
- keeps existing test-access and server-refusal paths usable while real payments remain off.

This is a safety correction, not a payment integration. No gateway was registered or enabled.
