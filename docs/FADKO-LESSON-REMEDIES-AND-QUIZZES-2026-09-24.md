# One missed lesson, one clear resolution

Launch policy approved on 26 September and allowance extension approved on 29 September 2026. The policy validator, workflow model and dormant database schema are implemented locally. **Students cannot yet book these make-ups.** No purchases, automatic refunds or automatic bans are enabled.

## Approved launch policy

The owner explicitly approved: one teacher-approved courtesy replacement per missed student lesson; offers expire after seven days; replacements must occur within thirty days; missed replacements go to manual review; teacher non-delivery always preserves the student's refund-review option. No automatic refunds or forfeiture.

On 29 September, the owner approved these additional student courtesy limits. No weekly restriction is added: one allowance is easier to understand and avoids overlapping weekly and monthly counters.

| Purchased class | Courtesy allowance | Scope |
|---|---|---|
| Monthly tuition program | Two teacher-approved make-ups | Each paid 30-day period; no rollover |
| Short course with two or more lessons | One per ten purchased lessons, rounded up; maximum three | The purchased course; no rollover |
| One-lesson course | No standard courtesy allowance | Support and teacher-nondelivery remedies remain available |
| Teacher-missed lesson in any format | Does not consume the student's courtesy allowance | Each original purchased lesson keeps its remedy and refund-review options |

Examples: a six-lesson short course allows one courtesy make-up; twelve lessons allow two; twenty-four or sixty allow three. A monthly late-join enrollment still receives the approved two-per-period limit, but can only request replacements for lessons actually purchased. A renewed paid period starts its own allowance. An unfinished make-up remains attached to the old period, even when its replacement happens after renewal.

The class label becomes **Monthly tuition program**, with **paid in 30-day periods** shown alongside it. This does not change the period to a Gregorian calendar month or rename internal identifiers. Historical purchased terms remain immutable. The new policy must be snapshotted with the purchase before activation, not calculated from a teacher's subsequently edited class or a global future policy.

Implementation must keep the original enrollment/lesson immutable, avoid replacement chains, and serialize refund approval against replacement acceptance. Expiry is not cancellation of rights. The exact time anchors (offer creation for seven days; proposed original lesson end for thirty days) must be explicit in the UX/specification before activation, not silently inferred from browser time.

For implementation, the seven-day response clock starts when the server records the teacher's offer. Acceptance closes at the earlier of its seven-day expiry or the proposed replacement start. The replacement must start after the original lesson's scheduled end and finish no later than thirty days after that end, measured in UTC instants while displayed in Nepal time. Expiry, a declined offer, or a missed replacement sends the same original case to human review; none automatically forfeits the student's claim, refunds a payment, or releases the teacher's held share.

Current implementation: `makeupPolicy.ts` and `lessonRemedies.ts` define the approved allowance, validated policy snapshots, standard request window, actor-controlled workflow, quota reservations, acceptance prerequisites and replacement settlement target. The additive `lesson_remedy_cases`, `lesson_remedy_offers` and `lesson_remedy_events` schema preserves the original booking/session/allocation, offers, acceptance and audit trail. Both generic operator ledger routes refuse ledger-only `replacement_scheduled`. The settlement calculator can reject original-session evidence for a supplied active remedy. **The live settlement reader does not yet supply that remedy; no request/acceptance routes, database migration, UI activation or real transfer integration have occurred.**

Each original booking and lesson position has one enduring case. An accepted offer retains its acceptance timestamp and cannot be replaced by a second accepted offer. A teacher may use one shared replacement room for several affected students; each has an independent case, acceptance and original fee allocation. Creating access, storing acceptance and linking the original held amount must still happen in one serialized transaction before this feature opens.

## Recommended student experience

Open the lesson and choose **Get help with this lesson**. The app already knows the class, teacher, purchased schedule, receipt and recorded attendance; do not ask the student to retype these. Ask what happened, then show only relevant choices.

