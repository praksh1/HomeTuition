# LiveKit classroom pilot — Codex review

- Date: 2026-09-07
- Reviewed branch: `origin/claude/livekit-classroom-pilot`
- Reviewed head: `ed3267f`
- Review branch: `codex/learning-program-foundation` (documentation only)
- Status: **changes requested; do not merge or deploy**

## Scope discipline

This review pauses the Learning Program implementation. The LiveKit authority/floor pilot is being
reviewed as its own track. No payment, program schema, production provider, merge or deployment is
part of this review.

## What was verified

- Read Claude's stage-two and stage-three worklog and the complete changed-file inventory.
- Read the authority path beginning with `floorProtocol.ts`, then `classroomFloor.ts`,
  `speakingFloor.ts`, `livekitProvider.ts`, the hub lifecycle, entitlement and discussion clock.
- Ran the narrow pushed-branch tests without editing the branch:
  - server discussion/floor/authority tests: 101 passed, 0 failed;
  - app floor-offer/discussion-layout tests: 45 passed, 0 failed.
- Confirmed the default student token denies publishing and that the empty-source-list safeguard is
  present in both the state translation and LiveKit provider adapter.
- Confirmed identity and teacher authority come from the authenticated classroom socket rather
  than a client-supplied actor id.

## Blocking findings

### 1. Starting the class empties the lobby roster

`resetBoardFor()` calls `resetFloorFor()` and then `tellEveryone()`. `resetFloorFor()` calls
`endSession()`, which clears `floor.students`, and also clears `state.names`. It never reconstructs
the floor from the clients who are still connected in the lobby.

Consequences:

- the teacher's participant list becomes empty when the class starts;
- `invite_all` and `mute_all` operate on no students until each student performs another action;
- a student who later asks is recreated through the room-membership predicate, but their name map
  was cleared, so the teacher can see the generic name “Student”;
- the passing two-browser journey does not cover the roster/name or invite-all state immediately
  after start.

Required proof: start with multiple named students already connected, start the class, then assert
that all remain present and named and that Invite all/Mute all affect every one without requiring a
reconnect or prior hand raise.

### 2. The screen can claim a provider decision that never applied

`pushRights()` and `silenceThem()` discard their promises. `handleFloorFrame()` mutates the floor,
starts/stops its evidence timer and tells clients immediately. A failed provider call only produces
a log warning; there is no retry, rollback or visible pending/failed state.

Consequences:

- a student may be told they can speak while LiveKit still refuses them;
- a teacher may be told a student is muted while an already-open track remains audible;
- the comment saying “the provider catches up” is not implemented because failures are never
  retried;
- the end-to-end UI test proves socket state, not provider acknowledgement.

The correction must distinguish an absent participant from a provider failure. An absent student
can safely retain a server-side grant because their token starts locked and reconnect pushes the
grant. A real provider failure must not be presented as completed. Permission revocation must fail
closed and surface/retry any failure to stop a live track. Add deterministic failure, delayed
acknowledgement and partial-failure tests.

### 3. “Speaking time” is not speaking time

`trackSpeaking()` starts from floor permission plus the student's accepted switches. It does not
observe a published audio track, provider acknowledgement, audio activity or media telemetry. It
can therefore write `classroom.floor.spoke` even when permission application or local media failed
and no sound was transmitted.

This is useful intent/permission evidence, but it must not be called or summarized as actual
speaking. Rename/reclassify the event as permission/attempt duration, or wait for provider-confirmed
track evidence before recording speech. A refund narrative must never treat it as proof of speech.

### 4. The discussion can start after the booked class has ended

`discussionWindow()` opens at booked finish minus 20 minutes but closes at the classroom hard
cutoff, which is 10 minutes after booked finish. This creates a 30-minute activation window and
allows the teacher to start Discussion Mode during overtime. The owner's rule was activation in
the final 20 minutes **before the session end time**.

Use the booked scheduled finish as the activation close. Separately decide whether a discussion
already underway may remain visible during classroom overtime; do not let that separate grace rule
make a new discussion startable after the paid slot.

## Explicitly not judged yet

- Real LiveKit Cloud media, Kathmandu latency, cheap Android behavior and iPhone behavior remain
  untested.
- Sending-side camera cap is a later cost/product decision. It is not a reason to mix payment or
  Learning Program work into this correction.
- The legacy Monthly entitlement cannot prove per-cycle payment, renewal, reversal or paid-through
  state. Keep the pilot disabled and unmerged until the commercial model has an honest source for
  this entitlement or the owner explicitly accepts a temporary test-only rule.

## Next action

Claude should correct only these four findings on `claude/livekit-classroom-pilot`, add the missing
tests, rerun its narrow gates, commit and push. Codex then re-reviews. The Learning Program schema
task stays queued and must not start until this pilot review is closed.

## Re-review of Claude correction `1c33c58`

