# Two monthly-tier decisions the owner parked, with the context to pick them up cold

The owner asked for these to wait, and asked to be reminded properly rather than with a title:
*"when you come back to it and remind me I may not remember so provide the details."* So this
is written to be readable months later by somebody who has forgotten the conversation.

Both are **pricing and fairness questions before they are code questions.** Neither should be
started without a decision from the owner.

---

## 1. A month that is not a whole month (owner's item 5)

### What they asked

> "Let's say in the month of Bhadra, there are 17 days after which national holidays/festivals
> start and everyone goes on leave — can teacher create sessions for only those 17 days?"

### Why this is not a setting

A monthly class today runs **every day**, and three separate rules are built on that:

- **The price** is `monthlyPrice` for a cycle, and a student joining part-way pays pro-rata on
  *sessions remaining* — see `quoteJoin` in `api-server/src/lib/monthly.ts`.
- **The delivery floor** is `MIN_SESSIONS_PER_CYCLE = 25`. Below it the teacher owes a refund
  for the shortfall; at or above it they owe nothing.
- **Suspension** counts missed days against the teacher across the cycle.

A 17-day month breaks all three. Twenty-five is not a floor a 17-day month can clear, so every
teacher running one is in permanent shortfall and suspended by a rule meant to catch neglect.
Pro-rata quoting divides by a session count that no longer means "the days this runs".

### The shape of the decision

The floor has to stop being an absolute number and become a **proportion of the days the class
actually offers** — something like "you must hold at least 85% of the days you published".
That single change is what lets a class of any length exist. Everything else follows: the quote
divides by published days, and the refund is against the same denominator.

There is a second, harder half. Nepal's festival calendar is not fixed to Gregorian dates and
moves year to year, so **the app cannot infer the days** — the teacher has to publish them.
That means a way to say "these are the days I will teach this cycle" at the moment they set the
class up, and to *republish* for the next cycle. A calendar the teacher paints, not a rule the
app guesses.

### What to settle with the owner first

- Is the floor a **percentage of published days**, and what percentage?
- When a teacher publishes 17 days, is the **monthly price the same** as for 30? (It should not
  be, but that is their call — it is their revenue.)
- Does a student joining a 17-day cycle see "17 classes" everywhere, including the receipt?
- What happens at the boundary of a cycle that ends mid-festival?

### Where the code lives

`api-server/src/lib/monthly.ts` (the rules, all pure and unit-tested — start by reading its
tests), `lib/db/src/schema/recurringDays.ts` (the day rows), `lib/db/src/schema/recurringSessions.ts`.

---

## 2. Dropping the whole course mid-month (owner's item 6)

### What they asked

> "We may need to come up with something for dropping the entire course in the middle."

### What happens today

`stoppedEarlyRefund` in `api-server/src/lib/monthly.ts` pays back the part of the month the
student has not used. That is the right instinct and it has a hole in it: **it refunds days the
student themselves chose not to attend.**

So a student can book a month, skip a fortnight, drop out, and be refunded for the fortnight
they skipped — while the teacher held every one of those classes and was paid for none of them.
The teacher carried the cost of an empty seat nobody else could book.

### The tension to resolve

Refunding **unheld** days is obviously fair. Refunding **held days the student did not attend**
is obviously not. But attendance is a blunt instrument: a student who was ill for a week, or
whose connection failed, looks identical to one who lost interest, and the platform is aimed at
people on cheap phones and poor connections where that failure is common.

A defensible middle: refund only the days **not yet held** at the moment of dropping, and say so
plainly at the point of joining. That is simple, cannot be gamed either way, and does not
require the app to judge why somebody was absent. It also means a student who drops on day 25
gets very little back — which is correct, and has to be *visible before they pay*, not
discovered afterwards.

### What to settle with the owner first

- Refund unheld days only, or something more generous?
- Is there a **cooling-off period** — say, the first two days — where the whole amount comes
  back? (Common, cheap, and heads off most complaints.)
- Does dropping mid-cycle bar re-joining the same class later that cycle at the pro-rata price?
  Without a bar it is a way to pay twice for one month, or to dodge the shortfall rule.
- Does the teacher's delivery floor still count the days a dropped student did not take?

### Where the code lives

`api-server/src/lib/monthly.ts` — `stoppedEarlyRefund`, and its tests in `monthly.test.ts`,
which are the fastest way to see what the current rule actually pays.
