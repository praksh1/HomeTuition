# Production-test release candidate

- Date: 2026-09-04
- Agent: claude
- Branch: `claude/production-test-release-candidate`
- Base commit: `b29bb07` (itself branched from `origin/claude/staging-user-journey-audit`)
- Status: **released.** `999fe3b` is `main` and is deployed. Codex coordinated the release; this entry now also carries the post-release reconciliation audit.

## Requested

One release candidate that lets the owner test the real Daily classroom on the main production
domain **without** disabling the configured payment gateway for the public and **without**
inventing revenue. Five parts:

- **A** — reconcile, don't rebuild: confirm the branch still carries correction items 1–6 and
  prove each with a targeted test rather than re-implementing it.
- **B** — complete correction item 6, the honest call window. The owner reports the minus button
  as doing nothing.
- **C** — an operator-granted, auditable, expiring **test student access**, modelled on the
  existing teacher test access, so the owner can walk a real booking without opening free
  payment to the public.
- **D** — the test gates: concurrency, authorization, revenue exclusion, expiry, kill switches.
- **E** — this log, the docs, and the closing report.

Two blocking corrections from Codex had to be cleared before any of that:

1. `b29bb07` labelled every outside-window refusal `409 / expired: true`, and both classroom
   screens treated any 409 as terminal. A paid student or a teacher who was merely **early** was
   shown an expired screen.
2. `sendVerificationEmail` read `isEmailConfigured()` but still called `issueToken` when mail was
   unconfigured, burning a token and a cooldown that could produce a 429 the moment a provider
   was switched on.

Standing constraints: push only to this branch; do not touch `main`,
`codex/staging-preview-integration`, `claude/stream-video-poc`, Railway, Cloudflare, production
data, credentials, DNS or billing; Stream stays isolated at `8550631` and unmerged; **Daily
remains the production video provider** and its room/token logic is not altered; no deploy, no PR.

## Changed

### Blocking correction 1 — "not yet" is not "never again" (commit `7abe06d`)

| File | What |
|---|---|
| `api-server/src/lib/sessionStart.ts` | `StartCheck` gained `code: "too_early" \| "finished" \| "cancelled"`, and the two early branches carry `opensAt`. All seven refusal sites tagged. |
| `api-server/src/routes/sessions.ts` | New `timingRefusal()` builds both 409 bodies from one place; `expired` is now `code !== "too_early"` rather than always true. |
| `sikshya/utils/roomRefusal.ts` *(new)* | Pure reader: status + body → `waiting \| over \| error`, plus the retry delay. An unknown or missing code falls back to the old `expired` flag, so an older server is still understood. |
| `sikshya/utils/sessionWindow.ts` | The client mirror gained the same `code`, because it shared the server's fault. |
| both `classroom/[id].tsx` | A non-terminal lobby with the real opens-at sentence and a retry when the door opens; terminal screens reserved for classes that genuinely ended. |

### Blocking correction 2 — a resend nobody can receive leaves no trace

| File | What |
|---|---|
| `api-server/src/lib/accountSecurity.ts` | Short-circuits **before** `issueToken` when mail is unconfigured: nothing is minted, no cooldown spent, no older token invalidated. Returns `{ sent: false, rateLimited: false, configured: false }`. |
| `api-server/src/routes/auth.ts` | A configured provider that still refuses now says so, instead of sending the operator to check an environment variable that is already correct. |

### The classroom crash found only by rendering (commit `7abe06d`)

Both classrooms returned `null` for the wrong role on a line **above about forty hooks**. On a
cold open — a refresh, or a shared link — the first render ran three hooks and the next ran
forty, and React threw error 310: *"Something went wrong. Please reload the app."* The guard is
now deferred past every hook. This is the `authguard-role-cast-crash` hazard already in memory,
in two more files. It was **pre-existing**, proved by reproducing it on a code path this task had
not touched.

### Item B — the call window (commit `33de42d`)

