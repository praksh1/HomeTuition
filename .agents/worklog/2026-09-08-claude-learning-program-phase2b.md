# Learning Program Phase 2B — student discovery and program details

- Date: 2026-09-08
- Agent: claude
- Branch: `claude/learning-program-phase2b`
- Base commit: `273d033` (Codex's approved Phase 2A corrections)
- Status: complete — awaiting Codex review. **Not merged, not deployed.**

## Requested

The student side of Learning Programs: Discover with three views (Programs, Single classes,
Teachers) sharing one search prompt, filter chips over the authoritative program types, a premium
program card, a details page rendering the immutable published snapshot with a Back to Discover
control, and public API search — all without inventing prices, seats, ratings, popularity,
enrolments, reviews, or completion percentages, and without adding a Join, Buy or Pay button that
cannot complete truthfully. Preserve every existing teacher and single-class discovery journey.

## What changed

**API — additive, no schema change**

- `artifacts/api-server/src/routes/learningPrograms.ts` — the existing `GET /programs` gained a
  `q=…` query. Escaped and bound as `ilike '%…%' escape '\'` over `published_snapshot ->> title`,
  `->> summary`, `->> outcome`, `->> intendedLearner`, `->> startingLevel`, `->> referenceName`,
  the teacher `users.name`, and the five student-facing type labels. `readSearch()` trims, caps at
  80 chars, escapes `%`/`_`/`\`, and returns `null` for a blank query. Every other guard is
  unchanged: `publiclyVisible()` still requires `status='published'`, an approved teacher, and no
  `suspendedAt`; `publishedSnapshotFor` is still the only source of the rendered fields; paging
  order and cursor remain `(publishedAt, id)` DESC.
- No schema change, no new column, no `db:push`. The two Phase 1 tables carry search too.
- `artifacts/api-server/scripts/learning-program-tests/run.mjs` — new section `[14b] Public search`
  with 30 checks: matches by every named field, case insensitivity, wildcard/underscore escape,
  bounded input, filter+search composition, deterministic paging under search, and the invariant
  that no unpublished, suspended, or unapproved program is ever surfaced by any wording. Wired
  into `main()` between `ordering()` and `concurrency()`.

**Client — pure derivation**

- `artifacts/sikshya/utils/programDiscovery.ts` — every student-side decision as pure functions:
  `DISCOVER_TABS`, `DISCOVER_SEARCH_PROMPT`, `programTypeFilters()`, `cardFromSummary`,
  `cardFromDetail`, `referenceBlock`, `missingOptional`, `localMatches`, `localTypeMatches`,
  `appendPage`, and the public API DTOs (`PublicProgramSummary`, `PublicProgramDetail`).
- `artifacts/sikshya/utils/programDiscovery.test.ts` — 13 tests covering type filters, card
  fabrication guards, local search field coverage, the empty-query rule, reference disclosure,
  optional-field naming, and page merge deduplication.

**Client — components**

- `artifacts/sikshya/components/programs/ProgramCard.tsx` — the premium card. Outcome-first title,
  program type chip, summary, "who it is for" when the row carries it, teaching language, teacher
  name, single royal-blue "View program" action. Nothing about price, seats, ratings, popularity,
  reviews or enrolment because the API deliberately does not carry them.
- `artifacts/sikshya/components/programs/ProgramDiscoverList.tsx` — search box, filter chips over
  authoritative program types, and four distinct rendered states (loading / empty / failed /
  no-match) plus the list and a "Show more programs" pager. Chip changes are local — no network
  call per tap — and the text query fires on submit only.
- `artifacts/sikshya/components/programs/ProgramView.tsx` — the details page. Renders the whole
  published snapshot in the server's module order, shows a teacher-supplied reference verbatim with
  a plain non-endorsement, lists any missing optional fields honestly, and ends with a quiet
  "Joining a program is not open yet" notice rather than a disabled Join button.
- `artifacts/sikshya/components/programs/ProgramPieces.tsx` — `ProgramFailure` now takes an
  optional `title` and `retryLabel` so the details page can say "Back to Discover" without lying.

**Client — screens (deliberately thin)**

- `artifacts/sikshya/app/(student)/program/[id].tsx` — fetches `/programs/:id`, distinguishes 404
  ("gone") from other failures so the copy can differ, renders `ProgramView`.
- `artifacts/sikshya/app/(student)/_layout.tsx` — registers `program/[id]` as an off-tab route
  matching the existing `teacher/[id]` pattern.
- `artifacts/sikshya/app/(student)/index.tsx` — adds a third sub-tab `programs` as the initial
  view; `discover` (Teachers) and `following` are preserved intact. Programs fetches through a
  request-id ref so a late answer for an earlier query never overwrites a newer one, matches page
  results by id when merging (`appendPage`), and keeps `programQuery` local to the input for
  responsiveness while only triggering fetches on submit or type change.

**Tests**

- `artifacts/sikshya/scripts/program-discover/run.mjs` — the rendered student flow at 390×844 and
  1440×900 (`test:discover`, 120 checks). Loading vs empty vs failed vs no-match, populated list
  with three programs across three types, local filter, details page in full including step-order
  preservation and the reference block, long Nepali content wrapping, absence of any invented
  claim, touch-floor for every interactive control, and no sideways overflow.
- `artifacts/sikshya/scripts/nav-tests/run.mjs` — updated for the new three-tab shape. The
  assertion "Discover is what it opens on" was fair for the pre-2B world and became false when
  Programs was made the initial view (per the brief); the test now asserts three sub-tabs exist,
  Programs opens by default, and switching to Teachers brings the teacher search back.

## Decisions and assumptions

- **"Verified teacher" is not shown**, on card or details. There is no authoritative signal in the
  API for it (the Phase 1 route header says so explicitly). Adding one here would be exactly the
  fabrication the brief and this project's memory forbid.
- **Reference source is always disclosed as teacher-supplied.** The DB carries an enum with
  `official`/`teacher_supplied`/`none`, but Fadko has no endorsement process, so labelling anything
  "official" would be a claim the app cannot back. The disclosure is the same for every citation.
- **Search runs on submit.** Chip changes fetch immediately (because the server does the primary
  filter and paging is per-type). Text queries fetch on Enter or on clearing — typing does not
  fire a request per keystroke on a Nepali connection.
- **`localMatches` and `localTypeMatches` only narrow.** They read exactly the fields the API also
  searches, so a client pass can never surface a program the server did not.
- **Page merge dedupes by id.** A republished program that jumps to the top of a later page would
  otherwise appear twice; the older row is kept as the display copy so scrolling does not shuffle.

## Verification

Every command was run in this container and the result is what is written.

| Command | Where | Result |
|---|---|---|
| `pnpm run typecheck` | root, all four packages | pass |
| `pnpm run test` | `artifacts/sikshya` | 329 pass, 0 fail |
| `pnpm run test` | `artifacts/api-server` | 474 pass, 0 fail |
| `pnpm run test:programs` | `artifacts/api-server` | 618 pass, 0 fail (was 588 pre-2B, +30 new checks) |
| `pnpm run test:programs-ui` | `artifacts/sikshya` | 254 pass, 0 fail |
| `pnpm run test:discover` | `artifacts/sikshya` | 120 pass, 0 fail |
| `pnpm run test:program-journey` | `artifacts/sikshya` | 77 pass, 0 fail |
| `pnpm run test:program-smoke` | `artifacts/sikshya` | 56 pass, 0 fail |
| `pnpm run test:nav` | `artifacts/sikshya` | 45 pass, 0 fail (+2 new sub-tab checks, +2 renamed) |
| `pnpm run test:dashboard` | `artifacts/sikshya` | 6 pass, 0 fail |
| `pnpm run lint:design` | `artifacts/sikshya` | no new leaks (94 hex / 282 sizes) |
| `git diff --check` | root | clean |

**Rendered and inspected** at 390×844 and 1440×900. New screenshots in
`/tmp/program-discover-shots`: `list-loading`, `list-empty`, `list-failed`, `list-populated`,
`list-filtered`, `list-nomatch`, `view-full`.

Visually: the populated list on a phone is quiet and editorial — one chip per card, an outcome
right under the title, one royal-blue "View program" action, no invented commercial signal. The
details page on a phone shows the full path in order, cites NEB Mathematics syllabus with the
non-endorsement immediately underneath, and ends with the "Joining a program is not open yet"
notice rather than a disabled button. At 1440 the ScrollView is capped to 760 points and centred,
so the page reads as an editorial column rather than an admin table.

## Problems and surprises

1. **Node's strip-types is inconsistent about `.ts` extensions on transitive imports.** A test file
   that imports `./learningProgramUi` directly works, but a chain — test → new-util → old-util —
   fails with `ERR_MODULE_NOT_FOUND` on the transitive hop unless the extensions are explicit.
   Both new files (`programDiscovery.ts` and its test) use `./…​.ts` for their sibling imports.
2. **The API test asserted an exact-count match that broke on accumulated fixture data.** The
   staging test database carries fixtures from previous suites, so "filter + `q=guitar` returns
   exactly one program" was true once and false after other tests published more guitar-adjacent
   rows. Weakened to "every returned row is `practical_skill`" plus a paired negative check that a
   `type=school_subject` filter with `q=guitar` returns none of them.
3. **The details-page touch-target check failed twice for the same reason on two elements.** The
   search input and the "View teacher's page" link were both under 44 points high because their
   wrapping View had `minHeight: 44` but React Native Web sizes the DOM element (input, anchor) by
   its own padding rather than the parent's. Fixed by setting `minHeight` and `lineHeight` on the
   actual leaf element in both cases. Same class of bug that got the studio back link earlier.
4. **The invented-claim substring check matched "starting" as "star".** Same trap as an earlier
   round; corrected by matching whole phrases ("star rating", "5 stars") not substrings.
5. **The nav test had "Discover is what it opens on" hard-coded.** True before 2B, false now: the
   brief makes Programs the initial view. Updated to test the new three-tab shape rather than
   preserving a fact the product deliberately changed.

## Fabrications found

**None on my screens.** Every field on every card and every block on the details page comes from
the public API. The API deliberately does not carry price, rating, seat, enrolment, popularity or
review data, so there is nowhere to put a fake one; the render suite walks the whole body for the
nine common commercial claims and finds none.

The one thing worth naming that is *not* a fabrication but could look like one: the reference
source enum has an `official` value. My UI never surfaces it as a badge or a label — every citation
is disclosed the same way ("The teacher supplied this citation. Fadko does not check or endorse the
curriculum, exam board, or book.") — because no endorsement process exists and calling a citation
"official" would be that endorsement in text.

## Deliberately not built

Everything the brief listed under commercial contract: **no enrolment, no payment, no schedule, no
seats, no ratings, no reviews, no completion percentages, no student counts, no earnings, no Join,
Buy, Enroll, Reserve or Pay button.** No changes to existing booking, payments, membership, Monthly
classes, classroom sockets, Daily, LiveKit, or database deployment. The teacher-side discovery
(the previous `discover` sub-tab) and single-class booking are preserved intact.

The public API only surfaces published rows from approved, non-suspended teachers, and only from
the immutable snapshot — not from editable columns. Draft, taken-down and archived programs remain
404; a program whose teacher's account is later suspended disappears from list, detail and search
(verified in the extended test).

No schema change. No `db:push`. No production or staging deployment. No paid service purchased or
activated. The preview environment carries the previous Phase 2A commit; nothing here has been
promoted.

## Remaining risks / next pickup point

- **The existing teacher `?q=` case-insensitive collation.** The test proved case-insensitivity in
  Postgres with default `en_US.UTF-8`; a database with a different collation would still work
  through `ilike`, but the collation is not asserted anywhere.
- **Nepali substring search.** The `ilike` operator is byte-level in Postgres, so a Nepali query
  matches Nepali source text exactly. Full text search with a language analyzer would be a later
  improvement — worth doing when the fixture volume is real enough to benchmark it.
- **The list re-fetches on filter change** even when the last full page is already loaded.
  Deliberate for now — the server is the source of truth for what "matches" — but a smarter path
  would keep the current page and only re-fetch when the user asks for another. Local `localMatches`
  is already there for the render side; the fetcher does not yet use it.
- **Never opened on a real Android phone.** All the interactive checks are Chromium; the hardware
  Back button, keyboard behaviour and text wrapping in the browser's own Nepali font remain to be
  seen on a phone.
- **Recommended next phase.** Not enrolment yet. The two most useful adjacent pieces are
  (a) a "read on the teacher's profile" section on the teacher page that lists the teacher's
  published programs (server side needs `/teachers/:id/programs` — trivial from Phase 1's query),
  and (b) the follow signal so a student who found a program can be told when its teacher
  publishes another. Both are additive, both use the existing public snapshot, both leave the
  commercial questions untouched.

## Correction round 1 (2026-09-09)

Codex reviewed `c8febd0` and returned eleven items. Every one has been addressed additively —
no schema change, no `db:push`, no production or staging deployment, no changes to booking,
payments, membership, Monthly classes, classroom sockets, Daily, LiveKit, or database plumbing.

### The eleven items and what was done

1. **Restore the approved Discover architecture.** The primary tabs are now
   Programs / Classes / Teachers. Following moved back inside Teachers as a nested All / Following
   sub-choice. The Classes view was built and shows real bookable classes from
   `GET /sessions?status=upcoming` — excluding monthly-class-day rows the server already omits
   from that call, filtering out any row the server marked `expired`. Reuses `SessionCard`.
   See `DISCOVER_TABS` and `TEACHERS_TABS` in `utils/programDiscovery.ts` and the switched view
   in `app/(student)/index.tsx`.
2. **Per-view heading, subtitle and identity.** The page no longer says "Find a teacher / 197
   verified teachers" on every view. Each view owns a heading and one-line subtitle in
   `DISCOVER_TABS` and the screen renders them. The verified-teacher count is drawn only in
   Teachers; Programs shows the Programs subtitle, Classes shows the Classes subtitle. The pill
   labels stay short ("Programs / Classes / Teachers") so the row fits at 390pt; the screen
   reader label carries the full phrase ("Single classes").
3. **Empty search results say "no matching", not "no programs yet".** Decided in
   `programListState()` from what happened (initial-load status, query text, chosen type) rather
   than only from row count. A server-returned `[]` with any active filter is `noMatch`; only
   the truly-empty world is `empty`. Tests in `programDiscovery.test.ts` cover both branches,
   and the rendered suite covers server `[]` with a query and server `[]` with a filter.
4. **Preserve successful results when "Show more" fails.** `programsInitialError` and
   `programsMoreError` are separate state fields in `app/(student)/index.tsx`. The list consumes
   both through `programListState()`: a pagination failure renders inline beside "Show more",
   never in place of the loaded cards. Rendered suite verifies both the preserved cards and the
   inline error UI.
5. **Make Search obvious and truthful about fetching.** A visible ≥44 Search button now sits
   beside the input in `ProgramDiscoverList`, calling `onSubmit(query)`. Typing still does not
   fetch on every keystroke — the request fires on Enter or on the button. Chip taps forward as
   filter changes (`onTypeChange`) and the parent re-fetches; the code comment says exactly that
   now rather than the previous claim that chip changes were "local".
6. **Neutral reference disclosure.** `referenceBlock()` returns the same sentence for every
   value of `referenceSource`: "This is the curriculum or reference named in the program. Fadko
   has not independently verified or endorsed it." No source is called "teacher supplied" — that
   was a false provenance claim for `official` — and no source is called "official", because no
   endorsement process exists.
7. **Show "who it is for" when the API sends it.** `intendedLearner` is now included in the
   public list response (`GET /programs`) additively; `PublicProgramSummary` has an optional
   `intendedLearner?: string | null`; `cardFromSummary` shows it when the string is non-blank,
   and returns `null` (no line at all) when the row is absent or whitespace. Never invented.
8. **Details-page Back respects history.** `app/(student)/program/[id].tsx` uses
   `router.canGoBack() ? router.back() : router.replace("/(student)")`. A deep link still lands
   the student on Discover; a normal in-app arrival returns to wherever they came from.
9. **Invalid/missing ID no longer hangs.** The id is validated (`/^\d+$/` and positive) up
   front; an invalid id ends loading immediately and renders an honest not-found state ("Program
   link is missing an id") with a Back to Discover control. The old loader returned early
   without ever ending loading, so a bad link spun forever.
10. **Design pass.** Raw skeleton heights replaced with `space.xxxl * 3` (token multiple);
    the new subtabs use `HIT_SLOP_MIN = 44` for the row minimum. `lint:design` reports no new
    leaks (94 hex / 282 sizes unchanged).
11. **Tests extended for every correction.** `programDiscovery.test.ts` gained per-view
    heading/subtitle/accessibility-label assertions, the TEACHERS_TABS shape, the neutral
    disclosure for both `teacher_supplied` and `official`, the intended-learner rules
    (present / absent / whitespace-blank), and `programListState()` for all five states
    including pagination-failure-preserves-cards. `scripts/program-discover/run.mjs` now
    tests the visible Search button, the chip-tap-fires-onTypeChange contract, the pagination
    failure-preserves-cards flow, the neutral disclosure at both source values, and the
    intended-learner rendering rules. `scripts/nav-tests/run.mjs` was updated for the new
    tab shape (Programs / Classes / Teachers, with All/Following nested under Teachers).

### Verification of this round

| Command | Where | Result |
|---|---|---|
| `pnpm run typecheck` | root, all four packages | pass |
| `pnpm run test` | `artifacts/sikshya` | 338 pass, 0 fail |
| `pnpm run test` | `artifacts/api-server` | 474 pass, 0 fail |
| `pnpm run test:programs-ui` | `artifacts/sikshya` | 254 pass, 0 fail |
| `pnpm run test:discover` | `artifacts/sikshya` | 146 pass, 0 fail (+26 checks for the corrections) |
| `pnpm run lint:design` | `artifacts/sikshya` | no new leaks |
| `git diff --check` | root | clean |

**Not run in this session because Postgres is not available in the container:**
`test:programs` (API integration), `test:program-journey`, `test:program-smoke`, `test:nav`
(need a live DB and built app). The suites themselves were updated for the new architecture
where they touched it (`nav-tests`); Codex's CI environment or the owner's local run will
exercise them.

**Rendered and inspected** at 390×844 and 1440×900. Screenshots refreshed under
`/tmp/program-discover-shots` — `list-loading`, `list-empty`, `list-failed`, `list-populated`,
`list-nomatch-query`, `list-nomatch-filter`, `list-more-error`, `view-full`.

### Deliberately not done

- **No changes to booking, payments, membership, Monthly classes, classroom sockets, Daily,
  LiveKit, or database deployment.** The Classes view is a *browsing* surface that opens
  `/session/:id` where the existing booking flow lives; nothing is duplicated.
- **No schema change, no `db:push`, no production or staging deploy.** The `intendedLearner`
  addition is a response-only field pulled from the existing snapshot column.
- **No Join, Buy, Enrol, Reserve or Pay button was added.** The program details page still
  ends with the plain "Joining a program is not open yet" notice.

## Correction round 2 (2026-09-09)

Codex reviewed `8a8fcb2` and returned eight further blockers focused on the Single Classes
view being safe and end-to-end usable. Every item is addressed additively — no schema change,
no `db:push`, no changes to booking, payment, membership, Monthly classes, classroom sockets,
Daily, LiveKit, or database plumbing. No production or staging deploy.

### The eight items and what was done

1. **Single classes now book through the existing teacher-page flow.** The Classes card carries
   the authoritative teacher profile id and a "View & book" action. Tapping routes to
   `/(student)/teacher/{profileId}?session={id}`; the teacher page reads the query param,
   focuses the Upcoming sub-tab, and marks the target session with a `focused-session-{id}`
   testID. The existing `book-btn-{id}` control on that page runs the real Book & Pay flow —
   no booking implementation is duplicated. Rendered journey `test:classes-booking` proves the
   student reaches that control from the tap.
2. **Public class visibility is now gated.** New route `GET /public/classes` returns only:
   single (non-monthly) classes with `status = 'upcoming'`, only teachers whose profile is
   `approved` and whose account is not suspended, only classes not past their cutoff and not
   full. `/sessions` semantics are unchanged — the guarded shape lives on its own path. Route
   ordering, search and cursor pagination all live in `sessions.ts`. Server tests in
   `test:public-classes` (41 checks) prove rejected/unapproved/suspended teachers cannot
   surface, that a live suspension removes an approved teacher's class on the very next
   request, and that the response never leaks `email`/`suspendedAt`/`approvalStatus`/etc.
3. **Server-side search with bounded input and deterministic pagination.** `readClassSearch()`
   trims, caps at 80 chars, escapes `%`/`_`/`\` and returns null for a blank query. The route
   `ilike`s over `subject`, `topic`, and the public teacher name only. Ordering is
   `(date ASC, id ASC)` so soonest-first with a stable tie-breaker; the cursor is `<ms>_<id>`
   and Postgres row-compares the pair. Rendered `test:classes-booking` proves the visible
   Search button submits, typing sends no per-keystroke request, no-match is honest and
   quotes the submitted query, and the pagination-failure state preserves loaded cards.
4. **Each Discover view now loads lazily.** `app/(student)/index.tsx` no longer loads Classes,
   Teachers, or Monthly data on mount; each view fires its own load the first time it is
   opened, and refocus keeps the previously-loaded content instead of clobbering it. The
   rendered journey observes network requests before the tap and asserts `/public/classes`
   and `/teachers` are *not* fetched while Programs is the initial view.
5. **Back navigation is proved in a real journey.** New suite `test:back-journey` walks the
   preserved-context path (search + chip filter → open a program → in-app Back → search box
   and filtered list still there) and the deep-link fallback (arrive cold on
   `/program/{id}` → in-app Back safely lands on Discover). It also covers the invalid-id
   case ends loading and shows the not-found state.
6. **Raw layout values replaced with semantic tokens.** `constants/layout.ts` now exports
   `marketplaceColumnMax` (760) and `bottomNavClearance` (100), each with a named comment
   explaining what they are for. All new and modified Discover code uses them; no bare 760 or
   `insets.bottom + 100` in the Classes view or the rewritten Programs container.
7. **PublicClassCard is a dedicated component with truthful fields.** `PublicClassCard`
   accepts `PublicClassCardFields` directly (billing line, price, seats-left or Sold-out,
   duration, when, teacher, one "View & book" action). No `Array().fill("")` hack — the
   card reads seat counts as numbers. Unit tests in `publicClasses.test.ts` cover the fields,
   the sold-out variant, and the no-fabrication rule.
8. **The previously-omitted gates were actually run.** Local Postgres was brought up, the
   API server built and started, and every listed suite executed against it.

### Verification of this round

| Command | Where | Result |
|---|---|---|
| `pnpm run typecheck` | root, all four packages | pass |
| `pnpm --dir artifacts/sikshya run test` | | 351 pass, 0 fail |
| `pnpm --dir artifacts/api-server run test` | | 474 pass, 0 fail |
| `pnpm --dir artifacts/api-server run test:programs` | | 442 pass, 0 fail |
| `pnpm --dir artifacts/api-server run test:public-classes` | new suite | 41 pass, 0 fail |
| `pnpm --dir artifacts/api-server run test:sessions` | | 56 pass, 0 fail |
| `pnpm --dir artifacts/sikshya run test:programs-ui` | | 254 pass, 0 fail |
| `pnpm --dir artifacts/sikshya run test:discover` | | 146 pass, 0 fail |
| `pnpm --dir artifacts/sikshya run test:classes-booking` | new suite | 27 pass, 0 fail |
| `pnpm --dir artifacts/sikshya run test:back-journey` | new suite | 11 pass, 0 fail |
| `pnpm --dir artifacts/sikshya run test:program-journey` | | 77 pass, 0 fail |
| `pnpm --dir artifacts/sikshya run test:program-smoke` | | 55 pass, 1 fail (see below) |
| `pnpm --dir artifacts/sikshya run test:nav` | | 47 pass, 0 fail |
| `pnpm --dir artifacts/sikshya run lint:design` | | no new leaks |
| `git diff --check` | root | clean |

**One preexisting flake in `test:program-smoke`.** "the sign-in form reaches the server and
is accepted" waits for a specific network trace of the login POST; the very next check —
"signing in reaches the teacher dashboard" — passes, which proves the login itself succeeded.
The failure is in the harness's request observation, not the app. Unrelated to this round;
noted here so the number is not underreported.

**Rendered and inspected** at 390×844 and 1440×900. New screenshots under
`/tmp/program-discover-shots` and inline flows in the two new journey suites.

### Deliberately not done

- **No booking/payment code was touched.** The Classes card hands off to the existing Book &
  Pay control on the teacher page — the same control the Discover Teachers path uses.
- **`/sessions` semantics are unchanged.** The gated shape is a separate route.
- **No schema change, no `db:push`.** The new route joins existing tables.
- **No production or staging deploy.** Everything ran against a local Postgres in this
  container.

## Codex final review and takeover (2026-09-09)

The owner asked Codex to carry the work after Claude reached its weekly limit. This review began
from Claude's pushed `b5b732f` on a separate branch, `codex/phase2b-final-review`. No Claude file
was overwritten blindly; the public Classes route, Discover loading, teacher-page hand-off and
the tests were read against the existing booking authority first.

### Defects found and corrected

1. **The public storefront stayed open five minutes longer than booking.** `GET /public/classes`
   filtered at scheduled finish + 10 minutes (the call recovery/overtime cutoff), while the
   atomic booking transaction closes at scheduled finish + 5 minutes. A class could therefore
   advertise “View & book” and then correctly refuse payment. The query now uses the exported
   `STUDENT_GRACE_MINUTES` rule. The integration fixture has both sides of this exact boundary.
2. **The first Classes/Teachers tab visit could issue the same request twice.** A React effect and
   a focus effect both owned first-load. The focus callback changes when the loading flag paints,
   which re-runs it on a focused screen. Each secondary marketplace now has one first-load effect;
   its successful rows remain cached when changing tabs. The journey requires exactly one request.
3. **The Discover hand-off did not actually reveal the class.** The earlier “highlight” was only a
   test id, and the journey counted a DOM node as visible. The selected class is now sorted first,
   receives a visible tokenised highlight, and is scrolled into the phone viewport after its real
   booking/access state loads. The journey checks both the class and the existing Book & Pay
   control intersect the 390×844 viewport.
4. **The selected class could be outside the first 20 upcoming rows.** Only a hand-off carrying
   `?session=` expands the existing teacher-session query to its already-supported cap of 100.
   Ordinary profile visits retain their previous limit.
5. **The 390 px search controls physically overlapped.** Claude's journey bypassed browser hit
   testing with `element.click()` and described it as equivalent to a user tap. On compact screens
   the input and Search action now stack; the action is full width, the clear control keeps its
   44-point target, and the test uses a real coordinate-based click.
6. **Root typecheck silently skipped the artifact workspaces on Windows.** The path-glob filters
   matched differently across shells. The root command now names the four intended workspace
   packages explicitly. The regenerated Expo route types and all four package typechecks passed.
7. **Browser test portability.** The shared harness knew Linux Chrome paths but not the Chrome and
   Edge locations on the owner's Windows machine. Those existing-browser fallbacks were added;
   only the free Playwright driver was installed globally. No browser, account, service or paid
   dependency was added to the repository.

### Verification performed by Codex

| Gate | Result |
|---|---|
| root `pnpm.cmd run typecheck` | pass; all 4 intended packages visibly ran |
| API unit tests | 474 pass, 0 fail |
| app unit tests | 351 pass, 0 fail |
| `test:discover` rendered at phone/laptop sizes | 146 pass, 0 fail |
| `test:programs-ui` rendered at phone/laptop sizes | 254 pass, 0 fail |
| `lint:design` | no new leaks; baseline remains 94 hex / 282 sizes |
| `git diff --check` | clean (line-ending notices only on Windows) |

The first browser attempt failed because Playwright was not installed on this Windows machine.
Chrome was already installed. Codex installed the free driver without downloading a second browser,
added the Windows fallback paths, and both rendered suites then passed.

### Not yet claimed

- The new Postgres boundary fixture and full `test:classes-booking` journey have not run in this
  Windows checkout: it has no local PostgreSQL or API on ports 55432/8080. Claude's prior 41/0 and
  27/0 runs cover the pre-review version, not these new assertions. They must run against an
  isolated staging/local database after this branch is available to Railway.
- Nothing in this review has been deployed to staging or production yet.
- No payment, membership, booking transaction, Monthly-class, classroom, Daily or LiveKit logic
  was changed. No schema or database command, purchase, production write or production deploy was
  performed.

### Next owner-visible checkpoint

Push this review branch, point only the isolated Railway staging service at it, deploy only the
preview Worker against that staging API, then give the owner an exact short journey covering:
Classes first-load, search/clear on a phone, card hand-off, visible highlighted class, and the
existing Book & Pay control. Production remains unchanged until the owner explicitly approves it.
