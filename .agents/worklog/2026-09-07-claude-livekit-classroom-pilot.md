# LiveKit classroom pilot — the authority layer

- Date: 2026-09-07
- Agent: claude
- Branch: `claude/livekit-classroom-pilot`
- Starting commit: `a58f23f` (origin/main)
- Final commit: `f443451`
- Status: **partial — the server-side authority layer is built and tested; the classroom UI and
  the socket wiring are not.** Read "What was deliberately excluded" before reviewing.

## Requested

Continue the LiveKit pilot as an isolated, reversible, no-purchase project: branch fresh from
current `main`, integrate the two LiveKit commits it lacked, then build a teacher-led classroom
with speaking requests, teacher moderation, and a Monthly-plan-only Discussion Mode in the final
twenty minutes — with every media permission server-authorised, provider-neutral evidence, and
Daily untouched as the production fallback.

## What was implemented

### Branch integration

`claude/livekit-classroom-pilot` branches from `a58f23f` and merges `claude/livekit-trial`. The
merge touched **none** of main's newer work — the Fadko welcome identity, the student monthly
journey, the preview CI pin and the monthly release checks all arrive unchanged. Every path in
the merge is either a LiveKit file or a document about one. No conflicts arose, so no conflict
resolution was needed; the file list in `19ac60f` is the evidence.

### The publishing door was open, and is now shut

**The single most important change.** Every LiveKit token said `canPublish: true`. The classroom
stayed orderly because the app did not draw a microphone button for students — which protects
against a student who behaves and against nobody else. A browser console was enough to publish
into a lesson.

- A student's token now carries `canPublish: false` and an empty `canPublishSources`. Both,
  because they are separate protocol fields and an SDK that read one without the other must
  still refuse.
- The teacher's token is unchanged.
- Permission is granted afterwards by the server through `RoomServiceClient.updateParticipant`,
  in `livekitProvider.setPublishing` — not by minting a second token, which would mean handing a
  client a fresh credential, asking it to reconnect mid-lesson, and leaving the old one valid.
- `livekitProvider.silence` mutes tracks that are already live, because revoking permission
  stops somebody publishing *again* and does not by itself close an open microphone.

Worth recording: **`roomAdmin` is not part of `ParticipantPermission` at all**, so a permission
update is structurally incapable of making somebody a moderator. The compiler rejected an earlier
version that set it defensively. That is a better guarantee than the one being written.

### `lib/classroom/speakingFloor.ts` — the decisions, pure

The whole authority model as one pure state machine: ask to speak, cancel, teacher accept or
dismiss, per-student mute / stop camera / return to audience, mute all, invite all, discussion
mode, disconnect and reconnect. No database, no network, no clock of its own.

Pure for the reason `lib/monthly.ts` is pure and says so: a rule about what people are allowed,
which can only be exercised against a live room and two browsers, is a rule nobody runs.

Two design points a reviewer should check rather than assume:

- **Permission is never activation.** Granting a microphone moves a student to `allowed`; their
  device stays shut until they accept. A teacher who can silently open a child's microphone is a
  surveillance feature, and the brief asked for "invite all to speak", not "unmute everyone".
- **Nine media states, not a boolean.** "Muted by self", "muted by teacher" and "never allowed"
  are three different situations and a student behaves differently in each.

### `lib/classroom/discussionWindow.ts` — the timing, pure

The window is the last twenty minutes of the **booked** slot, joining the existing timeline in
`lib/sessionStart.ts` rather than starting a second one. A late teacher gets a shorter discussion,
not a later one. `now` is a parameter every caller fills with the server's clock; there is no
implicit `Date.now()` to fool with a device setting.

### `lib/classroom/discussionEligibility.ts` — Monthly, derived

