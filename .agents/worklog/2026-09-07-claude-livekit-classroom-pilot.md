# LiveKit classroom pilot — the authority layer

- Date: 2026-09-07
- Agent: claude
- Branch: `claude/livekit-classroom-pilot`
- Starting commit: `a58f23f` (origin/main)
- Final commit: `7a164ef` (stage two in progress)
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

---

# Stage two — entitlement, and a correction

- Date: 2026-09-07 (same day, second brief)
- Commits: `92369fb`, `7a164ef`
- Status at the time: **two of the five requested pieces done. The socket integration, the premium
  classroom UI and the evidence wiring were NOT built.** Nothing was connected end to end.
  *(Superseded by stage three below, which built all of them and proved the path in two real
  browsers. Left standing rather than edited, because a worklog that rewrites what it said is a
  worklog nobody can use to reconstruct a decision.)*

## Verification asked for before building

- **Can the permission API grant moderator rights?** No. `roomAdmin` appears in exactly two
  places in the server source: the token grant, set from `options.isOwner`, and a comment saying
  it cannot be set through a permission update. `ParticipantPermission` has no such field.
- **Does every permission-changing action check membership and teacher authority?** Vacuously
  yes: `setPublishing` and `silence` are called from **nowhere** in production code. Confirmed by
  grep across the server and app sources. They will need those checks when the socket calls them,
  and that is the next task.
- The diff from `origin/main` through `4a0d1a4` was re-read in full; no newer main UI or branding
  is touched by it.

## `92369fb` — the fixture repair that was not needed

**I was wrong in the previous stage and this corrects it.** `one-chat` and `teacher-leave` are
not broken and never were: 8/8 and 17/17. They drive an externally-started API and need it run
with `NODE_ENV=test`, which is how `deploy-web.yml` has always started it. I had not.

`lib/payments.ts` then correctly refused the teacher-plan purchase — no provider is configured,
so a non-test server must not activate a plan it took no money for — the suites discarded that
response, and the run died four steps later on `recurring_days` with `recurring_id = undefined`.
I "confirmed" it against untouched main in a worktree and made the same mistake there, which I
read as proof. **A comparison run proves nothing when the variable you did not think about
changes in both arms.**

So there was no stale fixture and no production logic to change. What was real: a
misconfiguration surfacing four steps downstream as a SQL syntax error. `test-support/apiMode.mjs`
now explains it at the point it happens; both suites check the response they were discarding.
Verified by pointing `one-chat` at a non-test API and reading the output.

## `7a164ef` — entitlement judged at the class's own time

Eligibility now uses the **session's own scheduled time**, not "now", so a class inside a cycle
the teacher paid for keeps its benefit even if the plan changes afterwards. Rescheduling across a
cycle boundary is handled by construction rather than by a second rule.

`GET /sessions/:id/room` now returns `discussionModeEligible` and `discussionOpensAt`, both
server-derived. Pay-as-you-go gets `false` and `null`.

**Three of the four commercial rules cannot be implemented against this schema**, and the file
documents precisely why rather than approximating:

1. No payment record of any kind — `chargeForMonthly` returns a reference and nothing stores it.
2. No renewal concept — a plan is bought once and cycles roll forward by arithmetic, so
   "renewal turned off" is not a state this system can be in.
3. No teacher-subscription reversal — `refunds` is about students.
4. No `lapsed_at`, so even when a plan stopped being active is unknown.

A lapsed plan therefore still denies, which is safe and is not fair to a teacher who cancelled
inside a paid cycle. Fixing it is a schema change plus a commercial decision.

**A finding from a test I had written backwards:** nothing reads `suspended_until` to decide a
suspension has lapsed, and nothing sets `status` back to `active`. A plan suspended for thirty
days stays suspended until an operator intervenes. My first version treated an expired date as
ending the suspension, which would have made this the only file in the codebase that believed
that. Removed.

14 boundary tests in `scripts/entitlement-tests`. The classifier is bundled with esbuild for the
test because the room route refuses a class that is not joinable yet, and every boundary here is
a class at some distance from now.

## Tests after stage two

typecheck clean (4 packages) · api-server units 497/497 · video contract 43/43 · sessions 56/56 ·
entitlement 14/14 · one-chat 8/8 · teacher-leave 17/17 · session-proof 125/125 · retention 79/79