| File | What |
|---|---|
| `sikshya/utils/callWindow.ts` *(new)* | One pure module, shared by both classrooms: the four states, the reducer, the geometry, and what each state offers. No React, no styles, no imports. |
| `sikshya/utils/callWindow.test.ts` *(new)* | 24 tests. |
| both `classroom/[id].tsx` | `useReducer(callWindowReducer)` replaces the local `useState` size; the geometry, the drag clamp and the rotation re-clamp all come from the shared module. Compact renders one **Restore**; normal and full render the original three. |
| both `classroom/[id].tsx` styles | `callFrameBody` gained `overflow: "hidden"`, `callFrameHeader` gained `zIndex: 1`. **See "Problems" — this was the actual bug.** |
| `sikshya/scripts/lobby-tests/run.mjs` | The window states are rendered and pressed for **both** roles at both viewports, with unforced clicks. |

**Minus is now a snap.** From any visible size it goes to `compact` *and returns the window to
the bottom-right corner*. It used to toggle two docked sizes about a finger's width apart and
leave the window wherever it had been dragged, which from the outside is a dead control.

### Item A — reconciliation, not rebuilding (commit `bfb50fc`)

Correction items 1–6 were checked against the branch rather than re-implemented. The evidence
table is at the top of `.agents/backlog/2026-09-02-owner-corrections-and-stream-poc.md`. Items 1–5
were carried in from earlier work and re-checked; item 6 is the one this branch completed. Nothing
in items 1–5 was rewritten.

### Item C — test student access (commits `3a2abd9`, `06c3ff8`)

| File | What |
|---|---|
| `lib/db/src/schema/testStudentAccess.ts` *(new)* | Two additive tables: `test_student_grants` (student, operator, reason, granted/revoked, `valid_until`) and `test_classes` (session id, teacher, the grant that was live at creation). No existing column touched or dropped. |
| `api-server/src/lib/testStudentAccess.ts` *(new)* | `ALLOW_TEST_STUDENT_ACCESS` (default off, read per request), `liveTestStudentGrant`, `isTestClass`, `admitsTestEnrolment`, and the `test` / `test_access` / label constants. |
| `api-server/src/lib/teachingAccess.ts` | `viaTestGrant` now carries the grant id, so a class can record which grant created it. |
| `api-server/src/routes/sessions.ts` | Marks a class in `test_classes` at creation; decides the test booking **inside** the transaction and **before** `chargeForSession`; writes `test` / `test_access` / no reference; carries the label into the booking response and the room response; includes `test` rows in the student's own class list while the switch is on. |
| `api-server/src/lib/membership.ts` | A `test` row is a real place, gated on the switch, answered in the one function both doors already share. `viaTestAccess` added to `SessionMembership` for callers that show money. |
| `api-server/src/routes/admin.ts` | `POST /admin/students/:id/test-access` and `…/revoke`, with the eligibility gates re-checked server-side, one live grant per student, and both actions in the activity log. `testStudentAccess` added to the person payload. |
| `sikshya/app/(admin)/person/[id].tsx` | The operator card: grant with a reason, the live grant with its end date, revoke, and the eligibility rules stated. Student records only. |
| `sikshya/utils/testAccess.ts` *(new)* | The fallback wording, mirroring the server's `TEST_LABEL`. |
| both `classroom/[id].tsx`, `components/SessionCard.tsx` | The label, painted where somebody would misread the absence of it. |
| `api-server/scripts/test-student-access/run.mjs` *(new, `test:test-student`)* | 108 checks. |
| `sikshya/scripts/test-access-ui/run.mjs` *(new, `test:test-access-ui`)* | 72 rendered checks. |

### Codex's five release blockers, found in an independent review of `914c210`

All five were real, all five are fixed, and each has a check that fails without the fix. They
share one root: **the three-gate model was implemented in the two places that decide access and
not in the six places that describe the result.** A test place was admitted by `membership.ts` and
then, everywhere downstream, either treated as absent or described as paid.

