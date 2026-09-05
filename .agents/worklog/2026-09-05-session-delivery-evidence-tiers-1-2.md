# 2026-09-05 — Session delivery evidence, Tiers 1–2

## Owner request

Design a reliable, low-cost way to establish whether a class occurred, whether the teacher was
present, and whether connectivity failed, without removing Daily or recording every lesson.
Work in parallel with Claude and preserve a detailed handover.

## What Codex did

1. Read the standing project documentation and audited the existing evidence path:
   `session_participation`, `classroomHub.ts`, `participation.ts`, `sessionEvidence.ts`, the
   attendance route, the operator ticket view, `REFUNDS.md`, and `VIDEO.md`.
2. Confirmed that the current ledger records the Sikshya classroom WebSocket, not Daily media
   attendance. This is useful but insufficient as a single source for a refund decision.
3. Wrote the four-tier design and privacy/cost reasoning in
   `.agents/backlog/2026-09-05-session-proof-of-delivery.md`.
4. Added the dependency-free `evidenceCoverage.ts` contract. It distinguishes unavailable,
   partial and available sources; requires independent socket/provider readability for a normal
   human review; and reports contradictory teacher-presence observations. It never returns a
   refund or payout verdict.
5. Added 12 focused tests for unavailable-versus-zero, partial evidence, contradictions,
   just-joined presence, malformed numeric input, optional quality evidence, and the rule that
   board/chat activity cannot replace media presence.
6. Deliberately disabled contradiction classification once. Three tests failed with the wrong
   `sufficient_for_human_review` result. The guard was restored and all 12 passed. This proves
   the new assertions can detect removal of the protection.
7. Assigned Claude Tiers 3–4 on a separate branch: signed Daily webhook evidence, coarse network
   quality, provider-independent aggregation, operator timeline, retention design and tests.

## Verification

- Focused evidence coverage tests: 12 passed, 0 failed.
- Deliberate-break run: 9 passed, 3 failed as expected; restored afterwards.
- API unit suite: 304 passed, 1 failed. The failure is unrelated to this change:
  `socialIdentity.test.ts` cannot resolve the already-declared `jose` package in this local
  OneDrive dependency installation.
- API typecheck: blocked by the same pre-existing local `jose` resolution problem in
  `socialIdentity.ts`.
- `pnpm install --offline --frozen-lockfile` reported the workspace already up to date and did
  not repair that local filesystem/package-resolution issue.
- `git diff --check`: clean.

## What Codex did not do

- Did not modify the database schema or run `db:push`.
- Did not add or configure a Daily webhook, secret, room, recording, or dashboard setting.
- Did not deploy, merge, alter production, or change refund/payment business logic.
- Did not capture audio, video, raw WebRTC statistics, lesson content, or personal documents.
- Did not remove or replace Daily.
- Did not claim that socket presence proves teaching quality or usable media.

## Problems and decisions

- The existing `drawCount` and `messageCount` are useful context but are not strong proof by
  themselves: the hub can count replayed/stale scene frames or invalid chat attempts. They must
  not drive refund or payout decisions alone.
- Camera-off and silence are not evidence of failure; low-bandwidth teaching may intentionally
  use audio-only, screen share, or the board.
- Fine-grained evidence should be retained for 30 days, then rolled up/deleted only after the
  owner settles the dispute/appeal timetable and a safe tested job exists.
- Universal cloud recording is rejected as the default on cost, privacy, consent and child-
  safety grounds. Selective consent-based recording remains a possible escalation later.

## Next handoff

Review Claude's isolated branch before any merge. Verify signature handling, identity/session
mapping, idempotency, rate limits, unavailable-vs-zero rendering, new-table boot DDL parity, and
that telemetry failure cannot interrupt a live class. No production schema/deploy should occur
until that review and an explicit deployment plan are complete.
