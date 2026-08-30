# Make monthly make-up scheduling flexible within the cycle

- Date: 2026-08-29
- Agent: Codex
- Branch: `claude/excalidraw-whiteboard-sync-gjoqaz`
- Base commit: `46cdf7e`
- Status: implementation and local verification complete; database-backed suite needs an
  environment with Postgres; commit/push/deployment recorded below when complete

## Requested

The owner asked for an audit of “Monthly Class” and specifically whether Claude had left a
restriction on make-up scheduling. The owner restated the intended product rules:

- one regular monthly class every day at the same time;
- a teacher must deliver at least 25 sessions in the 30-session cycle before refund rules apply;
- up to five make-ups may help the teacher reach that delivery floor; and
- a make-up should be schedulable on any day and at any time inside the same monthly cycle.

## What the audit found before changing anything

- The money/delivery code already uses `MIN_SESSIONS_PER_CYCLE = 25` and
  `MAX_MAKEUPS_PER_CYCLE = 5`.
- `heldIn()` counts every `recurring_days` row with status `held`, including make-up rows. A
  make-up therefore contributes to the floor only if the class actually happened. Merely
  scheduling it does not count as delivery.
- The existing refund scenarios already cover teachers missing six or ten sessions and using
  up to five make-ups. No refund arithmetic needed changing.
- The API already accepted an arbitrary absolute timestamp and already rejected a past slot,
  another person's class, a non-missed class, a duplicate make-up, a sixth make-up, an overlap,
  and a slot inside teacher-declared leave.
- The restriction was in the teacher UI. Pressing “Make up” immediately created a replacement
  at `Date.now() + 3 days`; the teacher could not inspect or change its date/time. The nearby
  comment claimed it used the normal class time, but the code actually preserved the clock time
  at which the button was pressed.
- The server did not explicitly stop an otherwise-valid make-up from being placed in the next
  cycle, and `addMakeup` did not explicitly reject a missed row from an older cycle.

## Owner decision recorded

A teacher may choose any **future** date and time inside the **current 30 × 24-hour cycle**.
The exact cycle-end instant is exclusive. Existing safety limits remain:

- one active make-up per missed class;
- the missed class must belong to the current cycle;
- at most five make-ups per cycle and forty total rows per cycle;
- no overlap with another class in the recurring course; and
- no slot during leave the teacher has already declared.

Only a held make-up contributes to the 25-class delivery floor.

## Changed

### API and business-rule boundary

- Added the pure `makeupFallsWithinCycle()` rule to `api-server/src/lib/monthly.ts`. It uses the
  same half-open cycle boundary as the rest of monthly billing.
- Extended `POST /monthly/classes/:id/makeups` to accept `localDate` plus `startMinute` from the
  teacher screen. The server converts those values in the recurring class's IANA time zone,
  normally `Asia/Kathmandu`; a teacher using a laptop abroad therefore cannot accidentally
  shift the class by their device's UTC offset.
- Kept the old absolute `at` request field for backwards compatibility with older clients and
  existing tests.
- Added strict calendar-date validation so an impossible date such as 31 February is rejected
  rather than normalised into March by JavaScript.
- Enforced `cycle.start <= makeup < cycle.end` in the route and added a second current-cycle
  check on the missed ledger row inside `addMakeup`'s transaction.
- No schema or migration was added. The existing `scheduled_for`, `cycle_index`, `kind`, and
  `makeup_for_id` columns already represent the rule.

### Teacher app

- Replaced the immediate “Make up” mutation with a “Schedule” action that opens an inline
  confirmation panel.
- The panel uses the existing Bikram Sambat/Gregorian calendar picker, now with an optional
  maximum date, and a free `HH:MM` 24-hour time field.
- It shows the exact cycle-end day and time in the class's Nepal time zone, not the laptop's
  local time zone.
- The initial suggestion is the next day and immediately after the regular class. It is only a
  form value: nothing is written until the teacher taps “Schedule makeup,” and both fields are
  editable.
- The new controls use the design tokens, responsive type scale, numeric clock style, and
  44-point minimum touch targets. No raw colour or font-size leak was introduced.