Two self-inflicted environment problems worth recording so the next run does not repeat them: a
server I had left on port 8099 is the port `video-tests` uses for its LiveKit instance, and made
that suite report the wrong provider; and Postgres must be started via
`scratchpad/pg.sh` because the harness periodically resets permissions under `/tmp/claude-0`.

---

# Stage three — the socket, the screen, and the cost

- Date: 2026-09-07 (same day, third brief)
- Commits: `29d5cbe`, `0326abb`, `fa22970`, and this entry
- Status: **built and proved end to end.** A student taps a button in the built app; the teacher's
  other browser shows it; the record has it. The one thing still unproven is LiveKit Cloud itself
  and a real phone, which VIDEO.md already names.

## `29d5cbe` — the socket, the provider and the record

`lib/classroom/floorProtocol.ts` reads a `floor_`-prefixed frame, authorises it, runs it and
reports what changed. `lib/classroom/floorView.ts` decides what each side is told.
`ws/classroomFloor.ts` holds the per-room state, loads the entitlement and the class's clock from
the server, pushes decisions to LiveKit and writes the record. `classroomHub.ts` routes to it.

Three rules hold for every one of the twenty-three actions: identity comes from the authenticated
socket and never from the payload; a subject must be somebody the room already knows, so a teacher
cannot invent a participant by naming a number; nothing works past the class's own cutoff.

**Effects are derived, not declared.** Whose rights changed, whose live track must stop, whose row
a viewer would now see differently — all worked out by comparing the floor before and after. A
table would drift the first time somebody changed what an action does.

### The security bug this exercise existed to find

`publishRightsFor` returned `canPublish` from the *permission*, ignoring the mute. A muted student
came out `{ canPublish: true, mic: false, camera: false }`, and `setPublishing` turned that into
`canPublish: true` with an empty source list. From LiveKit's own `protocol/auth/grants.go`:

```go
func (v *VideoGrant) GetCanPublishSource(source livekit.TrackSource) bool {
    if !v.GetCanPublish() { return false }
    if len(v.CanPublishSources) == 0 { return true }
```

**An empty source list means *everything*, not nothing.** So pressing Mute granted that student a
camera and a screen share. The flag is now derived from the two fields it summarises, and
`setPublishing` refuses the combination independently. Read out of the vendored Go source rather
than assumed; the `livekit-live` suite had already measured the other half — that a real server
reads the fields the SDK omits from its JSON as false.

### The record

Grants, dismissals, mutes and discussion start/end go to `activity_log` as
`classroom.floor.<action>`, plus a student's *first* raised hand and each speaking stint's length.
Deliberately not a `spoke_ms` column on `session_participation`: this project pushes schema by
hand while the API redeploys on every push, so an INSERT naming a column the database does not
have yet would silently stop the whole attendance ledger for however long that gap lasted. The
log needs no migration.

### Where the floor is hidden entirely

`capabilities.moderatesPublishing` is a new field on the provider contract — true for LiveKit,
false for Daily and echo. On Daily every participant can unmute themselves, so a raised hand asks
for something the student already has and a teacher's mute would be a button that does nothing
while looking as though it had. The server refuses every floor action there; the app draws none.

## `0326abb` — the screen

`utils/classroomFloorUi.ts` decides what each person is *offered*, apart from how it is drawn:
nine media states, two modes, an invitation that may or may not be outstanding and a camera limit
that applies in one mode and not the other. It offers and never decides — every button carries an
intent the server checks again from scratch.

Two decisions worth keeping:

- An invitation reads as `allowed-not-accepted`, because the invitation carries the permission and
  the permission is inert until answered. Switching on the state alone would show "you can speak"
  to a child who has no idea their teacher just asked them a question, so the offer reads
  `invitedAt` and interrupts.
- **Nothing is optimistic.** Press "Ask to speak" and the button does not move; the server answers
  and the screen follows. A screen showing a permission before the SFU agreed sends a student to
  press unmute and be refused with no explanation.

One addition to the wire the brief did not list: `floor_accept` carries `mic` and `camera`
independently, so a student answering a question can turn their camera off to save bandwidth
without giving up their turn. The call panel already had that button; without this the teacher's
list went on showing a camera nobody was sending.

