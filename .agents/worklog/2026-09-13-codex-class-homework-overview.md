# Class homework overview

Date: 2026-09-13
Branch: `codex/class-homework-overview`

## Delivered

- The Homework card on a class home now answers the next question without making someone open and
  inspect every task.
- Teachers see hand-ins still waiting for review first, followed by the number of open tasks. When
  nothing needs review, the card explicitly says they are caught up.
- Students see late unfinished work first, otherwise the number still to do. Students who submitted
  every open task see `All handed in`; a class without homework still says `Nothing due yet`.
- The small card badge has a role-specific accessible label. It no longer announces a homework
  count as unread chat messages.
- Counts are calculated by the authenticated server from the class, its tasks and the current
  student's submission rows. The browser supplies only the class route ID.

## Safety and scope

- The existing class access check still runs before any count is calculated.
- Students receive only their own completion counts, never another student's submission status.
- Late work remains accepted; this adds visibility and does not silently introduce a lockout.
- No schema, migration, payment, refund, booking, homework row or video behaviour changed.
- Production was not changed by this work.

## Verification before commit

- Full workspace typecheck: pass across all four packages.
- API production build: pass.
- API unit suite: 562 passed, 0 failed.
- Sikshya unit suite: 412 passed, 0 failed.
- Focused class-home and homework derivation checks: 20 passed, 0 failed.
- Design lint: unchanged at 94 hex literals / 282 raw sizes.
- `git diff --check`: clean.

## What went wrong / not claimed

- The first full app suite rejected a red late-homework badge because the class-home visual contract
  keeps all numeric badges in one Fadko brand color. The role-specific wording and spoken label were
  retained; the badge returned to the shared visual style. The complete app suite then passed.
- The disposable-Postgres journey has new checks for to-do, late, awaiting-review and reviewed
  counts. It will run in the required GitHub safety workflow before staging is changed.
- A count is a summary, not a scheduled reminder and not proof that a student read the task.

## Preview deployment

- Pending commit, safety workflow, Railway staging and Cloudflare preview details.