`recurring_days` → `recurring_sessions` → `teacher_plans`, requiring `status = 'active'` and a
non-null `cycleAnchor`. No `isMonthly` column was added: a flag can be set once and be wrong
forever after a plan lapses, while the join is right every time it is asked. Returns a *reason*
as well as a boolean, because "this was pay-as-you-go" and "the teacher's plan had lapsed" look
identical from outside and mean opposite things in a refund argument. Fails closed on a database
error.

## Files changed

| File | What |
|---|---|
| `src/lib/classroom/speakingFloor.ts` | new — the authority state machine |
| `src/lib/classroom/speakingFloor.test.ts` | new — 35 tests |
| `src/lib/classroom/discussionWindow.ts` | new — the twenty-minute rule |
| `src/lib/classroom/discussionWindow.test.ts` | new — 9 tests |
| `src/lib/classroom/discussionEligibility.ts` | new — server-derived Monthly |
| `src/lib/video/livekitProvider.ts` | token tightened; `setPublishing`, `silence`, `httpsFrom` |
| `src/lib/video/types.ts` | `PublishRights`; optional `setPublishing` / `silence` |
| `scripts/video-tests/run.mjs` | asserts the new permission model |
| `sikshya/scripts/livekit-live/run.mjs` | rewritten for the classroom; grant/revoke phase added |
| `HANDOVER.md` | §8.6 marked superseded — modelled at 45 students, not 10 |

## Tests and exact results

Distinguishing what each kind of run actually proves:

**Unit-tested** (pure, no server): api-server 497 pass / 0 fail — including 35 new speaking-floor
and 9 new discussion-window tests. App 258 pass / 0 fail.

**Server-tested** (real Postgres, real API process): video contract 43/43, session 56/56,
session-proof 125/125, retention 79/79.

**Browser-tested** (real Chromium, faked provider): LiveKit component 82/82, whiteboard 44/44,
call-chat 17/17, call-leave 9/9.

**Local LiveKit server-tested** (real SFU built from source, real media): `livekit-live` 41/41,
including the new grant/revoke phase — the server grants a student the floor mid-call, the
teacher then decodes their camera, and the permission is taken back again.

**LiveKit Cloud-tested:** none. No account, no credentials, no purchase — as instructed.

**Real Android / iPhone-tested:** none. Not attempted.

Also: `pnpm run typecheck` clean across four packages; `lint:design` unchanged at 111 hex /
338 sizes; `git diff --check` clean.

### CORRECTION: those two suites were never broken — I ran them wrongly

**Recorded 7 September 2026, second stage. The claim below this line was wrong and is retained
so the mistake is legible.**

~~`scripts/one-chat` and `scripts/teacher-leave` both fail on `recurring_days` fixtures... not
caused by this work.~~

Both suites **pass**. They drive an externally-started API and need it running with
`NODE_ENV=test`, which is how `.github/workflows/deploy-web.yml` has always started it. I started
mine without it. `lib/payments.ts` then correctly refused the teacher-plan purchase — no provider
is configured, so a non-test server must not activate a plan it took no money for — the suites
discarded that response, and the run died four steps later on a `recurring_days` query reading
`recurring_id = undefined`.

Running them against untouched `main` reproduced it because I made the same mistake there, so the
worktree check confirmed my error rather than the code's. **A comparison run only proves
something when the one variable you did not think about is held constant too.**

No fixture was stale and no production logic needed changing. What was real: a misconfiguration
that surfaced four steps downstream as a SQL syntax error. `scripts/test-support/apiMode.mjs` now
makes it announce itself at the point it happens, and both suites check the response they were
throwing away. Verified by pointing `one-chat` at a non-test API and reading the explanation.

Results with the API started correctly: `one-chat` 8/8, `teacher-leave` 17/17.

## Failures and corrections during the work

- **The live-call suite failed the moment the token was tightened** — the teacher decoded zero
  frames from the student. That was the change working. The suite had been asserting the old
  model and now asserts the classroom, with the reason written into it.
- **The video contract suite asserted a student could publish camera and microphone**, and
  passed, because every token said so. Corrected to assert the opposite.
