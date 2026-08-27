# The teacher session tiers are sold, and nothing behind them works

**The owner has designated this the next piece of work** (27 Aug 2026). Two of the three items
below need a decision from them before code is written; the third does not and should just be
done.

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
