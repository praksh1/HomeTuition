# First-time experience and mandatory account requirements

- Date: 2026-09-26
- Agent: Codex
- Branch: codex/support-case-workspace
- Status: in progress; local implementation, not deployed

## Requested
Fix findings from the first-time UX audit and continue testing. Owner additionally requires profile photos, verified email and a phone number for BOTH teachers and students. Phone OTP is deferred during testing. Keep queued work and avoid purchases.

## Changed
Signup now has field-specific errors, focus/scroll assistance, no default grade, adult/primary/middle/exam levels, searchable/custom subjects, exact birthday-based guardian prompts and factual marketing copy. Verification continuation checks the server instead of blindly redirecting into a loop; resend has a successful-send cooldown and sign-out recovery is available. Teacher public session queries explicitly request standalone listings and nearest-first upcoming ordering; server removes recurring/batch-generated lessons before pagination. Earnings copy explains simulation, eligibility versus transfer, human review and the currently unannounced payout schedule without inventing a bank-arrival promise.

Both roles now see required profile-photo upload in onboarding AND account editing. Missing-photo errors appear inline; existing contact field validation is preserved. Server onboarding refuses completion without a stored uploaded photo; completion checks re-evaluate photo and valid phone rather than trusting an old timestamp. Historic accounts no longer count as email-verified merely because no security row exists. Consuming a valid verification link can safely create that row. New class creation/publication and booking entry points check verified email and completed profile; batch test booking checks both parties. Upload/recovery endpoints are not blocked by the new readiness middleware. Email syntax is validated on registration. No OTP provider added or phone marked verified.

## Decisions and assumptions
Required account data applies to existing teacher/student accounts as well as new ones. A profile picture requirement is not face-recognition or identity verification. Existing Nepal phone-format validation remains; no new international-number policy was assumed. Mandatory email verification must work through an actual inbox, not a hardcoded test bypass. Stricter legacy gates must not be deployed until legitimate verification/recovery is exercised and integration fixtures are updated honestly.

## Verification
Full workspace typecheck passed after primary changes. 572 app unit tests passed. 10 targeted registration/server-onboarding tests passed (birthday parity, custom subjects, explicit grades, both-role photos, legacy completion and phone format). New isolated signup/verification browser suite: 28 checks passed at 390/1440 widths. Existing profile suite expanded to test missing-photo rejection and upload/save for both roles: 144 checks passed. Earnings browser suite: 26 checks passed. Design lint passed without increasing its baseline (56 hex/211 sizes). Signup screenshot inspected: test harness substitutes fonts, so not a production-font visual sign-off.

## Problems and surprises

Final verification: full workspace typecheck passed again after readiness gates and registration email checks. Server unit suite passed 735 tests. `git diff --check` passed (only repository line-ending conversion warnings). Combined rendered checks total 198: signup 28, profile 144, earnings 26. No real API/database integration run or live email delivery test is included in these counts.
Normal shell/browser runtime was previously unavailable; scoped escalated commands and existing browser-test infrastructure work. A combined delete/add patch was rejected without edits; implementation was reapplied as targeted updates. One source-read patch helper stopped because its truncation-word safeguard matched source text; remaining routes were patched explicitly. Original audit used example.com accounts, so email delivery and authenticated real Preview journeys remain unverified. Existing test fixtures may rely on grandfathered accounts and require updates before integration CI can pass.

## Fabrications found
Removed unverified thousands/best-teachers signup claim. Removed implicit legacy email verification and historic completion assumptions. Payout copy explicitly states that a schedule/method/processing time has not yet been announced rather than fabricating it.

## Deliberately not changed
No production/Preview deployment, push, purchase, provider activation, real payment, identity upload, automatic refund/ban or OTP. Existing classroom behavior and refund policy preserved. No claim that every audit finding or end-to-end journey is complete.

## Remaining risks / next pickup point
Finish server regression and database-backed integration coverage for readiness gates, legacy verification upsert and public listing exclusion. Update integration fixtures to have genuine explicit synthetic verification/photo/contact evidence; do not weaken production checks to satisfy old fixtures. Verify current mail configuration and owner-controlled inbox before promoting gates that can redirect existing testers. Continue public teacher pagination/zero-price wording and full signed-in teacher/student booking→class→dispute audit. Test actual iPhone Safari/Android; isolated Chromium widths are not native-device coverage. Photo storage ownership/MIME checks are existing server behavior, not a new identity-authenticity guarantee.
