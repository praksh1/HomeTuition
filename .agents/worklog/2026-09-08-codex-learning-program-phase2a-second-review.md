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