### Tests and handover

- Added a pure boundary test covering cycle start, an arbitrary time, the last millisecond,
  before-cycle, and exact next-cycle instants.
- Extended the database-backed monthly suite to post a teacher-selected local day and 13:15
  time, verify Postgres stored 13:15 in Kathmandu, and reject a make-up after cycle end.
- Updated `MONTHLY.md`, `HANDOVER.md`, the owner-review backlog, the memory index, and added
  `.agents/memory/monthly-makeup-scheduling.md` with the full decision and restrictions.
- Updated the handover's verified unit-test count to 411 (257 API + 154 app) and the monthly
  integration-suite check count to 190.

## Verification that passed

- `pnpm --filter @workspace/api-server run typecheck` — passed.
- `pnpm --filter @workspace/sikshya run typecheck` — passed.
- `pnpm --filter @workspace/api-server run test` — 257 passed, 0 failed.
- `pnpm --filter @workspace/sikshya run test` — 154 passed, 0 failed. Existing Node
  module-type warnings remain; they predate this task.
- `pnpm --filter @workspace/sikshya run lint:design` — passed at the unchanged ratchet baseline
  of 223 hex literals and 429 raw font sizes; no new leaks.
- `git diff --check` — passed.
- A fresh production Expo web export bundled all 3,904 modules, verified the public Railway API
  URL and Sikshya identity, and produced `entry-c6d453d462784fa72d417e1eed8faa8a.js`.
- The final bundle contains the new “Choose the replacement class” and “Any future day and time
  is allowed” scheduler copy.

## Verification that could not run here

`pnpm --filter @workspace/api-server run test:monthly` was attempted and stopped immediately
with `ECONNREFUSED 127.0.0.1:8080`; no assertion ran. This Windows checkout has no root `.env`,
no `DATABASE_URL` in the process, no `psql`, no Docker, no PostgreSQL service, and no local API.
Starting a truthful database-backed server was therefore impossible without introducing a new
database or requesting production secrets. The production database was deliberately not used
for a test suite that creates and mutates many users, plans, classes, enrolments, and refunds.

The three new database checks remain in `scripts/monthly-tests/run.mjs` for the next environment
that already has the documented local Postgres/API test stack.

## Problems and surprises

- The first sandboxed TypeScript checks failed with Windows `EPERM` while reading TypeScript
  from `node_modules`. Re-running the exact checks through the approved external execution path
  passed; no code workaround or dependency change was made.
- Root `pnpm run typecheck` compiled the shared libraries but reported “No projects matched the
  filters” for artifact packages on this Windows path. Both changed workspaces were therefore
  run directly and passed.
- The first clean Expo export spent about four minutes in Metro/OneDrive and emitted the known
  Excalidraw third-party CSS warnings. It completed. The final cached export after the last copy
  adjustment completed in about 15 seconds and also passed its target checks.

## Deliberately not changed

- No change to daily recurrence, the 30 × 24-hour cycle, the 25-class floor, either student
  refund formula, the 48-hour abuse window, the five-abuse suspension, or the 30-day suspension.
- No payment, booking, enrolment, session materialisation, membership, WebSocket, Daily, chat,
  homework, or classroom change.
- No database table, column, boot guard, Drizzle schema, SQL migration, or production data
  mutation.
- No change to the two parked policy questions: partial/festival-length monthly courses and a
  student dropping the whole course mid-cycle.
- No student-screen change; students receive the existing reschedule notification after the
  teacher confirms the make-up.

## Next pickup / manual check

- With a teacher who has a missed monthly class, open the teacher Monthly Class screen, tap
  “Schedule,” choose a different date and time before cycle end, confirm it, and verify the
  make-up appears with the chosen instant and the student receives the existing notification.
- Also try the regular class's occupied time and a time after cycle end; both should show the
  server's readable refusal without creating a row.
- Run `test:monthly` against the documented local API/Postgres stack when one is available.

## Commit, push, and deployment

To be filled with the resulting commit, remote push, Railway/API observation, Cloudflare Worker
deployment, and live bundle verification before this task is closed.
