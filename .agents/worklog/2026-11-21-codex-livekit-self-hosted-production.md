# LiveKit branch based on Production

- Date: 2026-11-21
- Agent: Codex
- Branch: codex/livekit-self-hosted-production
- Base commit: f9b0506f3d424e4aeaf0f86366eab4bfa8722432
- Status: in progress

## Requested

Continue self-hosted LiveKit in a new branch based on the Production branch and keep it current as Production changes. Preserve portability to an India or Singapore server.

## Changed

Imported the reviewed dependency-free renderer, ordinary-path checks and Linux preflight under ops/livekit-self-host. Added an exact source-base receipt and offline package regression checks. Added a public standard-runner workflow using installed Node. Guarded the inherited deployment jobs and isolated disabled runs' concurrency groups.

## Decisions and assumptions

Railway's Production API is configured for praksh1/HomeTuition main. The local branch began with the exact main commit and tree. The latest deployment is a redeploy whose metadata omits its source commit. The last explicit API source SHA matches this main commit. Served frontend revision still needs provider-level confirmation. These limits are recorded in production-base.json.

Production updates will be merged into the feature branch through a serialized synchronization check. Every resulting candidate needs its own verification. Conflicts, rollback, release-source changes and new workflow triggers need reconciliation.

## Verification

Initial feature branch tree matched Production main 112ac0b83bf62fcd6b747840f21bb0a3c62541cb with a clean sparse checkout. The copied source files retain the prior reviewed SHA-256 values. Seven new offline package checks passed at 2026-11-21T06:17:36.8656100Z through 06:17:37.9839903Z, measured 1105 ms, exit 0. These exercise only synthetic configuration and mocked host observations. The tested source hashes are preserved in the standalone changeset. Final publication evidence is recorded separately after the push.

## Problems and surprises

The connected GitHub integration returned 403 for branch creation. The browser runtime failed on the configured E: sandbox path. An existing normal Git sign-in passed a dry run targeting only this new feature branch.

Independent review found that a skipped deployment job could still cancel a legitimate run through its shared concurrency group. The branch now isolates those disabled dispatches. The review also tightened the exact route, IPv4 and TURN assertions.

## Fabrications found

None found. productionReady remains false while application, native and public media acceptance is pending.

## Deliberately not changed

Scope is the new feature branch, portable media configuration, verification and synchronization setup. Production release and the active supervisor's Dallas runtime remain separate assignments.

## Remaining risks / next pickup point

Publish the reviewed branch and record its exact CI result. Automatic approval review twice rejected the separate active 15-minute synchronization heartbeat because that scheduling interval requires explicit owner approval. No heartbeat was created. The direct owner request authorizes synchronization, while its persistent scheduling setup remains pending approval. Then integrate explicit authorized room generations, End and stale-token handling into this Production-based application and qualify web/Android media on the actual candidate. The infrastructure package alone does not implement classroom admission or native LiveKit.

## Published branch and CI follow-up

Commit 00e14808bdacd3de1ae9e68d17949e7473fbbb50 was published through the existing normal Git sign-in. GitHub independently confirmed one commit ahead of main, zero behind, and the exact eleven-file scope. Package CI run 44875209902 passed all seven checks on Ubuntu 24.04, including main ancestry.

The successful run reported a deprecated Node20 runtime in the newly added checkout action. The branch-specific check now pins official actions/checkout v7.0.1 at 3d3c42e5aac5ba805825da76410c181273ba90b1, which uses Node24. The correction requires another exact-head CI result. Main's existing deployment workflow is outside this runtime correction.

Recurring synchronization remains pending explicit schedule approval after automatic review rejected the separate 15-minute heartbeat. No schedule is active for this branch.
