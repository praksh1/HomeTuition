# Learning Program Phase 2A — the teacher program studio

- Date: 2026-09-08
- Agent: claude
- Branch: `claude/learning-program-phase2`
- Base commit: `a1527f3` (Phase 1, approved by Codex at `d5f7fc0`; durable review `a3894fe`)
- Status: complete — awaiting Codex review. **Not merged, not deployed.**

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
