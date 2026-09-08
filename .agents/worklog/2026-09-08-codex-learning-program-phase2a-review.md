# Codex review — Learning Program Phase 2A

Date: 2026-09-08

Reviewed Claude branch `claude/learning-program-phase2` at `324e854`. The branch remains unmerged
and undeployed. Phase 1 is still accepted; this review concerns the new teacher-facing UI only.

## Verdict

**Changes required before Phase 2A can be accepted.** The rendered components are thoughtful and
the visual/test work is useful, but the real screen wiring has three connected ways to lose or
misrepresent a teacher's draft on a slow connection.

## Blocking finding 1 — a save response can falsely overwrite a newer edit's state

`app/(teacher)/programs/[id].tsx` closes over the `draft` that was sent. If a teacher types while
that PATCH is in flight, `onDraftChange` correctly marks the newer local draft unsaved, but the old
request then returns and executes `setSaveState(draftDiffers(draft, answer.program.draft) ? ... )`.
That comparison uses the old closure value, not the current editor value, and can overwrite the
newer `unsaved` state with `saved`.

Result: the newest words remain visible locally but the screen says Saved, so closing the screen can
lose them. This is especially likely on the slow connections the app targets.

Required correction: compare every response with the latest local draft (for example, a kept-in-sync
ref plus request sequencing), never let an older response mark newer work saved, and test a deferred
PATCH where typing occurs before the response resolves. Also define and test the ordering of two save
requests so a late older response cannot replace a newer accepted baseline or validation result.

## Blocking finding 2 — lifecycle actions can publish an old draft and erase the current one

Publish, unpublish, archive, restore and delete remain available while the editor is unsaved, saving,
or failed. They operate on the server's last accepted copy. A successful action calls `apply`, which
replaces the editor draft with the response. Therefore a teacher can type, press Publish, publish the
older saved program, and have their visible unsaved text replaced without warning.

Required correction: do not allow Publish or lifecycle transitions while local work is at risk or a
save is in flight. Explain that the draft must be saved first. A deliberate Delete may discard a
never-published draft only through explicit confirmation whose wording says unsaved local work is
also discarded. Add screen-level tests proving no lifecycle request is dispatched in each unsafe
save state and that a successful safe action cannot erase a newer edit.

Server validation issues also describe the last saved draft, not the currently edited one. While the
draft is dirty, do not present stale issues as if they describe the text currently on screen; say
that Save will refresh the readiness check.

## Blocking finding 3 — the leave protection exists only as an unused utility

`wouldLoseWork()` is tested, but neither the screen nor the studio calls it. The custom Back link uses
`router.replace` immediately, and browser refresh/back, native navigation and other app navigation
have no dirty-draft guard. This contradicts the explicit requirement to never lose typed work
silently.

Required correction: wire a real navigation guard for web and native, including the custom Back
control. It must warn for `unsaved`, `saving`, and `failed`, stay silent for `clean` and `saved`, and
permit intentional navigation after confirmed deletion. Test both the pure decision and the actual
screen/navigation behavior.

## Required smaller corrections

1. The create screen fetches templates but discards their contents and always renders a hard-coded
   five-choice list. It then claims the fetched templates were used. Render only server-returned,
   recognized template types; keep local copy/icons as presentation metadata, but let the server
   response determine availability. Do not silently offer a type absent from the response.
2. The studio separately re-fetches templates, so remove the comment claiming the chooser fetch
   avoids that round trip. Either implement a truthful cache/pass-through or document the real
   behavior.
3. A published, unchanged program is offered `Publish again`. This is not a harmless no-op: Phase 1
   increments the published version. Hide/disable that action until the saved draft genuinely differs
   from the published snapshot. Do not manufacture empty versions.

## Evidence reviewed

- Fetched and inspected exact commit `324e854`.
- `git diff --check` was clean.
- Inspected the three route screens, studio lifecycle controls, save-state derivations, template
  chooser, tests, navigation registration and browser bundler change.
- Claude's reported gate totals and screenshots were treated as evidence, but the missing live
  create/edit/save/publish browser journey remains material because the defects are in screen wiring,
  outside the isolated component harness.

## Boundaries for correction

Keep the strong visual work and Phase 1 API intact. Do not add Phase 2B, student browsing,
enrolment, scheduling, payments, classroom/provider work, schema changes, production table creation,
merge or deployment. Add one browser journey against the real API with controllable delayed saves;
it must prove the three blocking behaviors rather than only rendering prop combinations.
