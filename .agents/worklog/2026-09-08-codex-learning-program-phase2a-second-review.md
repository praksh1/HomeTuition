# Codex second review — Learning Program Phase 2A

Date: 2026-09-08

Reviewed corrected Claude branch `claude/learning-program-phase2` at `7da1036`, rebased onto
Codex review commit `2abedbb`. Nothing was merged or deployed.

## Verdict

The original three data-loss findings are substantially corrected, but Phase 2A still needs one
small, bounded correction pass before acceptance.

## Corrections verified

- A delayed save response now compares with `draftRef.current`, so newer typing stays visible and
  stays labelled unsaved.
- Save requests are serialized through `savingRef`/`queuedRef`.
- Publish and lifecycle controls are withheld while the rendered save state is at risk.
- Successful lifecycle responses retain typing entered after dispatch.
- Stale validation findings are labelled as belonging to the last save.
- Delete explicitly says unsaved on-screen work is discarded.
- The custom Back link, native navigation guard and `beforeunload` hook are wired.
- Chooser availability is intersected with server-returned template types.
- An unchanged published program no longer offers another publication/version.
- The real API/browser journey exercises the delayed-PATCH defect and was shown to fail against the
  old implementation after its original premature settle condition was repaired.

Independent Codex checks on the exact commit:

- focused UI derivation suite: 54 passed, 0 failed;
- design ratchet: no new leaks, 94 hex / 282 raw sizes;
- API typecheck: pass;
- diff check: clean.

## Remaining blocker 1 — browser Back is explicitly unguarded

The acceptance requirement named browser Back. The web hook implements only `beforeunload`; it has
no `popstate`/router-history handling. Claude's report and worklog explicitly say browser Back from
the browser chrome is not intercepted. In an Expo Router single-page transition, that can leave the
studio without an unload and silently discard dirty work.

The journey test dispatches a synthetic `beforeunload` event. It does not press browser Back or
perform an actual reload/close. Add a robust browser-history guard using the router's supported
navigation mechanism rather than an ad-hoc trap, and drive a real `page.goBack()`/equivalent test:
dirty work stays until confirmed, cancellation remains in the studio, confirmation completes the
original navigation, and clean work goes back without a question.

## Remaining blocker 2 — save and lifecycle operations can overlap

The UI prevents lifecycle actions when a save is already risky, but the reverse ordering remains:
a teacher can start Publish/Archive/etc. while clean, then type and press Save while that lifecycle
POST is in flight. The PATCH and POST then race for the server row lock. Depending on arrival order,
a publish pressed before the new typing can publish the newly saved text, or late responses can make
the screen's program/accepted metadata describe a different operation than expected.

Other lifecycle buttons also remain independently actionable while one lifecycle request is busy,
and the screen's defensive gate reads captured React `saveState` rather than a synchronous current
ref.

Required correction:

- make Save and lifecycle mutations mutually exclusive;
- while any lifecycle action is in flight, disable editing, Save and every lifecycle action (or use
  a single serialized operation controller with equally explicit semantics);
- guard dispatch with synchronous refs, not only render-state closures;
- add a deferred POST test proving typing/saving cannot cross a publication or state transition;
- add a rapid-two-actions test proving only one lifecycle request is dispatched.

## Remaining blocker 3 — app typecheck is not reproducible from a fresh checkout

On the exact commit, after checking it out without Claude's generated Expo artifacts:

`pnpm --dir artifacts/sikshya run typecheck` fails on all seven new program-route calls because the
ignored `.expo/types/router.d.ts` does not contain the new routes. Claude's earlier web build generated
local route metadata and masked this dependency. The root Windows command also skipped artifact
packages because of its filter behavior, so Codex ran package typechecks directly.

Make a fresh-checkout typecheck deterministic using the repository's smallest established solution.
Do not rely on ignored output left by a dev server/build and do not broadly disable typed routing.
Prove the fix after removing/regenerating only disposable Expo route metadata, then run the direct
Sikshya typecheck.

## Boundaries

No Phase 2B, student discovery, enrolment, money, scheduling, video/classroom, schema, production
table, merge or deployment work belongs in this pass. Preserve the accepted Phase 1 code and the
good Phase 2A UI.

## Final review — commit `2e81c59`

Claude rebased onto this review and corrected the three remaining findings. Phase 2A is now
**accepted for a branch-preview deployment and owner testing**. This is not yet production approval.

Verified in the final code:

- Web navigation uses a single, bounded history sentinel and a real `popstate` path. It preserves
  Expo Router's existing history state, does not re-arm under an open question, and distinguishes
  housekeeping from an actual Back request. The journey uses real browser Back twice, cancellation,
  confirmed departure, clean Back, and an actual reload dialog.
- A synchronous `opRef` admits only one write operation. The dispatch boundary also compares the
  latest draft and accepted draft refs. Lifecycle actions lock editing and every write control;
  saves block lifecycle dispatch; a second lifecycle request is refused before network work.
- The Sikshya typecheck now regenerates ignored Expo route declarations from the current `app/`
  tree using Expo Router's own installed generator before invoking TypeScript.

Independent Codex verification on exact commit `2e81c59`, after temporarily removing the existing
generated route declaration and restoring the user's prior file afterward:

- `pnpm --dir artifacts/sikshya run typecheck`: pass; the missing route declaration was regenerated.
- focused Learning Program UI rules: 54 passed, 0 failed.
- `pnpm --filter @workspace/sikshya run lint:design`: pass, unchanged at 94 hex / 282 raw sizes.
- `git diff --check bfa35dc..2e81c59`: clean.

Claude reports the full real-API browser journey at 71 checks, the program API suite at 212, the
render suite at 232, API/app units at 474/315, and the navigation/dashboard suites at 41/6. Codex
inspected the new deterministic network holds and assertions but did not independently rerun the
database/browser harness on Windows.

Remaining manual boundary: no real Android hardware Back test, older Android WebView test, or
Safari back-forward-cache test has occurred. The next safe action is a branch-preview deployment so
the owner can test the teacher Program flow before any Phase 2B or production integration begins.
