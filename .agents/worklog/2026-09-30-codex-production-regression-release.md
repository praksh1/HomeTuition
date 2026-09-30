# Reviewed Production regression release

- Date: 2026-09-30
- Agent: codex
- Branch: codex/production-journey-fixes-sep30
- Base commit: f9b0506f3d424e4aeaf0f86366eab4bfa8722432
- Status: deployed and live artifact/health/privacy checks passed

## Requested

Promote the owner-approved Preview regression fixes to Production, preserving the premium owner dashboard and established financial/privacy boundaries. Finish the live make-up workflow separately after genuine database-backed checks.

## Changed

Reviewed class-setup limits and timetable reconciliation, draft deletion/discard, enrolled versus prospective class presentation, expandable schedule history, clearer simulated receipts, profile-photo viewing/editing and lightweight avatars, private reporting confirmation, recipient message suppression, and bounded expanded call layouts. Added an all-chunk API-target build guard and a read-only message-schema release diagnostic.

## Decisions and assumptions

Do not merge the whole divergent Preview branch. Preserve Production's premium Cost & Health dashboard byte-for-byte. No purchases, payment credentials, identity-collection activation, automatic refunds or bans. The make-up runtime is not part of this regression candidate.

## Verification

Candidate checks passed: workspace typecheck, API build, design baseline, 778 API and 614 app unit tests; browser assertions for class setup (170), profile/photo (226), messaging (150), class home (50), expanded call layout (308), booking (90), Discover (274) and owner Cost & Health (612). Export-target tests: 12. The final frozen frontend export passed the exact Production API check for all 129 JavaScript chunks; the built owner dashboard and final enrollment presentation also passed browser checks.

The first isolated Production CI run (36744396086) caught a stale unit-test dependency on the removed "Try test checkout" label. Updated that assertion to locate the actual enrollment action while still requiring the signed-out account guard to precede it. All 614 app unit tests passed after that test-only repair. A fresh isolated database run is required before deployment.

Fresh isolated CI 36745763001 passed all steps, including PostgreSQL-backed program, booking, video/proof/access and browser checks. Released source: 4bfb7e979c0f08eae5a88de5393deccc597a05f8 on codex/production-journey-fixes-sep30. Railway manual source upload deployment 0b9743c5-08a5-44e2-bf90-3394d0f15651 succeeded and passed readiness; Cloudflare hometuition Worker version 5aa6aa8b-c716-4eef-8c00-2fe0c3d49e03 deployed successfully. No main-branch blanket merge was performed.

Live verification passed: served HTML and every one of 129 emitted JavaScript chunks exactly match the frozen Production artifact; correct Production API target; approved premium owner dashboard labels preserved; anonymous owner data rejected (401); readiness and public catalogue 200; protected message inbox/unread/access and storage routes reject anonymous callers (401). An initial smoke probe used nonexistent /api/messages and returned its expected routing 404; corrected to the actual protected message routes and passed. New message safety tables still require an authenticated path to exercise their initialization; the read-only prerequisite check and isolated initializer tests passed.

Read-only Production database readiness passed using the explicitly selected Railway Production service. Public-schema creation permission and all safety-table parent dependencies exist. The three new suppression/report tables are absent and will be created additively through fail-closed initialization. No business or personal data was read or changed by that check.

## Problems and surprises

Preview and Production differ in 299 files. A blanket merge would overwrite the approved owner dashboard. A newly promoted ordinary-file signing guard also exposed a legacy operator ID-preview compatibility risk; repair that with a separate authorized short-lived reviewer path while keeping ID reuse in avatars/messages blocked.

## Fabrications found

No simulated payment is presented as an actual transfer or paid refund. A successful export does not prove live CDN contents; verify every remote chunk against the frozen artifact after publishing.

## Deliberately not changed

Owner dashboard design, provider billing plans, real payment integrations, student identity rules, saved-material or whiteboard access grants, and the new make-up runtime.

## Remaining risks / next pickup point

Operator-preview focused checks passed, including disabled/password-reset operators, legacy citizenship review and fail-closed message initialization. Physical iOS/Android and two-device live media were not tested by these browser gates. The follow-on make-up release is being assembled on codex/production-makeup-workflow-sep30 and is not enabled by this regression release.