| # | What was wrong | Fix |
|---|---|---|
| 1 | `sessionMessages.ts` `participantIds()` asked for `payment_status = 'paid'` while `threadAccess` admits a test place through `membership.hasPaid`. A teacher writing "running five minutes late" into a test class's thread was **read by nobody** — stored, visible if the student happened to open the thread, announced to no one. Exactly the case the thread exists for. | Both that query and the roster now use one switch-gated `activeEnrolmentStatuses()`. |
| 2 | `session_booked` carried `amount: 0, test: true`, but `NotificationEvent` had no `test` field, `emailFor` always said **"has booked and paid for your class"**, and the in-app formatter filed it under the payment icon. A teacher was told something false about their own income. | `test` is now a typed field on the event, carried to the email, the push and the in-app entry. The formatter moved to a pure `notificationEmails.ts` so the wording is unit-testable. |
| 3 | `bookSession` answered `{ alreadyBooked: true, paid: true }` for any existing `test` row, so a second tap produced "You have already paid for this session" about a booking that took nothing. | `paid` now answers only "did money move". A test place returns `paid: false, test: true, testLabel`, and the student's confirmation says "You're in — no payment was taken" instead of naming a payment method. |
| 4 | `participation.ts` filtered `paid` only, so the teacher's roster and the attendance record were **empty while a test student was sitting in the class**. | Same shared status list, switch-gated. Not reachable from any earnings, refund or drop query — those still ask for `'paid'` alone and were not touched. |
| 5 | `SessionCard`'s label hung off the **viewer's** enrolment, so only the test student ever saw it. The teacher's own list showed "NPR 500 per class" against a class that had never taken a rupee. | Every session response now carries the server's own `test`/`testLabel` from `test_classes`, and the card shows the label for the class being test *or* the viewer's place being test. |

**A sixth of the same shape, found by re-reading the diff against the pattern the five made.**
`PATCH /sessions/:id` builds the "your class has started" audience from `payment_status = 'paid'`
too, so a test student waiting in the app for a class they were about to walk into was never told
it had begun — the same "who is told" defect as the class thread, on the notification that matters
most during the end-to-end run this whole feature exists to allow. Fixed with the same shared
switch-gated list, with its own check.

Every other `= 'paid'` query in the server was read and left alone. Each one is money: the refund
loop, the drop route, schedule-change compensation, the invitable-students list, the agent refund.
One audience-shaped query survives deliberately — see **Deliberately not changed**.

The half of #3 about a **dormant** row — `paid: true` while the classroom refused the same person —
was already fixed in `35aaecb`, after Codex's review of `914c210`. It now has its own proof: on a
server in simulated mode, a student holding a dormant test row books again, is genuinely charged,
and the **same row** becomes `paid` with a real reference — no second enrolment, no second seat.

**New files:** `api-server/src/lib/notificationEmails.ts` (+ its test), `sikshya/utils/testAccess.test.ts`.
**Changed:** `sessionMessages.ts`, `participation.ts`, `testStudentAccess.ts`, `notify.ts`,
`routes/sessions.ts`, `useUserChannel.ts`, `NotificationContext.tsx`, `notifications.ts`,
`testAccess.ts`, `SessionCard.tsx`, both `sessions.tsx` lists, `(student)/teacher/[id].tsx`,
`notificationKinds.test.ts`.

### Codex's second review: one flag was doing the work of two facts

The first round of fixes made a test place visible everywhere. The second review found that it was
now visible *to everyone*, saying the wrong thing:

> A test class is only **eligible** for granted bookings. An ordinary student still pays full
> price for that same class. But one `test` flag carrying "TEST — no payment was processed" went
> to every viewer of one.

So an ordinary student was told no payment would be taken **before being charged**, and an
ordinary student who *had* paid sat in the classroom under a banner saying their money had not
been taken. Both are the same fabrication the first round was meant to end, pointed the other way.

**The model now has two facts and they never share a field:**

| | field | true of | may say |
|---|---|---|---|
| class | `testClass` / `testClassLabel` | the class, immutably, from `test_classes` | "TEST-ENABLED CLASS — only approved test bookings bypass payment" |
| booking | `testBooking` / `testBookingLabel` | one viewer's own enrolment | "TEST — no payment was processed" |

Only the second may claim a payment did not happen. Who sees which:

- **A student** sees only what is true of them — their own granted place, or nothing at all.
  Somebody who paid gets the ordinary price and the ordinary payment screen, with no test wording
  anywhere. (I first showed them the class marker in the classroom and not on the card; that
  inconsistency was caught in my own audit and removed. A paying student now sees neither.)
- **The teacher** sees the class-level marker, on their own list and in their classroom, because
  it is their income it qualifies.
- The notification event, the email, the push and the in-app entry carry the **booking** fact under
  its own name.

### The payment sheet for a payment that never happened

The second blocker was not wording. `POST /book` was bypassing the gateway **behind** a payment
sheet: the student chose eSewa or Khalti, typed a phone number and a PIN, and no payment was ever
attempted — while `TESTING-ON-THE-LIVE-SITE.md` promised no payment screen would appear.

