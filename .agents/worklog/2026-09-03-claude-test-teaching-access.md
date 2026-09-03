# Audited, expiring test teaching access

- Date: 2026-09-03
- Agent: claude
- Branch: `claude/excalidraw-whiteboard-sync-gjoqaz`
- Base commit: `5bdb610`
- Status: complete — awaiting owner preview approval before merge

## Requested

Section 4 of the correction packet. The owner needs selected teacher accounts to create classes and
enter the whiteboard during testing, without a plan payment that cannot be verified — and without
weakening approval or payment for anybody else.

## Changed

**`lib/db/src/schema/testTeachingGrants.ts`** — new table. Teacher, tier, granted-by, reason,
granted-at, `valid_until`, `revoked_at`, `revoked-by`. A **table, not a column**: the API redeploys
itself on push while `db:push` is manual, so a new column on a table read with a bare `select()` is
a 500 during that window (`.agents/memory/schema-change-deploy-window.md`).

**`artifacts/api-server/src/lib/testTeachingAccess.ts`** — new. `testTeachingAllowed()` reads
`ALLOW_TEST_TEACHING_ACCESS` **per call** so flipping it takes effect on the next request rather
than the next deploy. `liveTestGrant()` asks the database for "not revoked and not yet expired"
using **the database's clock inside the query** — two servers with drifting clocks would otherwise
disagree about a grant that lapsed a minute ago.

**`artifacts/api-server/src/lib/teachingAccess.ts`** — the grant is consulted **inside**
`ordinaryTeachingAccess`, in the `PLAN_REQUIRED` branch only, *after* email verification and
operator approval have already returned. `TeachingAccess` gains `viaTestGrant` so callers that show
money can branch on it.

**`artifacts/api-server/src/lib/sessionAllowance.ts`** — `tierForTeacher()` falls back to the
grant's tier when there is no paid subscription, so a granted teacher is bound by a real allowance.
`allowanceSummary()` returns `testAccess` so every teacher screen can label it.

**`artifacts/api-server/src/routes/admin.ts`** — `POST /admin/teachers/:userId/test-access` and
`…/revoke`; the person-detail response carries `testAccess: { enabled, grant }`.

**`artifacts/sikshya/app/(admin)/person/[id].tsx`** — an operator card that grants, shows and ends
a grant, and explains *why* when the control is unavailable.

**`artifacts/sikshya/app/(teacher)/subscription.tsx`** — the persistent
`TEST ACCESS — no payment was processed` banner with its expiry, directly under the plan card.

**`artifacts/api-server/scripts/test-access/run.mjs`** — new suite, 26 checks,
`run test:test-access`.

## Decisions and assumptions

- **Placing the grant last in the gate is the whole safety argument.** An unverified or unapproved
  teacher has already been refused by the time the code looks for a grant, so a grant cannot rescue
  one. And because every class-creation route calls that single function, there is no screen-level
  bypass to keep in step. Tested directly: a live grant planted on an un-approved teacher still gets
  403 `OPERATOR_REVIEW`.
- **A grant carries a tier, not "unlimited".** Free access to test the product is not free access to
  a product nobody else gets — an unlimited account exercises something the owner does not sell. A
  granted teacher gets ten classes per thirty days on Base, and the eleventh is refused.
- **The kill switch is checked before the table, not instead of it.** Off means no grant works
  whatever the rows say, so switching it off before launch closes every outstanding grant at once
  without having to find them. On does not by itself let anybody teach free.
- **Granting twice revokes the first.** A teacher never holds two, so "revoke" always means one row.
- **Lapsed rows are kept.** The audit question is "who could teach for free in August, and who said
  so", which a deleted row cannot answer.
- **The teacher's label rides on the allowance**, which every teacher screen already fetches — one
  field puts it everywhere it belongs.

## Verification

| Command | Result |
|---|---|
| `pnpm run typecheck` | clean, all four packages |
| `pnpm --filter @workspace/api-server run test` | 280 passed, 0 failed |
| `pnpm --filter @workspace/sikshya run test` | 154 passed, 0 failed |
| `pnpm --filter @workspace/sikshya run lint:design` | no new leaks; 223 / 429 |
| **`scripts/test-access/run.mjs`** | **26 passed, 0 failed** |
| `scripts/admin-tests/run.mjs` | 58 passed, 0 failed |
| `scripts/monthly-tests/run.mjs` | 199 passed, 0 failed |
| `scripts/tier-limits/run.mjs` | 31 passed, 0 failed |
| `scripts/session-tests/run.mjs` | 56 passed, 0 failed |
| `scripts/operator-tests/run.mjs` | 50 passed, 0 failed |
| `scripts/password-reset/run.mjs` | 25 passed, 0 failed |