- **A `.ts` extension was needed** on `discussionWindow.ts`'s import of `sessionStart`, because
  `--experimental-strip-types` cannot resolve extensionless relative imports. The api-server
  tsconfig already turns `allowImportingTsExtensions` on for exactly this, and `mailer.ts`
  already does it.
- **`roomAdmin` in a permission update did not compile** — see above; the finding improved the
  code and the comment.
- **A greedy text edit** to the live suite swallowed a later section it then could not find.
  Redone bottom-up.

## What was deliberately excluded — read this before reviewing

**This branch does not yet contain a working Discussion Mode a person can press.** What exists is
the layer every button would have to go through. Specifically not built:

1. **Socket wiring.** `ws/classroomHub.ts` is untouched. Ask-to-speak, the teacher queue, mute
   all, invite all and discussion start/end have no message types yet, so nothing reaches the
   floor state machine at run time.
2. **The room route** does not yet return `discussionModeEligible` or the window state.
3. **Every screen.** No "Ask to speak" button, no teacher queue, no consent prompts, no
   discussion UI, no media-state labels in the interface.
4. **Selective subscription and adaptive rendering** — the four-tile phone cap, 180p thumbnails,
   360p active speaker, screen-share prioritisation. The existing simulcast, adaptive stream and
   Dynacast settings are preserved and untouched; the discussion-specific policy is not written.
5. **Evidence events.** No new event types are recorded. The existing session-proof architecture
   is untouched and still passes.
6. **Browser tests for the classroom flow** — requirements 32–34 and 36–37 are not covered,
   because the features they test do not exist yet.

Nothing here is stubbed or faked to look finished. The absent parts are absent.

## Remaining simulated behaviour

- The floor state machine holds state **in memory**, as the whiteboard does. A client reconnect
  restores the true server state, which is what the brief requires; a **server restart** would
  lose it, the same known gap `classroomHub.ts` already has for board state.
- `livekitProvider.setPublishing` and `silence` have been exercised against a real local SFU
  through the identical SDK calls, but not yet through a Fadko route, because no route calls
  them yet.

## Security review

- Students cannot publish: enforced in a signed token, asserted in the video contract suite by
  decoding the JWT rather than by reading the UI.
- Moderator rights come only from `isOwner`, which comes only from `lib/membership.ts`. A
  permission update cannot grant them — the protocol has no field for it.
- Nothing in the new code reads a role, header or flag a client could set.
- `LIVEKIT_API_SECRET` is unchanged in handling; the live suite still asserts it appears in no
  response body and inside no decoded token.
- Class-cutoff token expiry is preserved.
- Discussion eligibility fails closed on any error.

## Production behaviour confirmed

`VIDEO_PROVIDER` is untouched and still defaults to Daily. Daily's provider file is unchanged;
it does not implement `setPublishing` or `silence`, which are optional on the interface
precisely so a provider that cannot enforce a permission is never made to look as though it did.
Phones still receive Daily. Nothing was deployed, merged, purchased or enabled.

## Exact next action for Codex

1. **Review the authority model in `speakingFloor.ts` before any UI is built on it.** If the
   state machine is wrong, everything above it is wrong. The 35 tests state the intended rules
   in English.
2. **Decide the lapsed-plan question, which I refused to invent.** When a teacher's plan lapses
   mid-cycle, should a class already on the calendar keep its discussion? `discussionEligibility`
   currently answers no — the conservative direction, because it cannot give away something
   unpaid for. That is a commercial rule and belongs in `lib/monthly.ts` with the others.
3. **Then wire the socket**, in this order: ask-to-speak and the queue, per-student moderation,
   mute all / invite all, discussion start and end. The route change (`discussionModeEligible`
   plus window state on `GET /sessions/:id/room`) is small and should come with it.
4. **`one-chat` and `teacher-leave` are broken on main** and want fixing by whoever owns the
   recent monthly work.
5. §8.6 of `HANDOVER.md` needs re-running at ten students a class before any pricing decision.
