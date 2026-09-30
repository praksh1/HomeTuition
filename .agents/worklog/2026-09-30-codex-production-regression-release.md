# Reviewed Production regression release

- Date: 2026-09-30
- Agent: codex
- Branch: codex/production-journey-fixes-sep30
- Base commit: f9b0506f3d424e4aeaf0f86366eab4bfa8722432
- Status: release verification in progress; not yet deployed

## Requested

Promote the owner-approved Preview regression fixes to Production, preserving the premium owner dashboard and established financial/privacy boundaries. Finish the live make-up workflow separately after genuine database-backed checks.

## Changed

Reviewed class-setup limits and timetable reconciliation, draft deletion/discard, enrolled versus prospective class presentation, expandable schedule history, clearer simulated receipts, profile-photo viewing/editing and lightweight avatars, private reporting confirmation, recipient message suppression, and bounded expanded call layouts. Added an all-chunk API-target build guard and a read-only message-schema release diagnostic.

## Decisions and assumptions

Do not merge the whole divergent Preview branch. Preserve Production's premium Cost & Health dashboard byte-for-byte. No purchases, payment credentials, identity-collection activation, automatic refunds or bans. The make-up runtime is not part of this regression candidate.

## Verification

Candidate checks passed: workspace typecheck, API build, design baseline, 766 API and 614 app unit tests; browser assertions for class setup (170), profile/photo (226), messaging (150), class home (50), expanded call layout (308), booking (90), Discover (274) and owner Cost & Health (612). Export-target tests: 11. Rebuild final frozen source before deployment.

Read-only Production database readiness passed using the explicitly selected Railway Production service. Public-schema creation permission and all safety-table parent dependencies exist. The three new suppression/report tables are absent and will be created additively through fail-closed initialization. No business or personal data was read or changed by that check.

## Problems and surprises

Preview and Production differ in 299 files. A blanket merge would overwrite the approved owner dashboard. A newly promoted ordinary-file signing guard also exposed a legacy operator ID-preview compatibility risk; repair that with a separate authorized short-lived reviewer path while keeping ID reuse in avatars/messages blocked.

## Fabrications found

No simulated payment is presented as an actual transfer or paid refund. A successful export does not prove live CDN contents; verify every remote chunk against the frozen artifact after publishing.

## Deliberately not changed

Owner dashboard design, provider billing plans, real payment integrations, student identity rules, saved-material or whiteboard access grants, and the new make-up runtime.

## Remaining risks / next pickup point

Finish operator-preview focused checks, freeze the candidate, run isolated database CI and rebuild. Record commit, deployment IDs, health checks and remote asset hashes before reporting deployed. Physical iOS/Android and two-device live media were not tested by these browser gates.
