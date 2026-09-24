# One missed lesson, one clear resolution

24 September 2026. Product proposal for the owner, **not an active refund policy or implemented feature**. No purchases, automatic refunds or automatic bans.

## Recommended student experience

Open the lesson and choose **Get help with this lesson**. The app already knows the class, teacher, purchased schedule, receipt and recorded attendance; do not ask the student to retype these. Ask what happened, then show only relevant choices.

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

## Owner decisions needed before activating

1. Is one teacher-approved courtesy replacement per missed student lesson acceptable, without a guaranteed entitlement?
2. What response window should replacement offers have, and how long may a replacement be scheduled into the future? Expiry should send the case to review, not silently erase the student's rights.
3. If a student misses an accepted replacement, should that go to manual review during launch? Recommended while the platform has limited real usage and evidence.

Recommended launch scope: teacher-nondelivery offers and student courtesy requests in the same workflow, operator-reviewed money outcomes, no new automated financial policy. Use the existing lesson-support route until this is built and approved. Do not revive legacy monthly daily-attendance or five-make-up rules.

## Quiz follow-up: inside Homework, not a second learning portal

Teacher uploads a document, reviews extracted draft questions, chooses answers/points, previews the student version, then releases. **Every question and its answer must be confirmed before release.** Extraction is not grading and guessed answers are never silently marked correct.

Start with multiple-choice and explicitly accepted short-answer variants. Grade these deterministically on the server; ambiguous, essay and unsupported questions stay teacher-reviewed. Student APIs must not disclose answer keys before the teacher's chosen reveal time. Version released questions; retain the version used for each attempt. Distinguish practice attempts from graded attempts and preserve accessible non-image question text.

Document parsing can begin with supported text-bearing files. Scanned handwriting, diagrams and image-only PDFs require separately validated OCR/model extraction and privacy/cost controls; no claim that unlimited free extraction exists. Reject oversized/malicious files, isolate parsing, protect attachment access and never follow instructions found inside uploaded documents.

Acceptance tests should cover answer-key authorization, malformed imports, unconfirmed questions blocked from release, duplicate submission, deadline/timezone boundaries, deterministic regrading and review of low-confidence extraction. This feature is queued, not deployed by the teacher-studio release.
