# Premium Schedule and Classes — 15 September 2026

## Outcome

Reframed the ambiguous Sessions tab around what each person is actually trying to do. A teacher
now has a lesson-by-lesson **Schedule**; a student has a class-level **My classes** library. The
change is local on `codex/premium-sessions`; it has not been pushed, previewed, merged or deployed.

## Product changes

- The teacher tab is named **Schedule** and opens on Upcoming lessons grouped by Nepal date.
  **Live** and one calm **History** view are one tap away; History distinguishes Completed,
  Cancelled and Not held.
- A teacher agenda row shows time, duration, class, lesson position, subject and enrolled count.
  It deliberately does not repeat price or turn a timetable into a product catalogue.
- The student tab is named **Classes** and shows one card per purchased class, even when that
  class owns 30 lesson rows. It leads with the next lesson, remaining count and one Open class
  action.
- Both screens use a fixed three-choice segmented control: Upcoming, Live and History. Every
  choice meets the 44-point touch floor.
- First-load connection failures have their own retry state. A failed request can no longer be
  presented as “No upcoming classes”, which would tell a paid student the app had lost their
  purchase.
- The retired Monthly product and its old plan language remain absent. Compatibility routes and
  records were not deleted.
- The screens now use the shared responsive width, type, colour, spacing and navigation-clearance
  tokens. Their prior 6 colour literals and 12 raw font sizes were removed and the lower design
  baseline was locked.

## Evidence

- Full workspace TypeScript: clean across four packages.
- Sikshya unit suite: **465 passed, 0 failed**.
- Focused class/session contracts: **8 passed, 0 failed**.
- New rendered Schedule/Classes suite: **38 passed, 0 failed** at 390 and 1440 widths.
- The rendered fixture proves 30 lesson rows become exactly one student class card, outages are
  not empty states, all filters meet the touch floor, and neither width scrolls sideways.
- Visual inspection: teacher History and student Upcoming at phone and laptop widths; no clipped
  labels, competing actions or full-width laptop prose.
- Design gate: **65 raw hex / 213 raw font sizes**, down from 71 / 225; baseline locked.
- `git diff --check`: clean.

## CI protection

- The lightweight rendered suite now runs in both Preview and production workflows.
- The existing real-browser `test:filters` journey was updated for the Schedule/Class language,
  the consolidated History behavior and laptop width checks. It still runs against a real API
  and throwaway Postgres in the production gate.

## Deliberate boundaries

- Teacher class management remains in **My classes**. Schedule is the diary of individual lesson
  times; merging those two jobs would recreate the confusion this pass removes.
- Student grouping still uses the server-owned `classGroup` relationship. Nothing guesses a
  class from matching titles or dates.
- No booking, payment, refund, homework, message, classroom, Daily or LiveKit behavior changed.
- No schema or production data changed.

## Next

After explicit approval, push this exact commit and run Preview. The owner should test only two
journeys: teacher Schedule across all three views, and student Classes with a purchased multi-
lesson class. After Preview passes, request separate production approval. The next premium slice
is the class conversation/inbox experience, preserving its existing delivery behavior while
modernizing organization and interaction.

## Production gate follow-up

- Preview passed and the owner approved production for `ac4cb2b`.
- Production workflow `34977243294` stopped before deployment in the existing classroom journey.
  The product was correct: completed lessons moved from the old Completed filter into the new
  History view. The journey still clicked the removed label, so it could not find either of its
  completed fixtures.
- The journey now opens the stable `teacher-group-history` control before selecting the finished
  lesson. This changes only the test route through the reviewed UI; application behavior is
  unchanged.
- The updated file passes Node syntax checking, `git diff --check`, and the rendered Sessions suite
  remains **38 passed, 0 failed** at phone and laptop widths. The database-backed classroom journey
  must be re-run in CI because this Windows checkout has no local PostgreSQL/`psql` test service.
- Production retry `34982282853` proved the corrected completed and rejoin cases, then exposed a
  third, later copy of the same retired `Completed` selector in the "Every class opens its own
  page" case. That selector had also swallowed its own timeout, leaving the journey on Upcoming
  until it failed looking for `Stress 14`. It now uses the same required
  `teacher-group-history` control, and no `Completed` text selector remains in this journey.
- Production retry `34985855734` then ran that complete classroom journey **47 passed, 0
  failed**. The following navigation suite still required the retired generic `Sessions` label
  for both roles, although it rendered the correct `Schedule` and `Classes` tabs. Its exact tab
  expectations now match the approved role-specific navigation, and its agent-isolation check
  also explicitly excludes both new tab names.
