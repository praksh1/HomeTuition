# First-time teacher/student UX audit

- Date: 2026-09-26
- Branch: codex/support-case-workspace
- Status: partial audit; authenticated journey blocked at email verification

## Requested
Test Fadko as a new teacher/student and report confusing navigation, wording, payment expectations and dispute flows. Owner explicitly approved synthetic Preview accounts and no-charge test bookings/messages/dispute. Audit only; do not implement fixes in this turn.

## Work performed
Created a local Playwright audit harness and exercised live Preview welcome, teacher/student registration, verification continuation, public teacher profile and an expired public class. Created two labelled synthetic accounts using example.com addresses; neither can receive verification links. Reviewed associated signup/guard/payment/support source. Wrote docs/FADKO-FIRST-TIME-UX-AUDIT-2026-09-26.md with evidence and priorities. Screenshots are in .ux-audit; auth storage is in OS temp, not repo.

## Verification and boundaries
Actual headless Chromium at 390x844 and desktop public-profile evidence at 1440x844. Not actual iPhone Safari/native apps. No email delivery, authenticated onboarding, booking, class completion or dispute end-to-end pass claimed. No purchases, real payment, identity upload, verification bypass, financial change, commit/push or deployment.

## Problems and surprises
Interactive browser and ordinary exec failed at sandbox-helper initialization. Escalated existing browser harness works. One harness action was initially ordered before navigation and timed out; rerunning the observed registration URL correctly reproduced generic validation. This runner error is not an app defect. Both new accounts reached verification. Continue routes to root and the unverified guard routes straight back. Asked owner for usable test inbox; no delivery outage claimed from example.com addresses.

## Findings / fabrications
Verification dead-end CTA, public teacher's reverse-date 20-lesson list and Book & pay NPR 0 labels, generic signup validation, narrow subject/grade choices with default Grade 10, unverified thousands/best-teachers copy. Source-only: incomplete payout explanation on earnings screen and year-only guardian age calculation. Detailed report separates real UI observations from source review.

## Deliberately untouched / next pickup
No application code changed. Existing queued upgrades preserved. Resume with approved usable test inbox or existing verified synthetic accounts; do not silently bypass approval gates. Finish paired enrollment/class/dispute journeys and physical-browser checks before calling this audit complete.
