# Cost analysis and queued learning release

- Date: 2026-09-24
- Agent: Codex
- Branch: codex/queued-learning-release
- Base commit: e6a27c9
- Status: feature checks passed; production promotion in progress

## Requested
Compare near-zero-cost LiveKit hosting without an existing server/domain. Complete and deploy the queued product work, preserving no-purchases and existing financial safeguards.

## Changed
Current-source video cost report; role-correct shared-tab reload routing; private quiz drafts, local PDF/text import, per-question confirmation, immutable publication, student practice, server grading, one-attempt retry recovery and paginated teacher results. Quiz notifications use existing homework preferences. Additive schema is awaited by quiz routes, not attached to auth. No dependencies were added.

## Decisions and assumptions
Production remains on LiveKit Cloud. Self-host kit stays on its separate preview branch. No account, server, domain or paid provider purchase. Make-up rules remain a proposal until the owner answers the specific policy choice; no automatic refund or ban.

## Verification
Local full typecheck passed. Server rules: 734 passed. App rules: 568 passed. Design-token baseline unchanged. Initial quiz browser harness: 28 checks passed at 390/1440 widths, including real two-page PDF extraction; screenshots inspected. Feature CI **36029838470** passed on **74a378d**, including **45 real-API quiz checks** and **56 built-app cold-refresh/account-gate checks**. Local Windows cold-refresh check also passed all 56 after its dialog handler was made explicit for the existing onboarding unsaved-form warning. The final slow-request review added a UI safeguard and expanded the quiz browser harness to **34 passing checks**; app typecheck also passed. Full production gate is pending; no live completion claim yet.

## Problems and surprises
Current Oracle documentation says 2 OCPUs/12 GB, not the older often-quoted 4/24. Hetzner published changed prices in June 2026; do not reuse older quotes.

The first quiz browser run caught a teacher-only answer-key validation expression executing in the student view. Guarded it by editor mode and reran both roles successfully; student API responses still omit the key. Initial feature CI 36029500378 stopped because the synthetic teacher fixture lacked the required bio; fixed the fixture without weakening registration. A new notification test initially passed the whole notice rather than its data payload; corrected to the real call contract. All these failures happened before production promotion.

While production run 36030750757 was still in its browser stage, a final review found editable question fields during a pending save. A held-request browser test reproduced this before the fix. Draft fields/navigation and student answers now lock during their request so a late response cannot overwrite intervening edits. The new 34-check browser run passed at both widths. Supersede the earlier web run with the corrected release rather than bypass the full gate. No API/financial behavior changed in this follow-up.

Production run **36033198005** then passed the 34 quiz browser checks but stopped before deployment on a cold-refresh test navigation timeout, between an incomplete-profile fixture and a signed-out fixture. These simulated account states had reused the same mounted onboarding form. Each account-gate case now owns a fresh browser context and fixed auth response; all destination checks and error/external-request assertions remain. This is test isolation, not removal of the app's leave protection or an authentication change. The next full run must pass before promotion is reported.

## Fabrications found
None. Capacity examples in the cost report are estimates, not load-test results.

## Deliberately not changed
LiveKit production credentials/provider; financial entitlements; consumer AI accounts; classroom production layout.

## Remaining risks / next pickup point
Verify feature CI, full production deployment and live bundle/API before reporting completion. Make-up limits/windows await the owner's answer. Production browser is signed in as teacher, so guide publication is correctly blocked; asked owner to sign in as operator. Deeper support diagnostics, vision/consent/retention, provider-payment reconciliation and provider activation remain separately tracked; they are not completed by a quiz release. No self-host public-network or physical-device claims. Quiz scope/known limits and test path are in `docs/FADKO-QUIZZES-2026-09-24.md`.
