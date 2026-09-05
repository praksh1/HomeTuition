# Session proof of delivery — low-cost, recording-light design

Status: Tiers 1–2 started on `codex/session-delivery-evidence`. Tiers 3–4 assigned to Claude on
the isolated branch `claude/session-proof-provider`. Nothing in this document authorizes an
automatic refund decision, a production schema push, recording, or a Daily replacement.

## Recommendation

Do not record every lesson. Build a **proof-of-delivery timeline** from two independent facts:

1. Sikshya's authenticated classroom socket proves who had the classroom open, for how long,
   how often it reconnected, and whether accepted whiteboard/chat activity occurred.
2. Daily's signed server webhooks prove whether the media provider saw the teacher/student join
   and leave the actual call. Coarse client network-quality changes add context, but are not
   trusted on their own.

This is kilobytes per class rather than hundreds of megabytes of video. It can be retained for
30 days cheaply in Postgres, then fine-grained events can be deleted after producing a durable
summary. A human operator sees facts and disagreement between sources; software does not decide
whether a teacher taught well or whether a refund is deserved.

Never infer failure from camera-off, silence, or an unused whiteboard. Camera-off is a rational
bandwidth choice in Nepal; a teacher may explain verbally or share a screen. Conversely, a
socket being open does not prove Daily media worked.

## What exists today

- `session_participation`: first/last seen, total present milliseconds, connection count,
  whiteboard-write count and class-message count per user/session.
- `classroomHub.ts`: batches the above every 30 seconds and on disconnect without risking the
  live class when a database write fails.
- `sessionEvidence.ts`: factual, human-readable findings for missing/late/early/unstable
  attendance and absent students. It deliberately produces no verdict.
- The operator ticket view already brings attendance, findings and the persisted class thread
  together.

Important limitations: this is classroom-socket evidence, not media-call evidence. Before this
branch, board/chat counters could also be inflated by replayed or invalid frames; Tier 2 now
counts only accepted scene changes and non-empty messages. Even corrected counters must never
decide a payout alone. `startedAt`/`endedAt` are app actions, not provider facts.

## Tier 1 — evidence and policy contract (Codex)

- Preserve human review and the distinction between `unavailable` and a proven zero.
- Rank trust: signed provider event and authenticated server socket are primary; client quality,
  board and chat are supporting context; user allegations/attachments are claims for review.
- Outcomes from telemetry are only `sufficient_for_human_review`, `incomplete`, or
  `contradictory`. None means refund approved/denied.
- Keep evidence purpose-limited to delivery, connectivity and dispute handling. Do not capture
  lesson content.

## Tier 2 — provider-independent coverage classifier (Codex)

`api-server/src/lib/evidenceCoverage.ts` is a dependency-free contract with pinned tests. It
requires the classroom socket and media provider to be independently readable, detects the
basic contradiction where one saw the teacher and the other did not, and reports optional
network gaps without treating them as absence. It is intentionally not wired to production
until provider evidence exists.

The classroom hub now also refuses to count stale/replayed scene versions and blank/malformed
chat frames as evidence. The existing attendance integration suite includes both cases.

## Tier 3 — signed provider evidence (Claude, isolated)

- HMAC-verify Daily webhook events for meeting start/end and participant join/leave.
- Normalize the minimum facts into a new append-only table; unique provider event id makes
  retries idempotent. Never retain the full webhook or a secret.
- Map Daily token `user_id` and room identity to the app session/user server-side. Unmatched or
  forged identities stay unmatched rather than being guessed.
- Fail isolated: a telemetry/database problem must never terminate a class.

## Tier 4 — quality context and operator timeline (Claude, isolated)

- Record changes in `good`/`warning`/`bad` quality as coarse buckets, not continuous raw WebRTC
  statistics. Bound and rate-limit client input; label it client-reported.
- Show socket/provider spans, reconnects, quality buckets, board/chat counts, evidence source,
  gaps and contradictions in the operator's existing session/ticket view.
- Add an explicit 30-day purge/roll-up function and tests, but do not schedule or run destructive
  production deletion yet.

## Recording escalation, not default

If evidence is contradictory or a serious conduct complaint requires content evidence, allow a
future **consent-based, operator-visible recording mode** for selected sessions only. Show a
clear recording indicator and require guardian/participant consent where applicable. Prefer
audio-only if the complaint type permits it; never silently record minors.

Daily's published September 2026 rate is `$0.01349` per cloud-video recorded minute, plus an
additional storage rate of `$0.003` per minute. Recording 45 classes of 90 minutes is 4,050
recorded minutes, about `$54.63` per teacher-cycle before storage. That alone can exceed the
proposed NPR 6,500 monthly-plan revenue, so universal recording is economically unsound.

Primary references:

- Daily webhook events and HMAC verification: https://docs.daily.co/reference/rest-api/webhooks
- Daily participant-left payload (duration and network-quality state):
  https://docs.daily.co/reference/rest-api/webhooks/events/participant-left
- Daily meeting records: https://docs.daily.co/reference/rest-api/meetings/get-meetings-meeting
- Daily call quality events: https://docs.daily.co/reference/daily-js/daily-call-client
- Daily recording/storage pricing: https://www.daily.co/pricing/video-sdk/

## Refund-decision guardrails

1. Obvious objective failure (for example both independent sources available and neither saw
   the teacher) may be *recommended* for expedited human handling, not silently paid.
2. Contradiction or incomplete evidence always goes to a person. Absence of telemetry is never
   evidence against either party.
3. Connectivity evidence explains what happened; it does not assign fault. A regional/provider
   outage, teacher line failure, and student line failure need separate handling.
4. A student's complaint and teacher response remain part of the record. Telemetry cannot judge
   teaching quality, harassment, or whether lesson content matched the listing.
5. The operator decision must state which facts were relied upon and remain appealable.

## Still not done

- No database table, webhook secret, Daily dashboard configuration, production deploy, purge job,
  refund automation, recording, or media-provider replacement has been made by Tiers 1–2.
- Nepal privacy/child-consent language and the payment/refund legal model still need qualified
  local review before launch.
- Fine-grained retention should be finalized with the dispute window. Thirty days is the current
  product target, not a legal conclusion.

## Tier 5 — operator case narrative (Codex, first slice built)

The ticket detail now receives a deterministic narrative for its unique session ID and a separately
inspectable timeline. It translates existing records into sentences about creation, the current
listing, schedule changes, bookings, persistent pre-class messages, start/end timing, attendance,
reconnections, whiteboard changes and classroom chat. Payment references are labelled as stored but
not independently reconciled. Test access is explicitly not a payment.

The operator page also lists what the record cannot yet answer. Follow-up instrumentation should be
split into reviewed additions, not inferred from existing counters:

1. Message read receipts for private and class threads, with one receipt per user/message.
2. Coarse Daily/app media state transitions: camera, microphone and screen share on/off, without
   storing media or raw WebRTC statistics.
3. Whiteboard semantic events: first accepted change, clear action and tool category, without
   storing lesson content twice.
4. Payment-provider reconciliation that verifies a stored reference against the gateway before the
   operator screen calls it confirmed.
5. Correct the two blockers in `claude/session-proof-provider` before integrating provider evidence:
   participant deduplication by event type + provider participant session ID, and retention that
   waits until a meeting instance can be aggregated whole.