**Two things the rendered suite caught that the assertions had not.** Every control carried
`flexBasis: 0`, making a row of three the same width whatever it said — on a 390-point phone the
teacher's list read "Let them …", "Take t…", "Came…". And the harness drew every icon as an empty
box, because `expo-font` was stubbed to nothing. Both fixed; clipping is now measured
(`scrollWidth > clientWidth`) rather than looked at.

`bundle-for-browser.mjs` gained three things every future component suite needs: a `.ttf` loader,
`.js` treated as JSX, and `__DEV__` defined. The last one cost half an hour — without it
`@expo/vector-icons` throws on first render, React unmounts the whole tree, and every assertion
after that point fails against an empty page while `pageerror` stays quiet.

## `fa22970` — what a discussion costs

Sending a camera is one stream; receiving it in a class of ten is ten. `utils/discussionLayout.ts`
caps tiles at four on a phone, six on a tablet, nine on a laptop, and hands
`lib/video.setCameraPlan` the list of cameras to drop. Twelve people on a phone now cost three
downloaded cameras instead of eleven, and the people off screen are *said* — "6 more people are
here" — rather than silently vanishing.

The hysteresis is measured in age from `now`, bucketed to four seconds. An earlier version floored
the timestamp itself, which made the hold depend on where the clock fell inside its window — two
people a second apart landed in one bucket or two according to the time of day. A tile must not
change hands over a cough while somebody is reaching for it.

**"Focus board / Focus discussion" was not built, deliberately.** That is the existing call window
— compact, normal, full — which both classrooms already expose and which lives in one shared
tested file precisely because the two screens had drifted apart over it once. A second control
beside it would be that drift again.

## `?` — proved end to end, in two browsers

`sikshya/scripts/floor-live-tests` is the suite that answers the brief's own question. A real
teacher and a real student, in two browser contexts, in one live class against a real API and a
real database: the student taps **Ask to speak** in the built app, the frame crosses a real
WebSocket, and the *teacher's other browser* shows the badge. Then the teacher grants, the student
accepts, the teacher mutes, and every step is checked on both screens and in `activity_log`.

22 checks, all passing. Two things it caught while being written, both worth keeping:

- `PATCH /sessions/:id/status` does not exist; the status change is `PATCH /sessions/:id`. The
  wrong path returned an HTML 404 and the suite's JSON parse blew up.
- **A caller that sends no `X-Fadko-Platform` header is treated as a phone and served Daily.** That
  is correct — an app build from before the header existed is a phone far more often than not —
  and it means the precondition check reported `provider=daily` until the suite sent the header.
  The precondition is asserted out loud for exactly that reason: without it, eight later failures
  would have looked like broken code.

**And it caught a real bug the moment it was made faithful.** The first version started the class
before opening either browser, which is not what happens: doors open ten minutes early and students
gather in the lobby. Opening the classrooms first and *then* pressing start showed that
`resetBoardFor` broadcast `floor_ended` — so everybody already in the room lost their controls for
the rest of the lesson, with nothing to bring them back. Starting a class now re-tells everyone the
new, empty floor instead. Confirmed by reverting the fix and watching the check fail.

Two smaller things while reviewing the same path: the floor is now skipped entirely on a provider
that cannot enforce it, which saves two database lookups on every join of every class on Daily —
and Daily is production.

**What it does not prove** is that media flows. Neither browser joins the LiveKit room. The API is
pointed at a real `livekit-server` so `moderatesPublishing` is true and the permission push goes
somewhere real, but the participants are not in that room, so the push finds nobody — a truthful
outcome the server tolerates by design. The exact shape of what it sends is asserted separately by
`api-server/scripts/floor-tests` against a recording stub, and that media flows at all is
`scripts/livekit-live`.

## Tests after stage three

typecheck clean (4 packages) · api-server units 554 · floor rules 47 · protocol and disclosure 41 ·
floor against a real database and a recording LiveKit 70 · video contract 43 · sessions 56 ·
one-chat 8 · teacher-leave 17 · late-joiner 13 · attendance 74 · class-chat 36 · thread 25 ·
board-persistence 7 · app units 303 · floor offers 29 · discussion layout 16 · floor UI rendered
at four widths 168 · livekit component 92 · **floor end to end in two browsers 24** · classroom
screens 47 · whiteboard 44 · call-chat 17 · call-leave 9 · video-check 17 · gates 10 · lobby 90 · **livekit-live
against a real SFU with real cameras 41** · design ratchet unchanged at 99 hex / 294 sizes.