For an upcoming lesson, show **I cannot attend · Request a make-up**. This records advance notice, not attendance, cancellation or approval. After the lesson, offer **Request a make-up** alongside **Request refund review**, with the actual two-day review deadline. Filing an eligible request preserves its original claim deadline while the teacher offers a time; the seven-day offer window cannot erase a timely complaint. Safety and technical Support remain reachable after the standard financial review window closes.

Use one compact lesson card with five public labels: **Awaiting teacher**, **Choose a time**, **Make-up scheduled**, **Support review**, and **Completed**. The card shows the original lesson, proposed or accepted date, **No additional charge**, and one next action. Reveal policy details on demand. Class Home groups make-ups separately from the original timetable; Schedule places accepted replacements among the student's or teacher's dated commitments. An offer must not be shown as a confirmed lesson.

Show **2 make-ups available this period** rather than another competing top-level tab. Teacher-approved offers reserve an allowance slot so two concurrent approvals cannot spend it twice. Declining or an unaccepted offer expiring frees the reservation; accepted student no-shows still consume the courtesy slot. A confirmed teacher failure of an accepted courtesy replacement restores that slot, but the failed original case goes to human review rather than generating an endless chain of replacements.

| Situation | Recommended choice | Who decides |
|---|---|---|
| Teacher did not deliver | Accept a free replacement time, or request refund review | Student chooses; operator decides any refund |
| Student could not attend a delivered lesson | Request a courtesy make-up | Teacher may offer or decline; no automatic refund promise |
| Connection or classroom failure | Troubleshoot first, then preserve evidence and request a remedy | Support reviews evidence; missing telemetry is not proof of fault |
| Replacement also fails | Reopen the same case, retaining the original payment and both lesson records | Operator; do not create an endless replacement chain |

Do not require an absent student to claim teacher fault to reach support. Do not silently count a replacement as a second purchase or charge a second time. All money labels must remain explicitly simulated while the site uses test checkout.

## Teacher experience

Use one **Needs attention** queue, with the affected lesson and requests grouped together. The teacher can propose one replacement lesson for all affected students, or an individual courtesy slot. Check teacher availability before proposing, and each student's availability and remaining capacity atomically when they accept. A date the teacher types is not a confirmed booking.

Students receive a dated offer with **Accept this time** and **This time does not work**. Acceptance creates linked, free access and both schedules update. Students who decline teacher-nondelivery offers retain the existing refund-review route. No response must not be treated as consent, completed delivery, or forfeiture.

For a teacher-missed group lesson, propose one replacement time and send independent offers to all affected students. Students who decline or whose calendars conflict can choose refund review without blocking classmates who accept. The offer must keep the original purchased duration and cannot overlap teacher leave, another teaching commitment or that student's accepted lessons. An unanswered teacher request should reach the attention queue rather than remaining an invisible hold; response reminders and escalation must not decide a refund.

Missing the accepted replacement does not automatically mean **no refund**. If the student misses it, Support reviews delivery and attendance; no further courtesy replacement is guaranteed. If the teacher misses it, preserve the affected amount, prioritize the same case for refund review, and restore any courtesy allowance used. For launch, automatic cash refunds are not approved; automatic evidence gathering and escalation are appropriate. A join event or completed label alone is not proof of full delivery.

## Original payment and replacement accounting

One payment allocation follows the original lesson through its replacement. A make-up creates no second purchase, teacher earning or platform fee. Other delivered lessons can continue toward payout; only the affected allocation remains held. Once authoritative replacement delivery is confirmed, use the replacement's end time for a fresh 48-hour review window. Never reuse the original completed session to release the replacement hold.

Receipts and the operator case must show **Original lesson → Make-up lesson → Resolution**, keeping the original price, fee breakdown, payment reference, teacher, student and both attendance/evidence records. Selecting refund review stops new acceptance until Support resolves the choice. Refund approval and make-up acceptance must lock the same original payment record; retries must return the recorded result rather than create another room or transfer. The student cannot receive both an approved refund and continuing replacement access for the same allocation.

## Small, auditable implementation

