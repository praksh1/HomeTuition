# New class homework deadlines

Date: 2026-09-12
Branch: `codex/class-homework-deadlines`

## Delivered

- Teachers may leave homework open-ended or choose an optional deadline with the existing Bikram
  Sambat calendar and a clock control. Web uses a native time field; iOS and Android use the
  existing platform picker.
- The suggested date is tomorrow in Nepal, even when the teacher's device is in another timezone.
- The deadline is serialized as one Nepal-time instant and read back into Nepal wall-clock parts,
  so students abroad and students in Nepal see the same promised date and time.
- Homework cards show the chosen date in the reader's preferred calendar plus the second calendar
  for certainty, followed by the explicit Nepal time.
- Passing the deadline does not silently lock a student out. The screen says late work is still
  accepted and the existing hand-in path remains available.
- Rapid repeated presses cannot create the same homework twice while its upload/save is running.

## Server and data safety

- Reused the existing nullable `class_group_homework.due_at` column. No schema, migration or old
  homework row changed.
- The server parses the optional instant and uses its own clock to reject invalid or already-past
  deadlines. Changing a phone's clock cannot bypass this decision.
- A missing deadline remains `null`; no default deadline is invented in stored data.

## Verification before commit

- Full workspace typecheck: pass across all four packages.
- API build: pass.
- API unit suite: 559 passed, 0 failed.
- Sikshya unit suite: 406 passed, 0 failed.
- Focused deadline and class-group checks: 15 passed, 0 failed.
- Design lint: unchanged at 94 hex literals / 282 raw sizes.
- `git diff --check`: clean.

## What went wrong / not claimed

- The first local API unit and build attempts ran inside the restricted filesystem sandbox. Existing
  esbuild tests could not traverse their module paths there, and TypeScript could not follow some
  workspace dependency links. The same unchanged gates passed outside that restriction. This was
  an execution-environment failure, not a product-code failure.
- No reminder notification is scheduled from this deadline yet.
- Teachers cannot edit an already-posted deadline in this slice.
- No production deployment and no payment behaviour changed.

## Preview deployment

- Feature commit: `01cebd8` (`Add Nepal-time homework deadlines`).
- The first safety workflow passed at run `34738158634`.
- The first preview workflow stopped before the build because the existing learning-program
  moderation test read for an intentionally asynchronous audit row immediately after the API
  response. It reported `0 -> 0`; the public preview was not replaced by that failed run.
- The test now uses the suite's existing bounded eventual-read helper. This is test-only commit
  `073fb7a` (`Stabilize moderation audit check`); it does not change moderation or app behaviour.
- The complete safety workflow passed again at run `34738450443` in 3m 4s, including all four
  workspace typechecks, API and app tests, disposable-database schema checks, programs, batch
  booking, video, proof, staging access and browser checks.
- Railway staging deployed the exact reviewed commit and showed `ACTIVE` for
  `Stabilize moderation audit check`; the preceding feature commit had also deployed successfully.
- The preview workflow passed at run `34738681491` in 7m 50s. It verified the staging API,
  disposable-database program and dispute tests, rendered discovery/profile/class/billing screens,
  preview isolation, web build and Cloudflare deployment.
- Preview: `https://hometuition-preview.praksh-dhakal.workers.dev`
- Production remains unchanged.
