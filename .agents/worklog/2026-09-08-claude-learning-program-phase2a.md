# Learning Program Phase 2A — the teacher program studio

- Date: 2026-09-08
- Agent: claude
- Branch: `claude/learning-program-phase2`
- Base commit: `bfa35dc` (Codex's second Phase 2A review, on `codex/learning-program-foundation`)
- Status: complete — corrections made after Codex review rounds 1 and 2; awaiting review round 3.
  **Not merged, not deployed.**

## Requested

The premium **teacher-only** program studio on top of the Phase 1 API: a program home, a create
flow with five distinct kinds, the studio itself with progressive disclosure, a module editor with
no drag gestures, and a review-and-publication screen. Established design tokens only. Reuse the
Phase 1 APIs and validation; duplicate no business rules in screen code. Do not change schema, run
`db:push`, touch payments/booking/membership/refunds/video/sockets/production config, or build
student-facing discovery. Prove it with focused tests, the full gate set, and the whole flow
rendered at 390×844 and 1440×900.

## Changed

New:

- `artifacts/sikshya/utils/learningProgramUi.ts` — every UI decision as a pure function, so the
  screens hold no rules. Status chips, `publishBlock`, `programActions`, `publishOffer`,
  `confirmCopy`, `saveChip`, `wouldLoseWork`, `studioSections`/`fieldsShownFor`, `placeIssues`,
  `moveModule`/`canMoveUp`/`canMoveDown`, `draftDiffers`, `saveBody`, `groupPrograms`.
- `artifacts/sikshya/utils/learningProgramUi.test.ts` — 49 tests.
- `artifacts/sikshya/components/programs/ProgramPieces.tsx` — chip, button, card shell, section
  heading, failure and notice.
- `artifacts/sikshya/components/programs/ProgramHome.tsx`
- `artifacts/sikshya/components/programs/ProgramTypeChooser.tsx`
- `artifacts/sikshya/components/programs/ProgramStudio.tsx`
- `artifacts/sikshya/app/(teacher)/programs/index.tsx`, `new.tsx`, `[id].tsx` — thin screens that
  do the fetching and own the draft.
- `artifacts/sikshya/scripts/program-studio/run.mjs` — renders the real components in Chromium at
  both sizes; 170 assertions.

Modified:

- `artifacts/sikshya/app/(teacher)/_layout.tsx` — three `href: null` routes, so Programs is reached
  from the dashboard rather than becoming a seventh tab.
- `artifacts/sikshya/app/(teacher)/index.tsx` — the dashboard entry card.
- `artifacts/sikshya/package.json` — `test:programs-ui`.
- `artifacts/sikshya/scripts/bundle-for-browser.mjs` — `global: "globalThis"` (see Problems).
- `.agents/memory/accessibility-state-does-not-reach-the-web.md` + index entry.

## Decisions and assumptions

- **The draft lives in the screen, not the studio.** `ProgramStudio` is given a value and a setter.
  A component that re-derived its own state from the last server response would drop whatever was
  typed while a save was in flight, which on a Nepali connection is a sentence.
- **`saved` is only ever the API's word.** The state machine is `clean → unsaved → saving →
  saved | failed`, and a failed save stays failed until another is attempted rather than being
  overwritten by the next keystroke.
- **Delete is withheld on history, not on current status.** `version > 0 || published` — a program
  taken down is a draft again, and deleting it would still destroy the record of what students were
  promised. The absence is explained on screen rather than left as a missing button.
- **Approval is explained before incompleteness.** A teacher in review cannot publish however
  complete the draft is, so naming a missing field first would send them to fix something that
  would not have unblocked them. Same order as the server.
- **No validation in the client.** Every issue drawn came from the server; `placeIssues` only
  decides where it goes, and anything it cannot place is shown in Review rather than dropped.

## Verification

Every command below was run in this container and its result is what is written.

| Command | Where | Result |
|---|---|---|
| `pnpm run typecheck` | repo root | 4/4 packages clean |
| `pnpm run test` | `artifacts/sikshya` | 310 pass, 0 fail |
| `pnpm run test` | `artifacts/api-server` | 474 pass, 0 fail |
| `pnpm run test:programs` | `artifacts/api-server` | 212 pass, 0 fail |
| `pnpm run test:programs-ui` | `artifacts/sikshya` | 170 pass, 0 fail |
| `pnpm run lint:design` | `artifacts/sikshya` | no new leaks (94 hex / 282 sizes, unchanged) |
| `pnpm run test:nav` | `artifacts/sikshya` | 41 pass, 0 fail |
| `pnpm run test:dashboard` | `artifacts/sikshya` | 6 pass, 0 fail |
| `git diff --check` | repo root | clean |

`test:programs` needs the local Postgres on port 55432, which this container does not start on its
own: `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/fadko -o '-p 55432'
-l /tmp/pg-fadko.log start"`. `test:nav` and `test:dashboard` additionally need the API on 8080.

**Rendered and looked at**, both sizes, 32 screenshots in `/tmp/program-shots` (override with
`PROGRAM_SHOT_DIR`): home loading / empty / failed / list, the chooser, the studio for a custom, a
practical skill and an exam program, the five save states, issues placed on fields and steps,
review for never-published / in-step / changes-pending, the unapproved-teacher lock, published,
archived, a server conflict, and the archive confirmation. Both viewports: no sideways scroll, no
clipped label, no control under 44 points.

This is a rendered browser, not a phone. Nothing here was run on an Android device.

## Problems and surprises

1. **The render suite showed an empty page from the second scene onward.** Every assertion after
   the first failed against nothing, and no error boundary caught anything. The cause was
   `ReferenceError: global is not defined`, thrown **asynchronously** from React Native's `Animated`
   frame callback the moment a `Skeleton` was on screen: Metro defines `global` for every React
   Native bundle and esbuild does not. Because it was asynchronous, no boundary saw it, React tore
   the root down, and the page went blank with the failure pointing at the wrong place entirely.
   Fixed in `scripts/bundle-for-browser.mjs` with `define: { global: "globalThis" }`, alongside the
   `__DEV__` define that is there for the same class of reason. Cost roughly an afternoon.

   Two earlier self-inflicted versions of the same afternoon: a `useState` called inside a
   conditional branch of the harness (a conditional hook, which throws on the first scene change),
   and a comment inside the entry template literal that contained backticks and ended the string.
   Both are noted in the file so the next person does not repeat them.

2. **`accessibilityState` does nothing on the web.** The first step's Move up button was drawn
   faded and announced to a screen reader as an ordinary available button, because React Native Web
   0.21 ignores `accessibilityState` and reads `aria-disabled`. A screenshot review would have
   passed it. Written up in `.agents/memory/accessibility-state-does-not-reach-the-web.md`; the
   program components now pass both spellings. **Eighteen call sites elsewhere in the app still
   have only the native one and are still wrong** — out of scope here, listed in the note.

3. **An icon glyph is part of a button's text.** `@expo/vector-icons` renders a Feather icon as a
   Private Use Area character (U+F204 here) inside the element's text, which `trim()` does not
   remove and which prints as a leading newline. An equality assertion against the words failed and
   the failure looked like a layout bug. Match the words instead; the suite says so at the point it
   matters.

4. **Three things the rendered pass caught that the unit tests could not**, all now fixed and all
   with a check that fails without the fix:
   - the back link was 22 points high — half the touch floor, and the easiest control on the page
     to miss with a thumb;
   - **Save draft sat below Publish, Archive and Delete**, so a teacher who had typed a paragraph
     had to scroll past the red button to keep it. Moved above the review section;
   - at 1440 the page ran the full width and read as an admin table. Capped at 760 and centred, the
     same convention `app/(teacher)/index.tsx` already used.

## Fabrications found

**One, mine, caught in the rendered pass.** A published program whose draft matched what students
already see displayed *"This matches what you have written here"* directly above a primary button
reading *"Publish your changes"* — changes the same screen had just said did not exist. Each line
was defensible alone, which is why reading them as a pair is now what the check does. Fixed with
`publishOffer()`: "Publish" for a draft, "Publish your changes" when the draft is ahead, "Publish
again" when it is not. The action is still offered, because the server accepts a republish; only
the words were wrong.

No invented counts, ratings, prices, earnings, popularity or availability. Two checks stand guard:
a unit test that walks every string the derivation layer can produce, and a rendered check that
reads the whole page text for the same claims. Both were written before the screens.

One honest gap rather than a fabrication, flagged for the owner: the archived chip says "Students
cannot see it" and the unpublished notice says "Students still see the version you published".
Those are true of the public API that Phase 1 shipped, but **no student-facing browsing screen
exists yet**, so a teacher who publishes today will not be found by anybody. Saying so is a product
decision about an unbuilt feature, so nothing was invented on screen; it belongs in Phase 2B.

## Deliberately not changed

Schema, `db:push`, and every Phase 1 route — the studio consumes them unchanged. Payments,
subscriptions, booking, membership, refunds, Daily, LiveKit, classroom sockets, production config.
No student-facing program discovery. The eighteen `accessibilityState` call sites outside
`components/programs/`. The teacher tab bar still has six tabs; Programs is a dashboard entry, the
same pattern `monthly` and `session-create` already use.

## Remaining risks / next pickup point

- **Never opened on a real Android phone.** Everything visual here is Chromium at two viewport
  sizes. The touch-target floor is measured, not felt.
- **The screens' wiring to the API is proven only by shape.** `utils/learningProgramUi.test.ts`
  proves the decisions, `scripts/program-studio/run.mjs` proves the drawing, and
  `api-server/scripts/learning-program-tests` proves the routes — but nothing drives a browser
  against a live server through the whole create → write → publish path. The three screens are
  deliberately thin for that reason; it is still a gap and it is the first thing I would close.
- The unapproved-teacher lock is drawn from the profile the app already holds. It decides only
  which explanation shows — the server checks approval itself at publication — so a stale value can
  make the screen optimistic and can never make a publication happen.
- Next: Codex review of this branch. After that, Phase 2B is student-facing discovery, which is
  what makes the "students can see it" sentences on this screen true.

---

# Correction round 1 — after Codex's review of `324e854`

Codex's review is `.agents/worklog/2026-09-08-codex-learning-program-phase2a-review.md` at `2abedbb`.
Verdict: changes required, three blocking findings and three smaller ones. All six are corrected.
The branch was rebased onto `2abedbb` first.

## What was wrong, and what it is now

**Blocker 1 — a save response could call newer typing "Saved".** `save()` compared the API's answer
with the `draft` captured in its own closure when the request left. Type during a slow PATCH and the
old response matched the old draft, so the screen wrote **Saved** over a sentence the server had
never been sent — and the teacher could then close the page believing it was safe.

Two changes in `app/(teacher)/programs/[id].tsx`:

- `draftRef` always holds the newest draft, and the answer is compared with **that**, never with
  what was sent.
- Saves are **serialized**. A save requested while one is in flight sets `queuedRef` and runs when
  the first returns, so two responses can never arrive out of order at all. Codex asked for defined
  behaviour when two overlap; the answer is that they cannot, which is the smaller mechanism.
- A save that fails does not run a queued one on top of it — that would replace the message
  explaining why the work is not on the server with a second copy of the same failure.

**Blocker 2 — lifecycle actions could publish the old draft and erase the new one.** Publish, take
down, archive and restore act on the server's copy and their answers become the editor's baseline.
Now:

- `ProgramStudio` withholds all four while `wouldLoseWork(saveState)`, and says why —
  "Save your draft before publishing or changing its status" — rather than greying a button.
- `act()` refuses to dispatch them in those states even if asked, so the rule holds at both doors.
- **Delete stays available**, because discarding is what it is for; its confirmation now says
  "Everything on this screen goes too, including the changes you have not saved."
- A successful action keeps anything typed while it was in flight: `act()` compares `draftRef`
  against what it captured at dispatch and leaves newer text alone, marked unsaved.
- Stale validation issues no longer pretend to describe the current text. While dirty: a notice at
  the top, the section chip reads "1 at your last save" in a neutral tone rather than "1 to finish"
  in amber, and the line beside a field reads "At your last save: Learning outcome is required." in
  muted grey with the field's alarm border removed. That last one mattered most — a red "required"
  under a box a teacher had just filled in is a false sentence in the app's loudest colour.

**Blocker 3 — the leave guard was a tested function nobody called.** Now wired three ways, and the
departure is **state-ordered**: agreeing to leave sets `departure`, which switches every guard off
on the next render, and an effect performs the navigation after that. A ref cannot do this — it does
not re-render, so `usePreventRemove` would still be armed and would catch the very departure it had
just agreed to. Deleting a draft with unsaved text is where that shows: the program is gone, and
asking whether to keep working on it is nonsense.

- the studio's own "‹ Programs" link;
- `usePreventRemove` from `@react-navigation/native`, for anything React Navigation drives — a tab,
  the Android hardware button, a parent popping the screen;
- `hooks/useLeaveGuard.web.ts`, a `beforeunload` listener for reload, closing the tab and the
  address bar. The native file beside it is a real no-op: a phone has none of those.

It warns for `unsaved`, `saving` and `failed`, and is silent on `clean` and `saved`.

**Smaller 1 — the chooser drew five cards whatever the server returned.** `offerableTypes()` now
intersects the server's template list with the kinds this build can describe, and the chooser renders
that. A type the server did not return is not offered; a type this build has never heard of is
skipped rather than drawn blank; a response with nothing recognizable says the app is out of step
rather than showing an empty page.

**Smaller 2 — a false claim in a comment.** `new.tsx` said fetching templates there saved the studio
a round trip. The studio fetches them again. The comment now says that, and why two small reads beat
a route parameter carrying the server's contract or a module cache serving a stale one after a
deploy.

**Smaller 3 — "Publish again" on an unchanged program.** Removed, not reworded. Codex is right that
it is not a no-op: `api-server/src/routes/learningPrograms.ts` increments `version` and writes a
fresh snapshot on every publish, so the button would have manufactured an empty version in the only
record of what students were promised. `publishOffer()` returns `null` and the screen says "Students
already have exactly this."

## The end-to-end proof

`artifacts/sikshya/scripts/program-journey/run.mjs`, wired as `pnpm run test:program-journey`.
It drives the **built web app** against the real API and the real database, signed in as a teacher
registered for the run. The only thing faked is timing: `page.route` holds the PATCH open on command,
because "type during a slow save" is the whole point.

46 checks, covering the journey Codex specified — create → type → delayed save → type again → old
response returns → still unsaved → save the newest copy → publish — plus:

- the chooser's cards compared against `GET /learning-programs/templates` asked for separately, so a
  hard-coded list cannot agree with a hard-coded expectation;
- Publish absent and never dispatched while dirty, verified against the row's `status` and `version`;
- the Back link raising the question, and the question being **in the viewport** when it does;
- `beforeunload` prevented on a reload;
- an unchanged published program leaving `version` at 1;
- deleting a dirty never-published draft: warned once, gone from the database, navigated away with no
  second question.

## Verification

Every command run in this container; results as written.

| Command | Where | Result |
|---|---|---|
| `pnpm run typecheck` | root | 4/4 packages clean |
| `pnpm run test` | `artifacts/sikshya` | 315 pass, 0 fail |
| `pnpm run test` | `artifacts/api-server` | 474 pass, 0 fail |
| `pnpm run test:programs` | `artifacts/api-server` | 212 pass, 0 fail |
| `pnpm run test:programs-ui` | `artifacts/sikshya` | 222 pass, 0 fail |
| `pnpm run test:program-journey` | `artifacts/sikshya` | 46 pass, 0 fail |
| `pnpm run test:nav` | `artifacts/sikshya` | 41 pass, 0 fail |
| `pnpm run test:dashboard` | `artifacts/sikshya` | 6 pass, 0 fail |
| `pnpm run lint:design` | `artifacts/sikshya` | no new leaks (94 hex / 282 sizes, unchanged) |
| `git diff --check` | root | clean |

Re-rendered at 390×844 and 1440×900 and looked at. New states in `/tmp/program-shots`:
`studio-at-risk`, `studio-stale-issues`, `studio-leaving` at both sizes.

Setup this container needs: Postgres on 55432
(`su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/fadko -o '-p 55432' -l /tmp/pg-fadko.log start"`),
the API on 8080, and a build for the browser suites
(`EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm --filter @workspace/sikshya run build`).

## Problems and surprises

1. **The journey test agreed with the broken code, and I nearly shipped it.** After writing it I put
   blocker 1 back deliberately to watch it fail. It did not: the check "an older response does not
   call the newer typing saved" stayed green and two unrelated checks went red instead. The settle
   condition polled until the chip read "Unsaved changes" — which the *typing* had already made true,
   so it asserted before the response existed. Now it waits on `page.waitForResponse` for the PATCH
   itself. Re-run against the bug: the right check goes red. Restored: 46/46. **A test that has never
   been seen to fail has not been shown to test anything**, and this one was two lines from being
   decoration.

2. **The leave question was drawn where nobody would see it.** It was at the foot of the studio —
   about four thousand points below the Back link on a phone. Every DOM assertion passed while a
   teacher would have tapped Back, watched nothing move, and tapped again. Moved under the header,
   and the journey now checks its bounding box is inside the viewport, not merely that it exists.

3. A comment inside the render harness's entry template literal contained backticks again and ended
   the string. Second time; the note saying not to is now on both of them.

## Fabrications found

**Two, mine, both in the last commit's own words.**

- `324e854`'s message said the studio holds the rule "never lose typed work silently". The leave
  guard was a tested pure function that no screen called, and three lifecycle actions could
  overwrite unsaved text. The sentence was true of the intent and false of the code.
- `new.tsx` carried a comment claiming its template fetch meant "the studio opens with its prompts
  already in hand — one round trip on a Nepali connection instead of two in a row". The studio
  fetches them again on open. Two round trips, described as one.

Neither reached a user's screen, which is the only reason they are the smaller kind. Both are the
same shape as the ones that do: a claim written next to code that does not make it true.

No invented counts, ratings, prices, earnings, popularity or availability; the two checks that walk
every string the derivation layer and the screens can produce still pass.

## Deliberately not changed

Phase 1's schema and routes. Payments, booking, membership, refunds, Daily, LiveKit, classroom
sockets, production config. No student-facing discovery, enrolment or scheduling. The eighteen
`accessibilityState` call sites outside `components/programs/` — still wrong on the web, still out of
scope, still listed in `.agents/memory/accessibility-state-does-not-reach-the-web.md`.

## Remaining risks / next pickup point

- **Still never opened on a real Android phone.** `usePreventRemove` and the Android hardware back
  button are wired and typechecked but exercised only through Chromium; the browser journey proves
  the Back link and `beforeunload`, not the hardware button. This is the one claim here I cannot
  back with a run.
- Browser *back* within the single-page app is covered only insofar as React Navigation drives it.
  A `popstate` from the browser chrome itself is not intercepted, and doing so reliably needs a
  history sentinel that is worth its own change.
- The three-button leave sheet (Stay and save / Leave without saving / Keep editing) is more choices
  than a sheet usually wants. It reads clearly at both sizes, but a real teacher's reaction to it is
  the sort of thing only the owner's testing will settle.

---

# Correction round 2 — after Codex's second review of `7da1036`

Codex's second review is `.agents/worklog/2026-09-08-codex-learning-program-phase2a-second-review.md`
at `bfa35dc`. Verdict: the three data-loss corrections hold, three findings remain. The branch was
rebased onto `bfa35dc` and all three are corrected.

## Blocker 3 first, because nothing else could be trusted until it was

**Reproduced exactly.** `.expo/types/router.d.ts` is gitignored and written by whichever
`expo start` or `expo export` ran last, and `tsconfig.json` includes it. So `tsc` was answering a
different question on every machine — and the question it answered for me was the easy one, because
my own web build had regenerated the file minutes earlier.

To reproduce: move `app/(teacher)/programs` aside, regenerate the route types, move it back, then
typecheck. Seven errors, on exactly the seven program navigation calls Codex named:

```
app/(teacher)/index.tsx(469,36): error TS2345: Argument of type '"/(teacher)/programs"' is not assignable …
app/(teacher)/programs/[id].tsx(219,37) … (289,37) …
app/(teacher)/programs/index.tsx(65,37) … (66,37)
app/(teacher)/programs/new.tsx(65,22) … (85,40)
```

The fix is `artifacts/sikshya/scripts/router-types.js`, run by the `typecheck` script before `tsc`.
It regenerates the declaration file from `app/` as it is on disk using **expo-router's own**
`getTypedRoutesDeclarationFile` — the same function `@expo/cli` calls from the dev server — rather
than a reimplementation of the route rules, which would drift and be worse than no check. It fails
loudly if that module ever moves, because a typecheck that silently stops checking routes is the
state this exists to end.

Proven from both broken states: with `.expo/types` **absent**, and with a **stale** file that
predates the routes. Both now pass, and `pnpm --dir artifacts/sikshya run typecheck` is the command.

## Blocker 1 — browser Back really is guarded now, and really is tested

`beforeunload` never fires for a single-page Back, and React Navigation's `beforeRemove` does not
either, because expo-router answers a browser Back with `resetRoot`, which is not a removal. My
previous report said this was unguarded; it was.

`hooks/useLeaveGuard.web.ts` now keeps **one sentinel history entry** for the URL the teacher is
already on. A Back press consumes that entry instead of leaving — the address does not change, so
the studio stays exactly as it is — and the question is raised. The discipline that keeps it from
being the infinite trap this pattern usually becomes:

- nothing is re-pushed while a question is open, so the Back the teacher then agrees to is not
  spent undoing the guard;
- "Keep editing" re-arms it, so the next Back is caught too;
- leaving for real runs `history.go(-1)` from where the sentinel was — the navigation originally
  asked for;
- saving disarms it and consumes the spare entry, so Back never needs pressing twice;
- an agreed departure disarms it **without** consuming anything, because the navigation about to run
  owns that entry.

That last rule was a bug first: consuming and navigating raced, and the loser was the departure — a
teacher who deleted a draft watched the studio stay exactly where it was. The journey caught it.

The sentinel carries expo-router's own `history.state` with one extra key, because the router finds
its position by the `id` in there; a bare object would leave it thinking it was at the start of
history.

**Tested for real**, in the browser, against the API: enter the studio from the Programs page so
genuine history exists, type, `page.goBack()`, stay in the studio and see the question, cancel and
find the text intact, Back again, confirm, and arrive where Back was going. Clean work goes back
with no question. And the reload proof is now a real `page.reload()` asserting the browser **raised**
a dialog — the previous synthetic `new Event("beforeunload")` proved a listener existed and nothing
about whether the browser would act on it. Codex was right to reject it.

## Blocker 2 — one operation at a time

`opRef` in `app/(teacher)/programs/[id].tsx` holds the single operation this screen may have in
flight, and it is set **before anything is awaited** — a React state update does not land until the
next render, and two presses a few milliseconds apart both happen before that.

- A save while a lifecycle request is out: refused.
- A lifecycle request while a save is out or queued: refused.
- A second lifecycle request while one is out: refused.
- The "is the server behind us?" test at the dispatch boundary is now `atRiskNow()` — failed save,
  save in flight or queued, or `draftDiffers(draftRef.current, acceptedRef.current)` — read from
  refs, not from the render's `saveState`, which can be a frame out of date.
- While a lifecycle request is out the studio closes every field, every step control, Add a step,
  Save, and every other lifecycle button (`editingLocked`).
- A keystroke that lands in the frame before that lock is drawn is still kept, and marked unsaved;
  `act` compares against what it captured at dispatch and leaves newer text alone.
- Text typed after Publish cannot join the publication: the POST body is `{}` and the server
  publishes the draft it already holds.

## Verification

Every command run in this container; results as written.

| Command | Where | Result |
|---|---|---|
| `pnpm run typecheck:libs` | root | pass |
| `pnpm --dir artifacts/api-server run typecheck` | root | pass |
| `pnpm --dir artifacts/sikshya run typecheck` | root, after `rm -rf .expo/types .tsbuildinfo` | pass |
| `pnpm run test` | `artifacts/sikshya` | 315 pass, 0 fail |
| `pnpm run test` | `artifacts/api-server` | 474 pass, 0 fail |
| `pnpm run test:programs` | `artifacts/api-server` | 212 pass, 0 fail |
| `pnpm run test:programs-ui` | `artifacts/sikshya` | 232 pass, 0 fail |
| `pnpm run test:program-journey` | `artifacts/sikshya` | 71 pass, 0 fail |
| `pnpm run test:nav` | `artifacts/sikshya` | 41 pass, 0 fail |
| `pnpm run test:dashboard` | `artifacts/sikshya` | 6 pass, 0 fail |
| `pnpm run lint:design` | `artifacts/sikshya` | no new leaks (94 hex / 282 sizes) |
| `git diff --check` | root | clean |

Re-rendered at 390×844 and 1440×900. One new visible state, `studio-publishing`: every field grey,
step controls faded, Add a step and Save draft dim, the running action spinning, the other lifecycle
buttons closed.

## Problems and surprises

1. **The first shape of the Back guard did nothing at all.** It disarmed itself while the question
   was open — consuming its sentinel with `history.back()` and re-pushing on cancel — and the
   resulting churn meant a real `page.goBack()` produced no question. Replacing "disarm while the
   question is open" with "do not *push* while the question is open" removed three moving parts and
   made it work. Fewer states, and each one is a sentence.

2. **The guard raced the delete.** Both the consume and the departure navigation ran, and the
   consume won: the program was gone from the database and the studio was still on screen. Fixed
   with `departing`, which disarms without consuming.

3. A transient run showed the chooser drawing nothing and the check passing anyway, because the
   test's own template fetch had also come back empty and the two agreed. The assertion now requires
   the server's list to be non-empty, so "both empty" can no longer be a pass.

4. `const locked` collided with an existing `locked` in the render suite; renamed. Caught by node's
   own parse rather than by a confusing failure, which is the good version of this.

## Fabrications found

**One, mine, in the previous round's test.** The journey claimed to prove that reloading is guarded,
by dispatching `new Event("beforeunload")` and checking `defaultPrevented`. That proves a listener
is registered and says nothing about whether the browser would raise a dialog — the thing a teacher
would actually see. It is now a real `page.reload()` asserting a real dialog.

Everything else in this round was a missing guard rather than a false claim, and the previous
worklog said plainly that browser Back was unprotected — which is how Codex knew where to look.

## Deliberately not changed

Phase 1's schema and routes. Payments, booking, membership, refunds, Daily, LiveKit, classroom
sockets, production config. No student discovery, enrolment, scheduling or Phase 2B. The eighteen
`accessibilityState` call sites outside `components/programs/`.

Codex also observed that the **root** `pnpm run typecheck` filter can skip the artifact packages on
Windows. That is a pre-existing repository issue, not one of the three findings, and changing the
root filter would touch every package's gate; left alone deliberately, and recorded here so it is
not lost. The direct per-package commands in the table above are unaffected.

## Remaining risks / next pickup point

- **Still never opened on a real Android phone.** `usePreventRemove` and the hardware Back button
  are wired and typechecked but exercised only through Chromium. The browser guard is now genuinely
  tested; the phone one is not, and that is the single largest untested claim on this branch.
- The history guard is proven in Chromium. Safari's back-forward cache and older Android WebViews
  handle `popstate` and `beforeunload` differently, and neither was tested here.
- `scripts/router-types.js` calls `expo-router/build/typed-routes/generate`, which is an internal
  path. It is the same one `@expo/cli` uses, and the script fails loudly rather than quietly if an
  Expo upgrade moves it — but it will need re-pointing at some SDK bump.
