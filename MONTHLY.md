# The monthly tier

A teacher pays Sikshya **NPR 6,500 a month** and gets one recurring class: same time every day,
up to 45 students, up to 90 minutes. Students pay the teacher a monthly fee, pro-rated if they
join part-way through. This file is the design and the current state.

---

## The one rule everything else follows

**A month here is thirty times twenty-four hours from a timestamp. It is never a calendar
month.**

That is the whole answer to "make sure the two date formats don't conflict the dates/monthly
rates". A Bikram Sambat month runs 29 to 32 days and a Gregorian one 28 to 31. If any price
were worked out from "a month", the same class would cost two different amounts depending on
which calendar somebody's phone was set to, and a teacher and a student reading different
calendars would disagree about when the month ended.

So no calendar arithmetic touches a price, anywhere. Bikram Sambat and Gregorian are **display
only**, converted in the app at the moment something is shown to a human. The server stores
instants and counts of classes.

The arithmetic lives in `artifacts/api-server/src/lib/monthly.ts`, which has no database access
at all so that every rule about money can be tested directly.

---

## Teacher and student can never be in different months

The owner asked for every situation where the two get out of step to be worked out. The answer
was to remove the possibility rather than to handle the cases:

**There is only one clock.** The teacher's cycle *is* the student's cycle. A student who joins
on day twelve pays for what is left of the teacher's month and then renews on the same day the
teacher does.

The alternative — each student on their own month from the day they joined — is what creates
the problem in the first place. A teacher whose month runs 12th to 12th taking leave on the 1st
would strand students who had paid to the 20th, and there would be as many different month-ends
as there were students.

What follows from having one clock:

| Situation | What happens |
|---|---|
| Student joins on the last afternoon | Pays for the one class left, not for a month |
| Student joins with no classes left | Refused, and told when the next month starts. Nothing is charged |
| Student joins on day 12 | Pays 18/30 of the fee, renews with everybody else on day 30 |
| Teacher's month rolls over | Every student rolls over at the same instant |
| Teacher stops mid-month | Every student is owed for the classes that will not now happen |

### The clock starts at the class, not at the purchase

A teacher is charged the day they buy, but the thirty days start when they **create their
recurring class**. A plan bought and never used would otherwise sit forever having bought
nothing, so after seven days the clock starts anyway.

---

## Money

- **Pro-rated by classes, never by days.** What is sold is classes, and the quality floor is
  stated in classes, so pricing in days would mean two units and an argument in the gap. A
  student joining with nine classes left pays nine thirtieths.
- **The denominator is frozen when they join.** What they are owed later is worked out against
  what they actually bought.
- **Part-rupees round down**, in the student's favour.
- **Sikshya takes 30%** of a student's fee. Configurable — `PLATFORM_SHARE` in `monthly.ts`.
- **The teacher's 6,500 is entirely Sikshya's.** It is what they pay to run a monthly class,
  not a share of anything.

### Refunds

No refund while a teacher holds **25 classes or more** in the month. Below that, the whole
shortfall comes back — missing the floor voids the month's promise rather than discounting it.

**Stopping early is judged differently, on purpose.** A teacher suspended on day 28 has usually
held exactly 25 — the floor — but their students have days left that will now never happen, so
they are owed for them. The floor governs a month that ran and fell short; this governs a month
that stopped.

> **Open decision.** A student who joined late, bought 9 classes and lost 3 of them gets nothing
> back if the teacher still cleared 25 overall. That is the rule exactly as stated, and it is
> the rule at its harshest. Scaling the floor to the student's share is a one-line change in
> `metDeliveryFloor()`.

---

## What is built

| | |
|---|---|
| The rules and the arithmetic | ✅ `lib/monthly.ts` — 35 tests |
| Local time of day → instants | ✅ `lib/monthlySchedule.ts` — 11 tests |
| Four tables + boot guard | ✅ and a script proving both ways of creating them agree |
| Buy the tier, create the class, join it | ✅ 7 routes — 74 end-to-end checks |
| The daily class actually running | ❌ class-days are planned, not yet real classes |
| Changing the daily time | ⚠️ refused with a clear message; the rule is enforced, the move is not written |
| Make-ups, abuse counting, suspension | ❌ |
| Homework portal, group chat | ❌ |
| Anything in the app | ❌ API only so far |

Run the tests:

```
node --test --experimental-strip-types artifacts/api-server/src/lib/monthly*.test.ts
pnpm --filter @workspace/api-server run test:monthly     # needs the API running
artifacts/api-server/scripts/monthly-schema/compare.sh   # schema agreement
```

---

## Two traps for whoever picks this up

**Shifting existing class-days collides with itself.** Moving a month of them by twenty days
lands some on instants their own neighbours still hold, and `recurring_days_slot_idx` refuses
it — correctly. Whether it refuses depends on the order Postgres updates rows in, so the naive
version passes several times before failing. Hop the whole set clear of its own range and back.
This is exactly what "change the daily time" has to do.

**The tables get created two different ways.** `db:push` from the schema files when the owner
runs it, and hand-written DDL in the boot guard when Railway redeploys. Those are never in
step, so `scripts/monthly-schema/compare.sh` builds them both ways and diffs the result. Change
one, change the other, run the script.