`GET /sessions/:id/access` now answers `canBookAsTest`, derived server-side from the authenticated
user, a live grant and the durable class marker — never from a client-supplied `studentId`, never
from the class marker alone. When it is true the Book button reads **"Take a test place — no
payment"** and calls the booking endpoint with **no method, no phone number and no PIN**. `POST`
re-derives all three gates inside its own transaction and remains the only thing that decides: the
same empty body from somebody without a grant is refused.

**A pre-existing defect had to be fixed first, because it made the whole thing impossible.**
`(student)/teacher/[id].tsx` loaded per-session access only on `[id]`. On a cold open — a refresh,
a shared link — `useAuth` had not restored the session, `studentId` was `undefined`, the entire
access block was skipped, and it never ran again. `access` stayed empty for the life of the
screen, so every upcoming class showed "Book & pay" whatever the server thought — including to a
student who had already booked and paid for it. Both effects now depend on `studentId` too.

Also fixed: the plain-text booking email carried literal Markdown asterisks around the one
sentence that most needed to be believed.

## Decisions and assumptions

- **`compact` offers exactly one control.** Three 44-point buttons do not fit across a 132-point
  window; they render as a row of half-buttons nobody can hit. Restore is the one thing somebody
  wants from a thumbnail, and Hide stays reachable from the classroom's own HUD.
- **Restore goes to `normal`, not to full screen.** A thumbnail's Restore means "give me the
  window back"; full screen would bury the whiteboard, which is the product.
- **`hidden` is a painted state, not an absent one.** The call stays mounted through hide,
  minimise, maximise, drag, rotation and the chat overlay. The state machine has no "off", and a
  test walks 40 actions asserting it cannot reach one.
- **An unknown refusal code reads as "over".** A screen that waits forever for a class that
  finished is worse than one that ends a few minutes early, and the person can reopen it.
- **The retry sleeps at most five minutes** even when the door is a day away. A backgrounded tab
  throttles timers and a dozing Android may not run one at all.
- **Three conditions for a free booking, never fewer.** The switch, a live student grant, and a
  class marked test. A granted student pays for an ordinary teacher's class; an ordinary student
  pays for a test class. Only the intersection is free.
- **A class is marked when it is created, never inferred later.** See the memory note; asking at
  booking time what the teacher's grant looks like *then* is wrong in both directions.
- **`payment_status = 'test'`, and no reference.** Every money query already asks for `'paid'`, so
  a distinct status is excluded by construction rather than by editing each query. A reference
  would be an invented receipt.
- **Two tables, no column changes.** `.agents/memory/schema-change-deploy-window.md`: the API
  redeploys itself on push while `db:push` is manual, and a new column on a table read with a bare
  `select()` is a 500 for the length of that window. A new table is only touched by new code.
- **Membership is the only place that admits a test row.** A second `payment_status = 'test'`
  check written into the room route or the socket is exactly the drift that once let an unenrolled
  student watch a teacher's video.

## Verification

Run against Postgres 16 on `127.0.0.1:55432` (database `rc`) and an API on `:8080` with
`VIDEO_PROVIDER=echo`, `NODE_ENV=test`, both test-access switches on.

### Gates

| Command | Result |
|---|---|
| `pnpm run typecheck` (4 packages) | clean |
| `pnpm --filter @workspace/api-server run test` | **294 / 294** |
| `pnpm --filter @workspace/sikshya run test` | **213 / 213** |
| `pnpm --filter @workspace/sikshya run lint:design` | 205 hex / 418 sizes — **unchanged**, no new leaks |
| `git diff --check` | clean |

`lint:design:update` was **not** run. One new font-size literal was introduced in `SessionCard`
and removed again by using `useLayout().t.overline`, rather than blessing a higher baseline.

### API suites