The packet's four acceptance checks, all passing against live servers:

1. **Ordinary users still cannot bypass payment** — without a grant, 402 `PLAN_REQUIRED`; with the
   switch off, a planted grant does nothing; a student or the teacher themselves gets 403 trying to
   grant.
2. **One granted teacher can create sessions until expiry and still obeys the allowance** — ten
   classes through, the eleventh refused.
3. **Revocation and expiry take effect on the next protected action** — both tested separately, and
   expiry with nobody revoking anything.
4. **A pending or unverified teacher stays blocked even with a stale grant** — 403
   `OPERATOR_REVIEW`.

Plus: no fake receipt anywhere. `subscription_active` stays false and no `teacher_plans` row
appears.

**Not verified in a browser.** The operator card and the teacher banner have not been rendered. The
`test:gates` suite could be extended to cover them and was not — this slice was already large.

## Problems and surprises

- **I asserted against a `payments` table that does not exist.** There is none: a charge is not
  persisted as a row. What records a purchase is `teacher_profiles.subscription_active` for a tier
  and a `teacher_plans` row for the monthly plan, and the test now checks both. The failure was
  loud, which is the only reason it was not a silently passing check.
- **The suite runs its own servers on two ports** because `ALLOW_TEST_TEACHING_ACCESS` must be
  absent for the off-by-default case and present for everything else, and it is read per request.

## Fabrications found

None new. The slice exists partly to prevent one: an operator-granted account must never present
itself as a bought plan, which is why the banner is unconditional while a grant is live and why the
tests assert no purchase record appears.

## Deliberately not changed

- **`chargeForMonthly`.** Untouched. It already refuses a simulated teacher-plan payment outside
  `NODE_ENV=test`, and the grant sits beside that rule rather than around it.
- **The monthly plan route.** A grant covers ordinary class creation. Extending it to the NPR 6,500
  monthly product was not asked for and would widen the blast radius.
- **No grant was created on any real server**, and `ALLOW_TEST_TEACHING_ACCESS` is set nowhere.

## Remaining risks / next pickup point

- **Before launch**: switch `ALLOW_TEST_TEACHING_ACCESS` off and confirm no live grants remain
  (`select * from test_teaching_grants where revoked_at is null and valid_until > now()`).
- **`db:push` is needed** before the API serving this code reads the new table. The table is only
  touched by new code, so the ordering is safe either way, but the feature is inert until it exists.
- Next: section 5, disabling automatic whiteboard shape conversion.

---

## Closeout: deployment ordering, verified empirically (3 Sep)

The question was whether live code can query `test_teaching_grants` before `db:push` has created
it — the deploy-window hazard in `.agents/memory/schema-change-deploy-window.md`. Tested by
dropping the table and exercising the real routes, rather than by reading the code.

| Table | `ALLOW_TEST_TEACHING_ACCESS` | `GET /teachers/me/allowance` | `POST /sessions` | `GET /teachers/me/plan-eligibility` |
|---|---|---|---|---|
| **missing** | **unset (the default)** | **200** | **201** | **200** |
| missing | `true` | **500** | — | — |
| present | either | 200 | 201 | 200 |

**The flag being off by default is what makes the deploy safe**, not the choice of a table over a
column — that choice removes a *different* hazard (a bare `select()` on a widened table). The guard
in `liveTestGrant()` returns before the query when the flag is unset, so with production's default
the table is never touched. No missing-relation error reached the log in the safe case.

**The ordering rule this establishes, for whoever deploys it:**

1. Push the code. The API redeploys itself. Nothing queries the new table, because the flag is off.
2. Run `pnpm run db:push` to create the table.
3. Only then may `ALLOW_TEST_TEACHING_ACCESS` be set on the API service.

Setting the flag before step 2 gives a 500 on the allowance endpoint, which is on the teacher
dashboard. It is recoverable by unsetting the flag, but it is a live error and avoidable.

Confirmed alongside: `ALLOW_TEST_TEACHING_ACCESS` is set **nowhere** in the repository — no
workflow, no config, no example env — so it can only be turned on deliberately, on the service.