A repeat of a mistake the worklog already records: `livekit-live` failed six checks until I noticed
I had left my own `livekit-server` on port 7880, which is the port that suite starts its own on.
Its tokens were signed with a key the squatting server did not have. Kill stray servers before
running it — the same lesson as the port 8099 note above, learned twice.

Screenshots of fifteen states at 390, 412, 768 and 1440 in `/tmp/floor-shots`.

## Still not done

- **No real LiveKit Cloud account, and no real phone.** Everything here is measured against a
  local `livekit-server` and a recording stub. The remaining gap is the same one VIDEO.md already
  names.
- **The discussion is uncapped on the sending side.** Ten students may all switch cameras on; the
  receiving cap keeps each phone's download bounded, but the upload and the per-participant
  minutes are not limited. Whether to cap it is a commercial decision, not a technical one.
- The four missing schema facts under `7a164ef` still block the commercial half of entitlement.

## Next for Codex

1. Review the authority path end to end: `floorProtocol.ts` first, then `classroomFloor.ts`.
2. The `publishRightsFor` fix is the one to look at hardest — it is a security change and the
   reasoning is quoted from LiveKit's source in the file.
3. Decide the lapsed-plan commercial question, and whether the schema should gain a
   paid-through/renewal record.
4. Decide whether a discussion should cap how many students may hold a camera at once.

---

# Stage four — Codex's four merge blockers, corrected

- Date: 2026-09-08
- Agent: claude
- Branch: `claude/livekit-classroom-pilot`
- Base commit: `ed3267f`
- Status: complete, awaiting Codex re-review. Not merged, not deployed.

## Requested

Codex reviewed this branch at `ed3267f` and refused the merge on four findings
(`origin/codex/learning-program-foundation:.agents/worklog/2026-09-07-codex-livekit-pilot-review.md`).
Correct only those four, keep the authenticated authority model and the student token restrictions,
touch nothing in payments, Learning Programs, membership, Daily production behaviour, pricing,
schema or production configuration. Add a regression test for each. Run the narrow floor, UI,
LiveKit, lobby, classroom and typecheck gates. Stop for re-review.

The queued Learning Program task was stopped before it began; its work-in-progress sits unpushed on
`claude/learning-program-phase1` at `2eacaa8` and nothing from it is in this diff.

## Changed

**1 — starting a class emptied the teacher's roster.** `resetFloorFor` cleared `floor.students` and
`state.names` and rebuilt neither, so a teacher's participant list was empty the instant their class
began: Invite all and Mute all iterate that list and reached nobody, and a student who later raised
a hand reappeared as the generic "Student". Split into two named functions in
`api-server/src/ws/classroomFloor.ts` — `restartFloorFor`, which wipes the previous lesson and then
rebuilds presence and identity from the clients still connected, and `endFloorFor`, which wipes and
rebuilds nothing. Clearing first is deliberate: no lesson may inherit the last one's raised hands,
invitations or permissions. `FloorClient` gained `name`, so the rebuild has a name to restore
without a database round trip.

**2 — a provider change was reported as done whether or not it happened.** `pushRights` and
`silenceThem` discarded their promises. Now:

- `VideoProvider.setPublishing` and `.silence` return `ProviderApply` — `{applied:true}`,
  `{applied:false, reason:"absent"}` or `{applied:false, reason:"failed", error}` — instead of a
  boolean that meant both "nobody by that name is in the room" and "the call failed"
  (`lib/video/types.ts`). That is `refusals-must-name-their-reason.md` one layer down.
- `livekitProvider.ts` classifies by LiveKit's measured error shapes: `not_found` / HTTP 404 /
  "participant does not exist" is `absent`; everything else, including a missing configuration or a
  missing identity, is `failed`. A mute that throws part-way fails the whole call rather than
  reporting partial success.
- `classroomFloor.ts` marks an instruction **pending before the call is made** (`beginSync`), so
  the sequence is always ask → pending → answer and `ok` is only ever written by an answer. Five
  bounded retries at 1/2/4/8/16s, each recomputing the instruction from the floor *as it then
  stands*; then it stays visibly `failed`. `providerHolds` gates the floor-time stopwatch, so a
  grant the SFU never accepted starts no clock.