- Fetched and inspected `origin/claude/livekit-classroom-pilot` at `1c33c58` without merging it.
- Confirmed that the original four findings were materially addressed:
  - class start now clears prior lesson authority and rebuilds connected lobby students and their
    database-sourced display names;
  - provider operations expose pending/failed state, bounded retries and UI explanations;
  - the evidence event is now `classroom.floor.held`, explicitly marked
    `speechConfirmed: false`;
  - Discussion Mode cannot be activated after the booked finish.
- Confirmed `git diff --check` is clean for `ed3267f..1c33c58`.
- Did **not** merge, deploy or change a provider.

### New blocking finding 5: an absent media participant is accepted too early

`applyRights()` clears its pending state for both `applied` and `absent`. That is safe for a
revocation, but not for a grant. The classroom WebSocket and LiveKit media connection are separate.
A student can already be present in the Fadko classroom socket while their LiveKit participant is
not yet in the SFU room. If the teacher grants the floor during that interval, LiveKit answers
`absent`; the server displays the grant as healthy and never retries. When the student's media
connection arrives, their original token still permits publishing nothing. `floorJoin()` cannot
repair this because it is a classroom-WebSocket join hook, not a LiveKit participant-connected
hook.

Required correction: treat `absent` as success only for a deny/revoke/silence operation. A grant
for an absent participant must remain pending and retry for a bounded period, or be reapplied from
a trustworthy LiveKit participant-connected signal. Test the actual ordering: classroom socket
connected -> teacher grant -> provider absent -> media participant appears -> permission becomes
applied without another hand raise or classroom reconnect.

### New blocking finding 6: stale async answers can erase a newer instruction

Provider synchronization is keyed only by `kind:userId`. `beginSync()` replaces the map entry, but
the earlier promise retains no generation/request identifier. If a teacher acts twice quickly,
responses may arrive out of order. An older success can call `clearSync()` and delete the pending
state for a newer instruction; an older failure can call `markFailed()` and retry after a newer
success. The UI may therefore report `ok`, or the retry may apply obsolete authority, even though
the provider's final state does not match the latest floor decision.

Required correction: give every provider instruction a monotonic generation/operation id and
ignore completions, failures and timers that no longer match the current generation. A retry must
recompute current desired rights but must also belong to the current generation. Add deterministic
deferred-promise tests for grant -> revoke with responses resolved in both orders, and for an old
retry firing after a newer action.

### Re-review disposition

`1c33c58` is a substantial and useful correction, but the pilot remains **changes requested; do
not merge or deploy** until findings 5 and 6 are fixed and independently reviewed. This does not
invalidate the Chinese-platform research or the separate Learning Program foundation; both remain
parked while the LiveKit track is closed cleanly.

## Final re-review of Claude correction `387beca`

- Fetched and inspected `origin/claude/livekit-classroom-pilot` at `387beca` without merging it.
- Finding 5 is closed: a positive grant that reaches an absent LiveKit participant remains
  unconfirmed, while an absent revocation remains safely complete. The web LiveKit adapter emits a
  payload-free `floor_media_ready` nudge on connection/reconnection; authenticated socket identity
  and server-owned floor state determine the reconciliation, with per-student rate and count
  bounds.
- Finding 6 is closed: provider writes are serialized per participant. Floor changes advance a
  desired revision, only one remote write is issued at a time, and a superseded completion causes
  the latest server-derived state to be reconciled. Permission revocation precedes track silence,
  and a newer grant clears an obsolete silence requirement.
- Reviewed the focused deferred-response tests added for absent arrival, coalescing, stale
  completion, stale retry and grant-after-silence orderings. Claude reports those tests produced 14
  failures when run against `1c33c58` and 134 passes against `387beca`.
- Independently confirmed `git diff --check` is clean for `1c33c58..387beca`.
- Independently ran package-level TypeScript checks on Windows:
  - `artifacts/api-server`: pass;
  - `artifacts/sikshya`: pass.
- The focused server test harness could not run in this Windows checkout because its dynamic import
  passes a drive-letter path directly to Node's ESM loader (`ERR_UNSUPPORTED_ESM_URL_SCHEME`). The
  rendered UI harness could not run because Playwright is not installed here. These are review
  environment limitations, not product failures, and are recorded rather than represented as
  independent test passes.
- The root `pnpm run typecheck` is not reliable on this Windows path: its recursive artifact filter
  matched no projects. Package-level checks above were run explicitly to avoid a false pass.

### Final disposition

The six code-review blockers are closed. `387beca` is acceptable as **disabled LiveKit pilot
scaffolding**. It is not evidence that LiveKit Cloud or real phones work: Cloud error shapes,
Kathmandu latency, weak-network behavior and the media-ready lifecycle on hardware remain
unverified. Production should continue to default to Daily. Do not enable LiveKit for real users
or attach commercial entitlement until the Cloud/device trial and missing paid-through facts are
resolved.