| Suite | Result | | Suite | Result |
|---|---|---|---|---|
| `test:test-student` *(new)* | **108 / 108** | | `test:refunds` | 152 / 152 |
| `test:test-access` | 26 / 26 | | `test:tickets` | 62 / 62 |
| `test:payments` | 10 / 10 | | `test:journey` | 57 / 57 |
| `test:sessions` | 56 / 56 | | `test:video` | 16 / 16 |
| `test:tiers` | 31 / 31 | | `test:class-chat` | 36 / 36 |
| `test:monthly` | 199 / 199 | | `test:one-chat` | 8 / 8 |
| `test:attendance` | 72 / 72 | | `test:late-joiner` | 13 / 13 |
| `test:admin` | 58 / 58 | | `test:teacher-leave` | 17 / 17 |
| `test:operators` | 50 / 50 | | `test:portal` | 72 / 72 |
| `test:reset` | 25 / 25 | | `test:notifications` | 44 / 44 |
| `test:board-limits` | 12 / 12 | | `test:board-persistence` | 7 / 7 |
| `test:reviews` | 17 / 17 | | `test:thread` | 23 / 23 |
| `test:round` | 48 / 48 | | `test:alerts` | 14 / 14 |
| `test:uploads` | 51 / 51 | | `test:upgrade` | 13 / 13 |
| `test:messages` | 52 / 52 | | | |

`test:board-persistence` needs `RESTART_CMD`; it reported "cannot prove anything without it" on
the first attempt and was re-run with a real restart script, then passed 7/7.

### Rendered suites (headless Chromium, 1280×800 and 360×740)

| Suite | Result |
|---|---|
| `test:lobby` | **90 / 90** — both roles, both viewports |
| `test:test-access-ui` *(new)* | **72 / 72** — every audience, both viewports |
| `test:classroom` | 47 / 47 |
| `test:board` | 44 / 44 |
| `test:gates` | 10 / 10 |
| `test:nav` | 41 / 41 |
| `test:filters` | 33 / 33 |
| `test:dashboard` | 6 / 6 |
| `test:call-chat` | 17 / 17 |
| `test:call-leave` | 9 / 9 |
| `test:messaging` | 10 / 10 |
| `test:refunds` | 69 / 69 |
| `test:tickets` | 23 / 23 |
| `test:calendar` | 16 / 16 |
| `test:phone` | 18 / 18 |
| `test:photo` | 7 / 7 |
| `test:monthly-browser` | 37 / 37 |
| `test:uploads` | 14 / 14 |
| `test:notifications` | 12 / 12 |
| `test:storage-check` | 10 / 10 |
| `test:perf` | no blocking problems at 6× slowdown; a stroke start-to-finish 1167 ms on a full board |

### The security claim, and how it is actually proved

`test:test-student` runs every server with `PAYMENT_WEBHOOK_SECRET` set — production's shape, where
`paymentMode()` is `gateway` and `chargeForSession` refuses because the redirect-and-callback dance
is not implemented. So on one server, one class:

- the **ordinary** student booking it gets 402 and no enrolment row;
- the **granted** student is enrolled with `test | test_access | (no reference)`.

Nothing but "the gateway was never called" explains the second result. The same suite proves the
switch is off by default, that a planted grant row buys nothing while it is off, expiry without
anybody revoking, revocation taking effect on the next booking, eight simultaneous bookings landing
exactly one enrolment and one seat, that no refund can be claimed against a test enrolment and
cancelling the class owes nobody anything, that both classroom doors agree for a test place and both
close when the switch goes off while the paid place beside it is untouched, and that a class stays
marked after the teacher's own grant is revoked.

**Not measured, and not claimed:** real Daily media, an iPhone, an Android handset, a real payment
gateway settling anything, or two devices in one class.

## Problems and surprises

**The window controls were drawn, and dead — and forced clicks hid it.** After wiring the shared
model in, the rendered rectangle refused to change: 132×118 through Restore and through maximise,
at both viewports. The model was right (24/24 in isolation) and the wiring was right, so the press
was not arriving. Dumping the subtree found it:

```
DIV[video-provider-unknown] rect=1141,595 130x72   ← the call body
  DIV[]                     rect=1165,561  82x140  ← its text, 34px ABOVE its own box
BUTTON[video-restore-btn]   rect=1207,551  64x44   ← buried under that text
```

`callFrameBody` did not clip. A message too tall for a 132-point preview rendered 140 points high in
a 72-point box, centred, so it overflowed **upwards** across the header and took every tap meant for
Hide, minus and maximise. The buttons were painted, visible, and inert — which is exactly what the
owner reported and which no unit test could have seen.

The suite had been using `click({ force: true })`, which skips Playwright's hit-target check. That
is how a real defect reported success while the events went to a paragraph of text. Every press is
now unforced, and a blocked one fails naming what is in the way.

