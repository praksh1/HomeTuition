# The teacher session tiers are sold, and nothing behind them works

> **Status, 27 Aug 2026 — items 1 and 3 are done, item 2 is as far as it can go without a
> payment provider.** What was built, and the two calls made without waiting for an answer, are
> at the bottom under *What was done*. The open questions that remain are marked there too.

**The owner designated this the next piece of work** (27 Aug 2026). Two of the three items below
needed a decision from them before code was written; the third did not and was simply done.

Found while answering a different question, and worth recording how: the platform's revenue on
pay-per-class was reported as missing because the *booking transaction* records no commission.
That was the wrong place to look. **The revenue model is a teacher subscription with a session
allowance, not a cut of each booking.** Do not "fix" the booking path by adding a commission —
there is a note in `HANDOVER.md` §5 saying so, because the next reader will be tempted.

## What exists

`SUBSCRIPTION_TIERS` in `artifacts/api-server/src/routes/teachers.ts`:

| Tier | Sessions / month | Price |
|---|---|---|
| `base` | 10 | NPR 2,000 |
| `tier1` | 15 | NPR 2,800 |
| `tier2` | 20 | NPR 3,500 |
| `tier3` | 25 | NPR 4,220 |
| `tier4` | 30 | NPR 4,700 |

Separate from the NPR 6,500 recurring-class tier, which has its own table (`teacher_plans`) and
its own rules in `lib/monthly.ts`. A teacher could hold both. `POST /teachers/:id/subscribe`
sets the tier, `GET /subscription-tiers` publishes the list, and the allowance is written to
`teacher_profiles.max_sessions_per_month`.

---

## 1. The allowance is not enforced — needs a decision first

`max_sessions_per_month` is written on subscribe and read in exactly two other places, both of
which only put it in a JSON response for display. **Nothing ever compares it to anything.**
`POST /sessions` validates `maxStudents` — how many people fit in one class — and never the
monthly quota.

So a teacher on the NPR 2,000 ten-session plan can create five hundred sessions. Every teacher
effectively holds the NPR 4,700 plan for whatever they paid.

**Settle with the owner before starting:**

- **What happens at the eleventh session on a ten-session plan?** Refused outright, or created
  with a prompt to upgrade? Refusing mid-month is a teacher who cannot teach the class they
  told students about; allowing it is a limit nobody respects. A middle option: refuse, but
  offer the upgrade in the same response so the path forward is one tap.
- **What counts as a "month" here?** Package A is deliberately *thirty times twenty-four hours
  from a timestamp*, never a calendar month, for reasons that matter (`MONTHLY.md`, "The one
  rule everything else follows" — Bikram Sambat and Gregorian months are different lengths, so
  calendar arithmetic on a price gives two answers). **This should almost certainly reuse that
  same clock rather than invent a second kind of month inside one product.** If it does, the
  arithmetic already exists and is unit-tested.
- **Does the count include cancelled classes?** A teacher who creates a class and cancels it
  has used a slot or not, and either answer is defensible — but it has to be one of them, and
  it has to be visible to the teacher before they cancel.
