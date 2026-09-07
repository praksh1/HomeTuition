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