**A pre-existing classroom crash, found only by rendering.** Both classrooms returned `null` for the
wrong role on a line above about forty hooks. On a cold open — a refresh, or a shared link — the
first render ran three hooks and the next ran forty, and React threw error 310. Proved pre-existing
by reproducing it on a code path this task had not touched. This is the `authguard-role-cast-crash`
hazard already in memory, in two more files.

**Two test-harness mistakes of my own, both recorded because they were briefly mistaken for
defects:** the teacher grant needed a real tier key (`tier4`, not `unlimited`), and the classes the
room tests used were 30 minutes out, outside the ten-minute door — seven checks failed until they
were moved inside it. Neither was a product fault.

**Three findings in my own diff, on a deliberate adversarial re-read after the suites were
green.** All three were real and all three are fixed, with a check each:

1. **A test booking raised `teacher_profiles.total_students`** — a *public* number, which Discover
   sorts on and the teacher's profile shows. Nobody taught that student. It is not revenue, so it
   slipped past the "exclude it from money" rule, and it is precisely the fabrication this project
   keeps finding wearing a different column. The seat count still moves, because the seat is
   genuinely taken.
2. **With the switch off, a dormant test row still answered "you already have it"** while the
   classroom refused the same person — the exact contradiction that once had students staring at
   "Booked & paid" for a class they had been dropped from. The short-circuit is now gated on the
   same `admitsTestEnrolment` the door uses, so with the switch off the booking runs on: they are
   charged properly and the dormant row is upgraded in place to a real paid one.
3. **The payment webhook could have promoted a `test` row to `paid`.** Unreachable today — the
   gateway is never called for a test booking, so it has nothing to send a callback about — but
   the guard costs one condition in the `where` and the cost of being wrong is a booking nobody
   paid for appearing in the earnings.

**Splitting `notify.ts` broke a drift-detector, which is what it is for.**
`utils/notificationKinds.test.ts` reads `NotificationKind` out of the server's source text to
prove the app's socket union covers every kind the server can send. Moving the declaration into
`notificationEmails.ts` made three app tests fail with "did it get renamed?" — the test doing
exactly its job. Pointed at the new file.

**Three test-harness faults of my own, each of which looked like a product bug:** the rendered
suite routed to `/(student)/teacher/:userId` when that route keys on the *profile* id
(`.agents/memory/teacher-id-convention.md`) and rendered an empty page; the profile screen opens on
the **Live** tab when a class is running, so the Upcoming block holding the Book button was never
drawn; and the laptop pass booked the shared spare class, so the narrow pass found the student
already enrolled and reported "the button is missing on a phone" — a fixture leak wearing the
costume of a layout bug. Fixtures are per-viewport now.

**A dialog that is dismissed is a dialog nobody read.** `confirm()` is `window.confirm` on web, so
the booking confirmation never reaches `document.body`. The harness dismissed it without looking,
which is how a suite can watch a booking succeed and never notice the sentence announcing it names
a payment method nobody used. Dialog text is captured and asserted now.

**Postgres stopped mid-run**, which showed up as `register student: 500` and looked briefly like a
regression in the notify split. It was `connect ECONNREFUSED 127.0.0.1:55432` in the server log —
the container's database had gone, not the code. It stopped three more times over the session, twice taking `test:phone` and `test:uploads` down with it; both passed on a re-run. `/tmp/ensure-env.sh` now brings Postgres and the API back before every suite.

**`overline` uppercases its text**, so the first rendered assertion for the label failed against
"TEST — NO PAYMENT WAS PROCESSED". The assertion is case-insensitive now; the banner was correct
the whole time.

## Fabrications found

None found in this session.

## Deliberately not changed

- **Daily.** No room logic, no token logic, no provider selection. `VIDEO_PROVIDER` still decides
  and still defaults to Daily; `test:video` (16/16) and a check inside `test:test-student` confirm
  the provider in the room response is whatever the server was configured with.
- **Stream.** Untouched at `8550631` on its own branch, not merged, not referenced.
- **Payment mode.** `lib/payments.ts` is unmodified. Test access is a branch *before*
  `chargeForSession`, not a change to what it does.
- **Booking atomicity.** The transaction and its row lock are unchanged; the test decision was
  placed inside them.
- **`main`, `codex/staging-preview-integration`, Railway, Cloudflare, production data, credentials,
  DNS, billing.**