- Both screens say so. `FloorRow.provider` and `you.provider` carry `ok | pending | failed`;
  `providerNote` draws a chip on the teacher's row (`participant-provider-<id>`), and
  `studentOffer` withholds the accept buttons while a grant is unconfirmed.

**3 — floor time was called speaking time.** `classroom.floor.spoke` is now
`classroom.floor.held`, and every row carries `basis: "permission_and_consent"` and
`speechConfirmed: false`. Nothing in this build observes a published track, so no code path can
write `speechConfirmed: true` — a refund rule wanting proof of speech has to find a row that does
not exist, which is the honest position.

**4 — the discussion could be started after the class had finished.** `discussionWindow` closed at
`cutoffAt`, ten minutes past the booked finish, quietly making a twenty-minute window a
thirty-minute one. It now closes at `scheduledEndAt` and its signature dropped the `cutoff`
argument so the old one cannot be passed by accident. A discussion already running is untouched:
the overtime allowance exists so a lesson is not cut off mid-sentence, and `endDiscussion` plus the
cutoff check in `floorProtocol.ts` still end it.

Two things found while correcting these and fixed in the same pass, because leaving them would have
made the corrections untrue on screen:

- **`providerNote` was written, unit-tested, and never rendered.** The teacher's row drew a failed
  mute exactly like a completed one — the core of finding 2 — until it was wired into
  `ClassroomFloor.tsx`.
- **The student guard was backwards for a failed revocation.** It keyed off `allowedMic`, which a
  muted student still carries, so a mute the SFU never accepted was announced to that student as
  "Switching your microphone on…". It now works out what the server actually wants the SFU to hold
  and says one of two things: a grant that has not landed, or a removal that has not landed —
  "The class could not confirm your microphone is off", with the one action they can take.

Also wired the two suites that had no `package.json` entry into one: `test:floor` (api-server) and
`test:floor-ui` (app). A gate nobody can run by name is a gate nobody runs.

## Decisions and assumptions

- **`absent` is not a failure and is not retried.** A student who is not in the SFU's room holds a
  token that permits publishing nothing, so a grant they never received cannot be used, and
  `floorJoin` re-pushes their standing grant when they return.
- **Retries are bounded at five.** An unbounded retry against a provider that is down outlives the
  lesson and hides the problem behind an optimistic "still trying". Stopping and saying so puts it
  in front of the teacher, who can carry on without that student's microphone.
- **A stuck row keeps its controls.** The teacher's actions are how a stuck row is unstuck; hiding
  the buttons would leave the one person who can fix it with nothing to press.
- **A student already speaking keeps their ordinary offer.** Taking "Stop speaking" away from
  somebody mid-sentence because a *later* change is in flight is worse than the problem. They get a
  chip instead, worded without a direction.
- Floor time stays in `activity_log` rather than becoming a column: this project pushes schema by
  hand while the API redeploys on push, so a new column takes the attendance ledger down until
  `db:push` runs (`.agents/memory/schema-change-deploy-window.md`).

## Verification

Everything below was run in this session, against a real `livekit-server` v1.13.6 and a real
Postgres, in this order.

| Gate | Result |
| --- | --- |
| `pnpm run typecheck` (4 packages) | clean |
| api-server units | 555 passed, 0 failed |
| app units | 315 passed, 0 failed |
| `api-server` `test:floor` (real DB + recording LiveKit stub) | 96 passed, 0 failed |
| app `test:floor-ui` (rendered, 4 widths) | 216 passed, 0 failed |
| app `test:livekit` | 92 passed, 0 failed |
| app `test:lobby` | 90 passed, 0 failed |
| app `test:classroom` | 47 passed, 0 failed |
| app `test:floor-live` (three real browsers, real API, real DB) | 50 passed, 0 failed |
| app `test:livekit-live` (real SFU, real cameras) | 41 passed, 0 failed |
| `lint:design` | unchanged at 99 hex / 294 sizes |
| `git diff --check` | clean |

**The two-browser suite is now a three-browser suite**, because one student cannot catch finding 1:
a single student who raises a hand rebuilds their own row by raising it, and the hole never shows.
It now registers two students with distinct real names, both of whom sit in the lobby, neither of
whom reconnects or raises a hand, and then checks after the teacher presses start that the class
list holds both rows *by name*, that Invite all reaches both, that Mute all reaches both, and that
`activity_log` records one `invite_all`, one `mute_all` and two `return_audience` lines. Section 7b
reads the `classroom.floor.held` rows straight out of Postgres and asserts there is no
`classroom.floor.spoke` row, that every held row says `speechConfirmed = false`, and that its basis
is `permission_and_consent` — finding 3 checked against the database a support agent reads, not
against a stub.