- One remedy case keyed to the original enrollment and lesson, not a new unrelated support thread.
- Preserve the original purchased price, schedule, provider/session evidence and messages as immutable references.
- Proposed states: requested, offer available, accepted, completed, declined, withdrawn, referred for refund review, resolved. Record actor, reason and timestamp for every transition.
- One active offer per case. Teacher bulk proposals create linked per-student decisions; one accepting student cannot accept for the group.
- Use idempotent acceptance and a transaction locking the enrollment/remedy and relevant schedules. Reject duplicate acceptance and refund-versus-accept races.
- A refund review alone does not cancel access. An approved refund must reconcile the original lesson allocation and replacement access atomically under the policy, never award both accidentally.
- A failed replacement cannot erase an original claim or restart an arbitrary complaint deadline. Keep human review available while policy details are unsettled.
- Show the linked original lesson on payment history and any later adjustment. Keep internal platform custody/fees out of student/teacher earnings summaries.
- AI can gather facts and summarize contradictions; it cannot determine that a lesson was delivered merely from a join event, promise a refund, impose a ban or decide disputed responsibility.

## Earlier policy questions (answered in principle above; implementation not active)

1. Is one teacher-approved courtesy replacement per missed student lesson acceptable, without a guaranteed entitlement?
2. What response window should replacement offers have, and how long may a replacement be scheduled into the future? Expiry should send the case to review, not silently erase the student's rights.
3. If a student misses an accepted replacement, should that go to manual review during launch? Recommended while the platform has limited real usage and evidence.

Recommended launch scope: teacher-nondelivery offers and student courtesy requests in the same workflow, operator-reviewed money outcomes, no new automated financial policy. Use the existing lesson-support route until this is built and approved. Do not revive legacy monthly daily-attendance or five-make-up rules.

## Integration gates before Preview activation

1. Add one allocation-aware transactional service. Validate ownership and frozen purchased lesson positions; lock the teacher schedule, student schedule, booking/payment and case in a consistent order; reserve allowance and shared-room capacity; store audit events atomically. Do not treat the schema foreign keys as proof that all linked rows belong to the same purchased lesson.
2. Make settlement read the original case and accepted fulfillment target. Unresolved cases must prevent payout, and replacement delivery needs an authoritative evidence decision. Keep general Support accessible separately from the 48-hour standard financial window.
3. Exclude replacement rooms from standalone discovery, booking and class-sale counts. Access is granted only to the accepting original student. Route legacy cancellation/drop/refund actions for these rooms back to the original allocation; do not create a zero-price independent refund.
4. Project accepted replacements into Class Home, both schedules, notifications, receipts and the operator queue. Keep pending requests visible after a tuition period/course closes. Include open remedies in account-closure blockers and retain original materials/evidence access.
5. Exercise real database races: duplicate acceptance, acceptance versus refund, simultaneous allowance approvals, group final seat, conflicting schedules, expiry boundary, replacement after renewal, no-shows, late delivery and replay after case completion. Then test visible/tappable UI on compact phones, iOS/Android web and laptops. Unit rules or mock browser checks are not proof of this full workflow.

## Quiz follow-up: inside Homework, not a second learning portal

Teacher uploads a document, reviews extracted draft questions, chooses answers/points, previews the student version, then releases. **Every question and its answer must be confirmed before release.** Extraction is not grading and guessed answers are never silently marked correct.

Start with multiple-choice and explicitly accepted short-answer variants. Grade these deterministically on the server; ambiguous, essay and unsupported questions stay teacher-reviewed. Student APIs must not disclose answer keys before the teacher's chosen reveal time. Version released questions; retain the version used for each attempt. Distinguish practice attempts from graded attempts and preserve accessible non-image question text.

Document parsing can begin with supported text-bearing files. Scanned handwriting, diagrams and image-only PDFs require separately validated OCR/model extraction and privacy/cost controls; no claim that unlimited free extraction exists. Reject oversized/malicious files, isolate parsing, protect attachment access and never follow instructions found inside uploaded documents.

Acceptance tests should cover answer-key authorization, malformed imports, unconfirmed questions blocked from release, duplicate submission, deadline/timezone boundaries, deterministic regrading and review of low-confidence extraction. This feature is queued, not deployed by the teacher-studio release.
