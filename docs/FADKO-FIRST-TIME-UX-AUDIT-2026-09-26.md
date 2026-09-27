# First-time teacher/student UX audit — 26 September 2026

## Continuation — 27 September 2026

This is still a **partial** first-time-user audit, not an end-to-end or launch sign-off. The two labelled Preview accounts created on 26 September cannot receive mail at their synthetic `example.com` addresses, so neither completed real email verification. No teacher approval was bypassed; no booking, real payment, identity upload, classroom attendance or dispute was submitted on Preview in this continuation. The local changes described below are not deployed.

Today I checked the public Preview welcome page on a 390px viewport, its public teacher page at 1440px and an expired program page on a 390px viewport. The teacher page **still** listed twenty reverse-ordered generated `Science 102` lesson cards with `Book & pay NPR 0 for this class`, underneath a separate `Classes and courses` section. The expired program page clearly indicated joining was closed. Evidence: `artifacts/sikshya/.ux-audit/audit-20260927-{welcome-phone,teacher-desktop,program-phone}.png`.

I also ran local synthetic Chromium suites on the current `codex/support-case-workspace` worktree. These are tests of components and mocked network responses, **not** evidence that Preview or Production has the fixes or that a real teacher/student completed the flow:

| Local screen journey | Result |
| --- | --- |
| Signup and email-recovery UI | 34 assertions passed, 390px and 1440px |
| First-use teacher dashboard | 33 assertions passed, 390px, 768px and 1440px |
| Teaching earnings/payment explanation | 26 assertions passed, 390px and 1440px |
| Student discovery | 242 assertions passed, 390px and 1440px |
| Sessions organization | 38 assertions passed, 390px and 1440px |
| Operator support-case workspace | 34 assertions passed, 390px and 1440px; **not** a student dispute submission |
| Profile/account states | 252 assertions passed, 390px and 1440px |
| Four-step class creation, conflict review, draft recovery | 111 assertions passed, 360px, 390px and 1440px |
| Teacher/student class home | 32 assertions passed, 390px and 1440px |
| Program studio | 254 assertions passed, 390px and 1440px |

That is 1,056 passing **narrow local assertions**, not 1,056 independent end-to-end tests. The older refund integration script did not run: it requires a local API and database that are not running; it also mutates test teacher approval and uses a paid-method booking, so it must not be pointed at Preview/Production. The student ticket browser test likewise requires a local API/database and was not run. The operator case UI test does not substitute for a student filing or a teacher seeing a complaint.

### First-time usability judgment

- **Clear improvements in the local build:** the class wizard explains four steps; includes a date/timetable, explicit late-joining choice, review and confirmation; highlights conflicts together and lets the teacher fix dates before advancing. It shows per-student and per-lesson estimated earnings before tax. Draft-save failure preserves work. Phone and laptop rendering is usable in the tested viewports. Discover provides intent-based search and category filtering. A 30-lesson student class stays compact instead of dumping thirty rows.
- **Trust/payment gap before real launch:** the local earnings screen honestly distinguishes simulated activity and explains that lesson delivery, the review window, complaints and human review affect eligibility. It does **not** give a transfer destination, published payout cadence, exact processing time or a real provider status. A new teacher still cannot answer “when will the money reach me?” This must be settled operationally and explained before taking actual payments; do not invent a date. The pricing wizard's “full payment upfront” wording should be reconciled with the currently simulation-only/"listings only" notice when the paid gate opens.
- **Verification/approval language:** the local new-teacher dashboard says “Verification pending” and directs the teacher to upload credentials in Profile. Because email verification, profile completion, identity review and teacher approval are different gates, the first-use screen should show each step and its status distinctly. This is a usability recommendation from a synthetic rendering, not a deployed defect confirmation.
- **Dispute discoverability:** local source links Help from class home and Earnings, and has a Support form with recent-session selection, an explicit refund notice for an early-ended lesson, original-payment-method copy, evidence handling, a case reference and My Requests. The code path exists; the new-student path from a completed lesson through submission, operator decision, teacher notification and refund status has **not** been exercised live. A generic complaint without a selected session requires an attachment, which may strand a user unable to provide one; this warrants a deliberate policy/usability review, not an automatic weakening of fraud controls.
- **Preview still needs the public teacher-page cleanup:** despite passing local rendering checks, the live twenty-card reverse-order `Book & pay NPR 0` list remains confusing for a newcomer and should not be treated as finished.