- **Every money query.** No `payment_status = 'paid'` condition was widened. A test enrolment is
  excluded from earnings, refund debt, the drop route, schedule-change compensation and the
  invitable-students list *because* those queries were left alone.
- **Correction items 1–5.** Reconciled with evidence, not rewritten.
- **`teacher_profiles.total_students` is not incremented when a dormant test row is upgraded to a
  genuine paid one.** The test booking deliberately did not count it, and the upgrade path leaves
  it alone because Codex's instruction for that fix was explicit: "no new seat/count". The result
  is a public count that is short by one in the narrow case where a test student later pays for
  the same class. It is the safe direction — understating a real number rather than inventing one
  — and it matches how a leftover `pending` row has always upgraded. Worth revisiting only if that
  path stops being a testing artefact.
- **The Messages contact list still counts `paid` only** (`routes/messages.ts`, the "In your
  class" / "Your teacher" suggestions). So a test student does not see their test teacher among
  the people they can start a conversation with, and vice versa. It is the same audience-shaped
  query as the two that were fixed, and it was left because it is not on the classroom path this
  feature exists for and because "who may message whom" is a surface that deserves its own
  thought rather than being widened in passing. The class's own thread — the one a teacher uses
  to say they are running late — does reach them, which is the case that mattered.
- **Earnings, refund debt, the drop route, schedule-change compensation and the invitable-students
  list were not touched.** They still ask for `payment_status = 'paid'` alone. `activeEnrolmentStatuses()`
  says so in its own doc comment, because it is the obvious function to reach for when widening one
  of them, and doing that would put a booking nobody paid for into somebody's revenue.

## Migrations and deploy order

Two new tables, no column added, changed or dropped:

- `test_student_grants`
- `test_classes`

**Order matters, and only one way round is safe.** `db:push` **first**, deploy **second**. New
tables are invisible to the old code, so pushing them early breaks nothing; deploying first would
give the new code tables that do not exist yet. See `.agents/memory/schema-change-deploy-window.md`.

**Rollback:** revert the deploy. The two tables can be left in place — nothing else reads them, and
dropping them would lose the audit trail of who could book for free and who said so. Any `test`
enrolment rows already written stop opening anything the moment `ALLOW_TEST_STUDENT_ACCESS` is unset;
they are never counted as revenue by either version of the code, because both ask for `'paid'`.

## Remaining risks / next pickup point

- **Rendered is not a phone.** Everything visual here was proved in headless Chromium at two
  viewport sizes. A real Android handset, a real rotation, a weak GPU and a real Daily call are
  still unmeasured. This is the single largest gap in the release candidate.
- **The two switches must both be off before public launch,** and no active grant of either kind
  should remain. Turning them off is sufficient — grants stop mattering without being found — but
  the check is worth doing so nobody is surprised later.
- ~~Nothing here has been deployed or merged.~~ **Superseded 4 Sep 2026.** Codex fast-forwarded
  `main` from `2663ac2` to `999fe3b` and it is live. See
  `.agents/memory/production-test-release-live.md` and
  `.agents/worklog/2026-09-04-codex-production-test-release.md` (branch
  `codex/production-release-log`), and the reconciliation audit appended below.


---

# Post-release reconciliation audit — 4 Sep 2026

- Agent: claude (secondary), reconciling against Codex's release
- Commit audited: **`999fe3b`**, verified byte-identical to `origin/main` and to
  `origin/claude/production-test-release-candidate` (`git diff --stat` between them is empty)
- Nothing was changed, deployed or merged by this audit.

## What was verified about **production**, not just the source

| Check | Result |
|---|---|
| `origin/main` | `999fe3b`, and contains the release candidate exactly |
| Stream POC in `main`? | **no** — `8550631` still isolated (`git merge-base --is-ancestor` says no) |
| `GET /api/healthz` | `200 {"status":"ok"}` |
| Protected routes with no token | `/sessions/:id/access`, `/sessions/:id/room`, `/teachers/me/plan-eligibility`, and `POST /admin/{students,teachers}/:id/test-access`, `POST /admin/users` — **all 401** |
| Does a 401 write anything? | No. `middlewares/activityLog.ts:28` returns before recording on any status ≥ 400, so these probes left no trace. |
| Deployed web bundle | `entry-da308df1a79efb1e2a688f67e07be405.js`, and it contains **both** labels (em dash as `\u2014`), plus `canBookAsTest`, `testBookingLabel`, `testClassLabel`, `Take a test place`, `no payment was taken`. The deployed artefact **is** the audited code. |
| Ordinary production classes | `GET /api/sessions/2707`, `/2687` and a 20-row listing: **no** `testClass`, **no** `testClassLabel`, and **no booking-level field on any class row**. Nothing is blanket-marked. |

## Gates re-run against the deployed commit on this checkout

typecheck 4/4 packages · api unit **294/294** · app unit **213/213** · design ratchet unchanged
(205 hex / 418 sizes, no new leaks) · `test:test-student` **108/108** · `test:test-access` 26/26 ·
`test:reset` 25/25 · `test:admin` 58/58 · `test:operators` 50/50 · `test:tiers` 31/31 ·
`test:video` 16/16 · `test:payments` 10/10 · `test:sessions` 56/56 · `test:journey` 57/57 ·
`test:test-access-ui` **72/72** · `test:lobby` 90/90 · `test:classroom` 47/47 · `test:gates` 10/10.

## Adversarial re-read of the payment-truth split

- `admitsTestEnrolment` (`testStudentAccess.ts`) requires `payment_status === 'test'` **and** the
  kill switch, so a `paid` row can never produce `viaTestAccess`. All three server sites that emit
  `testBooking` derive from it (`sessions.ts:697`, `1482`, `1529`) — there is no path from a class
  fact to a no-payment claim.
- `canBookAsTest` (`sessions.ts`, inside `GET /sessions/:id/access`) takes the user from
  `req.user!.userId`. That route reads **nothing** from `req.query` or `req.body`, so a client
  cannot nominate somebody else or assert eligibility.
- `activeEnrolmentStatuses()` has exactly three callers — `participation.ts:185` (roster),
  `sessions.ts:1164` (the class-went-live audience) and `sessionMessages.ts:95` (the thread
  audience). None is a money query; all nine `= 'paid'` money conditions are untouched.
- Client-side, the booking label renders only from `session.enrolment === "test"` or the server's
  `testBooking`; the class label only where `showTestClass` is passed, which is the teacher's own
  list alone.

## Finding — not release-blocking, pre-existing, slightly widened

**`GET /api/sessions?studentId=N` is unauthenticated**, and when `studentId` is supplied it returns
that student's own enrolment status per class (`sessions.ts:117` has no `requireAuth`; the
enrichment is at ~`:130`). Anybody who knows a numeric student id can list which classes that
student holds and whether each is `paid`, `refunded` or now `test`.

