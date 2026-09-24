# Support knowledge library and payment evidence

- Date: 2026-09-24
- Agent: Codex
- Branch: codex/support-investigation-sep24
- Base commit: db68eec
- Status: implemented, verified and deployed to Preview only

## Requested
Continue with the reviewed knowledge base and payment-evidence workflow. Keep production support paused; no purchases, AI refunds or bans.

## Changed
- Ten versioned, source-linked starter guides. Admin-only transactional import creates drafts, skips existing slugs, never overwrites edits or publishes. Imports are audited. Existing review/publish/archive controls remain authoritative.
- Help Library gets import, search and a pre-publication checklist in its responsive editor. Modified articles do not claim unchanged starter provenance.
- Selected lesson context reads only the requesting student's enrollment, matching frozen batch test receipt and own lesson refund rows. References, operator notes, other students' records, and platform shares are excluded. Teacher context does not expose student finances.
- Pure payment interpreter distinguishes test/SIM records, course total versus lesson allocation, refund owed versus locally marked paid. No provider settlement claim or money mutation.
- Linked payment investigations skip asking for the class again. Bounded human summaries preserve financial/abuse uncertainty disclaimers even when clipped.

## Decisions and assumptions
The first payment evidence slice covers session-linked enrollment/refunds and batch simulation receipts. It is not provider reconciliation, aggregate teacher earnings, recurring refunds without a lesson, or all historical learning-program shadow ledgers. Those need explicit mapping rather than guessed joins.
Starter answers are drafts until an operator reviews and publishes. No new policy, refund deadline or guarantee is introduced. Existing server-side editor roles and audit trail are reused.

## Verification
Pure payment/content/investigation tests: 13/13 locally. Source-reference existence is tested. Design lint passes without baseline changes. Final clean-install support CI `35964763770` passed on `afe4ddf`: 730 unit tests, 60 support API checks, full typecheck, design lint and 128 browser checks. Rendered settled-sheet and expanded-record screenshots inspected at 390/1440 widths. This is Chromium, not physical iOS Safari.

Railway's `HomeTuition - hometuition-api-staging` status succeeded for exact app commit `afe4ddf`; staging `/api/readyz` returned `{ "status": "ok" }` again after deployment. Full Preview run `35964770408` succeeded, including real two-person LiveKit, speaking-floor, navigation, whiteboard and phone checks. The Cloudflare skill informed strict staging API/bundle isolation; deployment used the existing gated workflow, not manual uploads.

Preview Worker version `62a5c114-e374-45fb-b3a7-14d3e04944e3` deployed at 2026-09-24 06:47 UTC. The workflow verified served HTML and all three exact initial bundle hashes against the tested build and staging-only API. An independent GET returned the new `entry-db8e3ac82e9348194d684be2ea1889e0.js` and common chunk `54ffe9708c5a618a26c8f8841f9a28da`. Remote production main remains `c7b1017`; no production deployment was triggered.

## Problems and surprises
Long payment records exposed an unconditional transcript scroll: expanding checked facts moved the facts out of view. Scrolling now follows new messages only, with resets for account/conversation changes. Long-record expansion is covered at phone/laptop sizes (128 local browser checks). Preview run 35963882084 was cancelled before frontend deployment to include this fix.
Local API typecheck still lacks jose/livekit-server-sdk in the shared dependency tree; use clean-install CI, not a false green. Initial browser bundling was blocked by Windows sandbox directory access; rerun with approved escalation reached and passed the new phone checks.

## Fabrications found
No new invented facts. Explicitly prevents treating legacy paid SIM enrollment or a locally marked-paid refund as independent provider confirmation.

## Deliberately not changed
Production, provider credentials/billing, classroom follow-ups, live user records, refunds/payouts/bans, recording/vision analysis. No auto-publication of starter content.

## Remaining risks / next pickup point
The ten starter guides are available to import as private drafts, but were NOT imported or published in a live database during this turn. Operator review/publication remains pending. Use the acceptance checklist in `docs/FADKO-SUPPORT-FREE-FIRST-2026-09-24.md`. Evaluate real provider answers separately and complete provider/payment reconciliation before claiming full automation. Groq remains unactivated by this work; no credentials, paid fallback or external evidence analysis added.

App source deployed: `afe4ddff3f48788307dbd1fd33c521b4ba1a0b90`. Later handoff/documentation-only commits on the support branch do not advance the Railway staging branch or redeploy the app. Status watcher had one local TLS timeout; a subsequent API read verified the workflow continued successfully. No tests were bypassed.