The next meaningful test requires an owner-controlled test inbox (or already verified, synthetic staging credentials), a teacher approved through the real operator flow, and a no-charge class booking on Preview. Then both roles can be followed through lesson completion, receipt, complaint submission and decision visibility. Do not bypass the email/approval gates or call this a real payment-system pass. No code, configuration, deployments or financial state were changed by this continuation.

## Verdict and scope

### Follow-up implementation checkpoint

Owner approved fixes and added mandatory photos, verified email and phone for both roles (OTP deferred). Local changes now address signup errors/choices/age/copy, verification recovery, public standalone filtering/order and truthful payout explanations. Both roles have photo upload in account editing, and server completion/new-booking/publication checks require stored photo/contact/verification evidence, including older accounts. See `.agents/worklog/2026-09-26-codex-audit-fixes.md`. These changes have NOT been deployed. Full typecheck, 572 app unit tests, 735 server unit tests and 198 isolated browser checks passed. Real email, database-backed integration and the rest of the end-to-end audit remain open; the original observations below describe the deployed site tested before these local fixes.

Partial audit, not an end-to-end pass or launch sign-off. Two clearly labelled synthetic accounts were created on Preview with the owner's explicit permission. Both reached mandatory email verification. The example.com addresses cannot receive email, so authenticated onboarding, booking, live class completion and dispute submission remain untested in this audit. No verification/teacher-approval gate was bypassed, no identity documents were uploaded, and no money moved.

Real Preview UI was exercised using headless Chromium at 390 × 844 and public teacher-page layout at 1440 × 844. These are browser viewport checks, not physical iPhone/Safari or Android tests. The normal interactive browser runtime failed before launch; the project's existing Playwright runner worked. Source review is separately labelled below. Application code and deployments were not changed.

## Observed journeys

| Journey | Result |
| --- | --- |
| Welcome → teacher choice → login → Create New Account | Works; teacher registration displayed |
| Teacher registration with synthetic name/email/password, Mathematics and test bio | Account saved; mandatory verification screen |
| Verification → Continue to my account | Returns to same verification screen; corroborated by route guard |
| Welcome → student choice → login → Create New Account | Works; student registration displayed |
| Empty student registration | Generic error below fields; no field-specific red errors in inspected screenshot |
| Adult synthetic student registration, College selected | Account saved; mandatory verification screen |
| Public teacher profile /teacher/1 | Works, but long reverse-date lesson list and misleading booking copy |
| Public class /program/10 | Clearly explains joining has closed and points to teacher page |
| Verified signup → onboarding → booking → class → dispute | Blocked pending a usable test inbox/verified test setup; not passed |

## Findings to address

### 1. High — verification continuation is a dead-end loop (live + source)

Both accounts displayed “Your account is saved. Fadko cannot confirm that a verification email went out to this address.” On the teacher account, pressing “Continue to my account” remained on the verification screen. `check-email.tsx` replaces the route with `/`, while `_layout.tsx` forces unverified teachers/students back to `/check-email`.

The email warning is NOT proof of a mail-provider outage: the addresses used are synthetic, and delivery was not tested. The button/guard contradiction is independently reproducible.

Recommendation: retain mandatory verification, but offer truthful actions: resend with cooldown, change email, and sign out. Only show Continue when verification actually permits continuation. Explain precisely what is blocked. Test the real email link, expiry, resend and wrong-address recovery with an owner-controlled inbox.

### 2. High — public teacher page mixes course discovery with individual lesson sales (live)

`/teacher/1` first shows Classes and courses, then a separate Book a class section saying “monthly courses are a separate product.” It rendered 20 upcoming Science 102 lesson cards, starting at Lesson 30 and descending to Lesson 11. Each had “TEST CLASS,” “NPR 0 per class,” and “Book & pay NPR 0 for this class.”

This makes it unclear whether to enroll in a course or buy one of its generated lessons, and later dates appear ahead of nearer ones. No purchase was attempted; this is a display/navigation finding, not a claim that a backend booking bypass exists.

Recommendation: one canonical course/batch enrollment card; generated lessons belong inside its schedule. Keep genuinely standalone classes separate, order upcoming dates nearest-first, and paginate. Test checkout should explicitly say no payment, rather than “pay NPR 0.”

Evidence: `.ux-audit/teacher-public-booking-desktop.png`. Source: `app/(student)/teacher/[id].tsx`, upcoming list mapping/order and booking copy.

### 3. High before paid launch — teachers do not get a complete payout explanation (source review)