- **What does the teacher see?** The monthly tier shows its floor as a count ("5 more classes to
  go") rather than a rule, because that is the number they can act on. The same argument
  applies here: "6 of your 10 classes used this month".

## 2. The subscription is never charged — smaller than it looks

`POST /teachers/:id/subscribe` describes itself in its own comment as a *"Phase 3 sandbox
bypass"*: it marks the plan active as soon as the client says the charge succeeded. No gateway
is called. Unlike a refund it does not even write a debt row, so **nothing anywhere records
that a teacher owes NPR 2,000.**

This shares the payment-provider work already on the pre-launch checklist in `ISSUES.md`, so it
is not a separate project — but it has to land *with* that work rather than after it, or the
tier limit goes live while the money still does not move.

Mind `.agents/memory/payment-mode-trap.md` on the way in: payment mode is inferred from the
environment, and setting the provider variables before the eSewa/Khalti branch is written
declines every booking.

## 3. Subscribing approves the teacher — a launch blocker, not a decision

The same update sets `approvalStatus: "approved"` alongside the tier.

Follow the chain:

- `routes/auth.ts` registers a teacher as `pending`
- `routes/admin.ts` has a real review queue — `GET /admin/teachers/pending`, and a decision
  route that **refuses a rejection unless the agent writes a reason** and logs it to the
  activity log
- `GET /teachers` lists **only approved teachers**, so approval is the gate into Discover

There are two doors to that gate and one of them is the teacher's own. Because payment is
simulated, **any registered teacher can approve themselves, for free, and appear publicly in
Discover with no agent ever looking at them.** The review queue works; it is simply optional.

**The fix is deleting `approvalStatus: "approved"` from that update** so the agent decision
route is the only door. Nothing else changes. Do this one regardless of what is decided about
items 1 and 2 — it is on the `HANDOVER.md` pre-launch list as a blocker.

Check afterwards whether any test or seed script depended on subscribe doing the approving; a
teacher stuck at `pending` shows up as an empty Discover rather than as an error, which is
exactly the kind of failure that looks like something else.

## Where the code is

- `artifacts/api-server/src/routes/teachers.ts` — `SUBSCRIPTION_TIERS`, the subscribe endpoint,
  `GET /subscription-tiers`
- `artifacts/api-server/src/routes/sessions.ts` — `POST /sessions`, where the quota check would
  go
- `artifacts/api-server/src/routes/admin.ts` — the review queue and decision route
- `lib/db/src/schema/teacherProfiles.ts` — `max_sessions_per_month`, `subscription_tier`,
  `approval_status`
- `artifacts/sikshya/app/(teacher)/subscription.tsx` — the screen. Note its payment history is
  hard-coded sample rows, which is a separate known gap.

Pure arithmetic goes in an **import-free file** so it can be unit-tested — Node's type
stripping cannot resolve extensionless workspace imports, so anything importing `@workspace/db`
cannot have tests. Same pattern as `tickets.ts`, `operators.ts`, `videoCost.ts`.

---

# What was done, 27 Aug 2026

## Item 1 — the allowance is enforced

`lib/tierLimits.ts` holds the rules and imports nothing, so it is unit-tested (19 tests).
`lib/sessionAllowance.ts` fetches what those rules need. `POST /sessions` refuses with **402**
and a message a teacher can act on.

**Two calls were made rather than waiting for an answer. Either can be changed cheaply.**

**A "month" is thirty times twenty-four hours**, matching Package A, never a calendar month —
the argument in `MONTHLY.md` applies here identically and a second definition of a month inside
one product would be indefensible.

**The rule is "no more than N classes inside any thirty-day stretch"**, rather than a counter
that resets on a date. A resetting counter needs a stored anchor, and the only place to put one
is a new column on `teacher_profiles` — the change this project has *measured* as taking
sign-in down until `db:push` is run by hand. A new table would avoid that, but is a lot of
machinery to hold one timestamp per teacher. Counting off the classes themselves needs neither,
cannot drift from what actually happened, and cannot be gamed by stacking classes either side of
a boundary. The implementation sorts the dates and asks whether any `N + 1` of them fit inside
thirty days, which is exact in both directions at once — a backward-only window is fooled by
creating a later class first and filling in earlier ones afterwards.

Behaviour worth knowing:

- **Days of a monthly recurring class do not count.** They are materialised as ordinary
  `sessions` rows, so a naive count would charge a teacher for classes they already paid NPR
  6,500 for. Uses the existing `notARecurringDay` guard rather than a second answer to the same
  question.
- **A cancelled class frees its slot.** It was not taught, and the refund rules already make
  cancelling expensive.
- The refusal offers an upgrade **only when that upgrade would actually take the class**, and
  never at the top tier. Selling somebody a plan that refuses them again is worse than offering
  nothing.
- No date is ever formatted by the server. The instant goes back as ISO and the app renders it
  in the reader's own calendar.

## Item 2 — charging: as far as it goes without a provider

`POST /teachers/:id/subscribe` now goes through `chargeForMonthly`, the same gate every other
payment passes. In simulated mode it approves and logs loudly that no money moved; in gateway
mode it refuses, because the eSewa/Khalti branch is still unwritten.

**That refusal is the point.** Before this, configuring a provider would have started taking
real money through a route nobody had tested against a real gateway. It now behaves like the
rest of the product, and finishing it is the same job as the payment-provider item already on
the pre-launch list — not a separate one.

**Still open:** nothing records that a teacher *owes* NPR 2,000. Refunds write a debt row an
agent works; subscriptions do not. Worth doing when the provider lands.

## Item 3 — self-approval: closed

`approvalStatus: "approved"` is gone from the subscribe endpoint, and from the app's local
`updateUser` call, which was claiming the same thing client-side. An agent's decision in
`admin.ts` is now the only door into Discover. A teacher may still buy a tier while pending —
there is no reason to make them wait to pay — they are simply not listed until somebody has
looked at them.

## Also fixed on the way

`teacher_profiles.sessions_this_month` has never been written to since registration set it to
zero, so the dashboard showed every teacher "0/10 Sessions" for ever, against a hard-coded ten,
and an upgrade warning that fired at eight could never fire at all. The dashboard and the
subscription screen now read `GET /teachers/me/allowance`, which counts off the real classes.
The column is left alone rather than repaired — a stored counter needs a reset that this project
has no scheduler to run.

## Verification

- 19 unit tests on the rules (`lib/tierLimits.test.ts`), including every tier's exact boundary.
- 26 end-to-end checks (`pnpm --filter @workspace/api-server run test:tiers`).
- **All four guards were removed one at a time and the suite went red for each**: the allowance
  check, the recurring-day exclusion, the cancelled-class exclusion, and the self-approval.
- Regressions: sessions 56, monthly 187, attendance 72, payments 10 — all passing. Typecheck
  clean across four packages; 255 API and 154 app unit tests passing.

## What is still open

- **The eleventh class is refused outright.** The alternative — create it and prompt to
  upgrade — is a product decision the owner may prefer. The refusal already names the upgrade
  that would take it, so the change would be small.
- **Does a cancelled class free its slot?** Decided yes. If teachers churn cancellations to
  dodge the limit, count them instead; nothing else changes.
- **The app duplicates the tier table** in `app/(teacher)/subscription.tsx`. The prices match
  today and the server is authoritative for enforcement, but `GET /subscription-tiers` exists
  and the screen should use it.
- **The subscription screen's payment history is hard-coded sample rows** (`PAYMENT_HISTORY`),
  showing three fictional NPR 2,000 payments to every teacher. Untouched here; it needs real
  payment records, which need the provider.