- **Pre-existing.** The same unauthenticated route and the same `["paid","refunded"]` enrichment
  are present at `2663ac2`, the commit `main` sat on before this release.
- **What this release added:** `test` joins that set while the switch is on, and every row now
  carries `testClass`/`testClassLabel`. So the leak now also reveals *that a given student id holds
  operator-granted free access*, and which classes are test-enabled.
- **Not a money or access defect.** No name, email or contact detail is exposed; nothing here lets
  anybody book without paying.
- **Smallest safe fix, if the owner wants it:** put `requireAuth` on `GET /sessions` and serve the
  `enrolment` enrichment only when `parseInt(studentId) === req.user.userId` (or drop the query
  parameter and read the caller from the token, as `/sessions/invitable-students` already does).
  That is a behaviour change to a route six screens call, so it belongs in its own slice with its
  own tests — **not** a hot patch on a live release.

**No change was made to `main`.** Nothing found here meets the bar the brief set for touching a
live release.

## Attempted, and deliberately not done

- **No production grant, session, user, payment or ticket was created.** The owner has not yet
  supplied the teacher and student emails, and no account was guessed.
- **No direct SQL grant**, per Codex's note and the memory note: the operator routes are what check
  eligibility, close a previous grant, write the activity row and notify the person.
- No deploy, no `main` change, no Railway/Cloudflare/Neon/Daily/billing change, no Stream merge.

## Still unmeasured after this audit

Everything about a **real Daily call on real hardware**: two-device media, screen share readability,
the call window under a real rotation, whiteboard latency on a cheap Android, a large PDF over the
phone bridge, and battery/thermal behaviour. `LIVE-TEST-SCRIPT.md` is the checklist for it. No claim
in this entry rests on a physical device.