`components/commerce/TeachingEarnings.tsx` explains estimated earnings before taxes and release after delivery plus the complaint window. It does not, in this screen, explain a payout cadence, transfer destination, processing time, payout setup, or exactly what changes when a student disputes a lesson. Registration itself contains no earnings explanation.

Recommendation: before first publication, provide a short “How you get paid” summary and link it from Earnings. Distinguish earned/pending/eligible/sent; show the review deadline and reason for a hold. State the approved payout schedule and provider processing time only once those operational facts are established. During simulation say plainly that no earnings can be withdrawn. Do not promise that release eligibility equals bank receipt.

This is a content gap found in source, not a completed real-payment test or assertion that every screen lacks payment information.

### 4. Medium — registration retains generic form validation (live + source)

Submitting the empty student form produced “Please fill all required fields” near the bottom. The visible fields did not identify individual omissions. This repeats the style of validation the owner previously rejected for profile editing.

Recommendation: field-specific errors, focus/scroll to first invalid field, preserve input, and show password requirements before submission. Apply consistently to signup, not only profile updates.

Evidence: `.ux-audit/student-empty-registration.png`; `app/(auth)/register.tsx`.

### 5. High for the intended audience — signup choices exclude valid teachers/students (live + source)

Teacher registration requires one of ten school subjects; no Other/custom choice was visible. Korean-language tutors, professional-exam tutors and other specialists cannot describe their specialization accurately. Student registration offers Grade 8–12 and College only, with Grade 10 already selected. Younger students, adult language learners and working exam candidates are poorly represented.

Recommendation: searchable subject choices plus Other, and explicit learner-level selection including primary/middle school, adult/professional and not applicable. Do not silently default a factual field. This needs to support the broad teaching marketplace described by the owner.

### 6. Medium — signup trust copy needs an evidence check (live)

Student registration says “Join thousands of students learning with Nepal's best teachers.” This audit did not verify either claim, and the owner describes a prelaunch service.

Recommendation: use factual copy such as “Find a teacher and learn in live classes” unless those claims can be substantiated. Do not build first-time trust on unverified social proof.

### 7. Medium — date-of-birth entry needs a friendlier, precise age flow (live + source)

The student form uses a free-text YYYY-MM-DD input with a calendar icon. Source determines whether to show guardian fields using current year minus birth year, ignoring whether the birthday has occurred. This can fail to show guardian fields for someone who turns 18 later in the current year. No underage account was created, and server enforcement was not tested; this is not a claim of a proven server-side age bypass.

Recommendation: accessible date selection/manual entry, explicit calendar format, exact birthday-based age calculation shared with server validation, and boundary tests. Guardian requirements should be visible before the account submission fails.

### 8. Follow-up — support has useful foundations, but the complete dispute experience remains unverified

Source review found an explicit original-payment-method refund notice, early-ended-class guidance, a request reference, progress history and a final-decision section. Those are useful. However, this audit has NOT verified a new student can find the right action from a completed lesson, submit a request, receive updates, or that the teacher sees an understandable dispute notice and affected earnings.

Recommendation: perform a paired teacher/student test after verification, including an ordinary completed lesson, teacher non-delivery, student absence, evidence-upload failure and a withdrawn request. Check what each party sees without relying on operator-only screens. Do not mark financial/dispute readiness from source review alone.

## Positive observations

- Welcome role choices are concise and distinguish teaching from learning.
- Teacher signup discloses identity/credential verification before submission.
- The expired public class page clearly says joining is closed and offers a relevant next destination.
- Teaching earnings and simulation copy distinguish estimates/test activity from actual money.
- Refund-request source explicitly says approved refunds go to the original payment method and tells users what to do if those details changed.

## Resume requirements and next tests

Use an owner-controlled test inbox for genuine verification, or owner-supplied already verified synthetic credentials for downstream testing (which must be labelled as skipping fresh verification). Do not manufacture verified state or approval documents.

Then complete:

1. Teacher onboarding, approval waiting state, profile recovery and first class publication.
2. Student discovery, pricing, simulated enrollment and duplicate/retry booking behavior.
3. Desktop and mobile-sized classroom entry, completion and return to class home.
4. Paired dispute visibility, messages, evidence and earnings impact.
5. Payment/setup explanations using the actual paid-launch policy, not a guessed schedule.

Two synthetic accounts remain saved in Preview: UX Audit Test teacher and UX Audit Test student. Browser authentication state is in OS temporary files, outside the repository. No credentials are included in this report. No test messages, bookings or disputes have yet been created. No fixes were deployed as part of this review.