**The new checks were confirmed to fail without the fix.** With the rebuild loop in
`restartFloorFor` disabled behind a temporary environment flag, the class list read "0 students /
Nobody has joined yet", and Invite all reached neither student: 6 checks failed. The flag was
reverted, the server rebuilt, and the suite returned to 50/0.

Fifteen-plus rendered states at 390, 412, 768 and 1440 in `/tmp/floor-shots`, including four new
ones for the provider states. These were looked at, not merely asserted on — see below.

## Problems and surprises

- **A screenshot caught a contradiction the assertions could not.** The student's failed-mute card
  read "The class could not confirm your microphone is off" with a chip directly beneath it saying
  "The class could not switch this on" — two opposite sentences on one card. `providerNote`'s
  student wording assumed a direction it cannot know. It is now direction-neutral and is drawn only
  in the one case `studentOffer` leaves alone.
- **`floor-ui-tests` fixtures had no `provider` field**, so every scene with a permission fell into
  the new guard and the suite failed at the first invitation. The fixture was out of date with the
  server's view, which is the suite doing its job; `provider: "ok"` is now spelled out with a note
  saying why the default is not "leave it undefined".
- **An invisible character, and a wrong inference from it.** A check on the teacher's "2 speaking"
  badge failed against an expected `"2"` after `.trim()`, printing what looked exactly like
  `"\n2"`. I reasoned about that for some minutes and concluded it was impossible, because
  `"\n2".trim()` is `"2"`. It was: the real string was `U+F19F, U+000A, "2"` — the Feather icon's
  own glyph from the icon font, a private-use character that is not whitespace, survives `trim`,
  and prints as nothing at all in a terminal. Settled by dumping code points instead of reasoning
  further. The check now extracts the digits, and `innerText` on anything carrying an icon should
  be read the same way.
- **The port-7880 squatter, for the third time.** `test:livekit-live` failed with HTTP 401 because
  my own dev `livekit-server` was on the port that suite starts its own on. Killed it → 41/41. The
  worklog already records this lesson twice; it is now recorded three times.

## Fabrications found

Two, both mine, both from the work Codex was reviewing rather than newly introduced here — and
both now rows in `.agents/backlog/ui-upgrade-progress.md`:

- `classroom.floor.spoke` (finding 3): a real number answering a different question from the one
  its name asked — permission-and-consent time presented as speaking time, in the log a support
  agent reads when deciding a refund.
- A provider change that never landed, drawn on both screens exactly like one that did (finding 2).
  The teacher's half of this was still live when this session began: `providerNote` existed and had
  unit tests, and no component rendered it.

Nothing newly fabricated was found in this pass.

## Deliberately not changed

- Payments, booking, membership, Learning Programs, pricing, schema, production configuration.
- Daily's production behaviour. `dailyProvider` still implements neither `setPublishing` nor
  `silence`; the classroom refuses the teacher's control rather than pretending, and the strip is
  not drawn at all where `moderatesPublishing` is false.
- The behaviour of a discussion that is *already running* during overtime. Finding 4 was about
  activation only, and the brief says to treat the running case separately.
- The `sikshya<id>` provider room name, which attendance evidence correlates on.

## Remaining risks / next pickup point

Unverified, and none of it is verifiable from this container:

- **No LiveKit Cloud account.** Everything is against a local `livekit-server`. Cloud's error
  shapes are assumed to match the ones measured here; the `absent` classification is the one that
  would matter if they differ, because misreading a real failure as `absent` would restore exactly
  the bug finding 2 is about.
- **No real phone and no Kathmandu latency.** The retry delays are chosen, not tuned against a
  network that drops.
- **No provider media telemetry.** Until LiveKit's track events are ingested, `speechConfirmed` can
  only ever be false, and no refund rule may ask whether somebody actually spoke.
- The four missing schema facts under `7a164ef` still block the commercial half of entitlement.

Next: Codex re-review of this branch. The Learning Program Phase 1 task is queued behind it on
`claude/learning-program-phase1`.
