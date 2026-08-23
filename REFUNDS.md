# Money, refunds and disputes

The design the owner asked for, written down before it is built, because the timings are
intricate and a misread one is expensive to unpick later. **Nothing in this document is
implemented yet** except where it says so.

---

## 1. Three things that decide whether this is worth building as specified

Read these first. They are not objections to the idea — the idea is sound and it is how most
marketplaces work. They are the constraints it has to survive.

### No money can move at all today

There is no payment provider (see A1 in `ISSUES.md`). Bookings approve themselves and no rupee
changes hands. That means **the escrow ledger can be built, and be correct, and move nothing.**

Worth separating two integrations that sound like one:

- **Taking money in** — eSewa/Khalti checkout. This is the part usually meant by "adding
  payments".
- **Paying money out** — sending a teacher their earnings. This is a *different* mechanism,
  usually a separate agreement with the provider, and it is normally the harder half.

A holding period is meaningless without the second. Build the ledger now if you like — it is
useful for showing teachers what they are owed and when — but it is a promise the product
cannot keep until payouts exist.

### Holding other people's money is a regulated activity

Taking a student's money, keeping it for two weeks, and then deciding who gets it is not the
same business as charging for a subscription. In most countries — Nepal included — holding
funds on behalf of other people pending release is a licensed payment activity, supervised in
Nepal by Nepal Rastra Bank. **This needs an accountant or a lawyer, not a developer.**

There is a common way around it that changes nothing about the product as users see it: never
hold the money yourself. Most payment providers can settle a payment to the platform and pay
the teacher out on a delay, or split a payment between parties, and the licence is theirs. Ask
eSewa and Khalti what they offer for marketplaces before designing around holding funds.

### The Recording button is not recording anything

`toggleRecording` in the teacher's classroom shows "Recording saved to Sikshya cloud" and saves
nothing. There is no recording, no cloud, and no file. That is bad on its own and much worse
inside a refund system that would cite recordings as evidence.

**The recommendation is not to record the class at all**, for four reasons:

1. Consent. Recording a call needs both parties' agreement, and many students here are
   children, which raises the bar rather than lowers it.
2. Cost. Daily charges for recording and for storage, per minute, forever.
3. Obligation. Video of a child's lesson is the most sensitive data this product could hold,
   and holding it means being responsible for it.
4. It is not needed. Everything a refund decision actually turns on — did the teacher turn up,
   when, for how long, did they use the board, did anyone speak — can be recorded as a few
   numbers per session. That is section 3.

The fake button should be removed or made real before anything else here is built.

---

## 2. The policy, as specified

Written as the owner described it, so it can be corrected before it is code.

**The hold.** A student's payment stays with the platform for **14 days** after the session
rather than going to the teacher. During that window the session is verified: did the teacher
start it, join the call, use the board, and did the student attend.

**The refund window.** A student has **7 days** after the session to ask for a refund.

**The flow, once a student asks:**

| Step | Who | Within | What happens |
|---|---|---|---|
| 1 | Student | 7 days of the session | Requests a refund, with a reason |
| 2 | Platform | immediate | The request is checked against what the app recorded (section 3) |
| 3 | Teacher | 3 days | Asked to respond, if the evidence is consistent with the complaint |
| 4a | Platform | — | Teacher did not respond: **full refund**, teacher warned |
| 4b | Platform | 2 days | Teacher responded: student told the outcome, **before** the teacher is paid |
| 5 | Student | — | May appeal once |
| 6 | Support | — | A person reviews the appeal |

**The outcome is binary: a full refund or none.** No partial refunds.

**Escalation.** A teacher who fails to answer, and who is complained about again for a
*different* session within the following 7 days, is suspended. A teacher found at fault on
appeal is banned.

**Automatic refund.** If the class failed because of the teacher's connection, the student is
refunded without anyone having to argue about it.

**Open questions the owner needs to answer.** These change the code and cannot be guessed:

1. *"We can take the fee from their set prices"* — does the platform take a **commission** from
   each session, or is the subscription the only revenue and this sentence means the
   subscription is deducted from earnings rather than billed separately? These are different
   products.
2. What happens to a refunded session's money if the teacher has already been paid for other
   sessions — is it clawed back from future earnings, or absorbed?
3. Does the 14-day hold start at the session's end, or at the end of the 7-day refund window?
   They are different by a week and the second is simpler to reason about.
4. Is "suspended" the same as "cannot start new classes but keeps existing bookings", or a full
   stop? What happens to students already booked with a suspended teacher?

---

## 2b. Cancellations — a different thing from disputes, and now built

The policy above is about a class that **happened badly**. This is about a class that **has not
happened yet** and one side wants out of. The owner settled every rule in it, and all of them
are live.

They are kept apart on purpose. A dispute is an accusation that needs evidence and a person's
judgement. A cancellation is a clock and a subtraction: nobody is accused of anything, nothing
needs deciding, and the answer is the same for everybody. Running the second through the
machinery of the first would make a student wait days for arithmetic.

```
  ← 5 changes a month, per change, not per class →
  ─────────────────────┬──────────────┬──────────────── T
     teacher may        │   locked     │
     move the class     │              │
                   T-48h              T-24h
                        └ student may still drop ┘
```

**A teacher may move a class** until 48 hours before it starts, and only to a slot at least 48
hours away. Without that second half the promise below can be broken by moving a class
*forward*: a lesson pushed from next Friday to tomorrow leaves nobody time to react.

**Five schedule changes a calendar month**, counted per change and not per class — moving one
lesson five times spends the whole allowance. The owner was explicit: *"it is strictly 5 edits
for any session — this way the teacher is not abusing the system"*. A change means the **date or
the time**; everything else about a class stays freely editable.

**A student may drop** up to 24 hours before the class, or within 24 hours of the teacher moving
it, whichever gives them more.

**What comes back:**

| Who caused it | Student gets | Teacher gets | Platform gets |
|---|---|---|---|
| The teacher moved the class | all of it | nothing | nothing |
| The teacher called it off | all of it | nothing | nothing |
| The student changed their mind | half | a quarter | a quarter |
| An agent decided (below) | all of it | nothing | nothing |

The quarter each is a **cancellation fee**, not a "processing fee" — a processing fee is the two
or three percent a card network takes, and calling 25% by that name would be misleading in a
way that matters when somebody reads it on a screen. An odd price rounds **up** in the student's
favour, and the other two shares are whatever is left, so the three always add back to exactly
what was paid.

**A teacher may cancel a class outright**, and everybody who paid gets all of it back, is told,
and has their seat released. This is deliberately *not* rationed the way moving is: a teacher who
is ill has to be able to cancel, and making them keep a class they cannot teach in order to stay
inside a quota would be worse for everybody in it. What it costs them is the fee, in full, every
time.

Without that rule the rest of this section did nothing: cancelling was the cheap way out of a
class, with no lock, no allowance, no refund and no notification. Cancelling a class that was
*already taught* refunds nobody automatically — that is a dispute, and disputes are decided by a
person from the evidence.

**A dropped seat goes back on sale.** Confirmed by the owner. The enrolment stops being paid and
the class's count comes down in the same transaction, so the next student can take the place.

**An agent may grant a full refund**, and the owner scoped it narrowly: *"It has to be for out of
one's control type of situations"* — a teacher who never appeared, a power cut across the
valley. Not a way around the half a student accepts when they change their mind. It requires a
written reason, which is what makes that scope reviewable rather than a matter of trust, and it
is granted from the ticket, next to the attendance record and the class's thread, because that
is where the deciding happens.

**Nothing here moves money.** A refund is a row in `refunds` marked `owed`, and a person pays it
and records a reference. Every message says **requested** and names the 5-7 business days. That
is the honest shape of it until there is a provider, and it does not change when there is one:
the row is still written the same way, and settling it stops being manual.

Two things the owner has not ruled on, decided provisionally and flagged here rather than
buried:

- **Duration.** The owner defined the schedule as the date and the time. A class made *longer*
  is held to the same 48 hours as a move — a sixty-minute class turned into a three-hour one
  the night before is the same broken promise by another route — but it spends no edit and opens
  no refund window. Making a class **shorter** is always allowed; nobody's day gets harder.
- **Price.** Locked the moment anybody has paid it. Changing it afterwards either charges a
  student more than they agreed to or leaves the platform owing a difference nobody asked for.

---

## 3. What the app can actually prove

This is the foundation and it is worth building first, because every decision above rests on
it, it is useful with or without money moving, and it needs no provider and no lawyer.

For each session, per person:

- when they first joined and last were seen, and how long they were present in total
- whether the teacher ever arrived at all
- how much was drawn on the board, and how many messages were sent
- when the class started and ended, and whether it ended early
- whether the connection dropped, how often, and for how long

From those, most disputes answer themselves. A class where the teacher never joined is not a
judgement call. Neither is one where the teacher was present for four minutes of an hour, or
where the board was never touched and nobody spoke.

**Deliberately not "an AI decides".** An automatic verdict on somebody's livelihood, that
cannot be questioned, is not something to build casually. The sound version is the one used by
every marketplace that does this well: **rules over evidence produce a recommendation, and a
person makes the decision** — with the rules doing the obvious cases automatically (teacher
never joined → refund) and a human seeing everything else. That keeps appeals meaningful,
keeps the reasoning explainable to a teacher who lost a fee, and does not put a language model
in charge of somebody's income.

---

## 4. Where this starts

In order, each useful on its own. The first five are built.

1. ~~**The evidence ledger** (section 3).~~ **Built.** `session_participation` records, per
   class and per person, when they arrived, when they were last seen, how long they were
   actually connected, how many times their connection opened, and how much they drew and
   said. Written by the classroom hub from the one thing neither side can argue with — whether
   the socket was open — batched every thirty seconds and on disconnect, and unable to throw:
   a database having a bad day must not end somebody's lesson. Read back through
   `GET /sessions/:id/attendance`. The findings it produces are statements of fact with the
   numbers attached, never verdicts; see `api-server/src/lib/sessionEvidence.ts`.
2. ~~**The session page**~~ **Built.** `/session/:id` — who has enrolled before, who attended
   after, a running clock on the server's time, and a Start button that greys out with its
   reason showing once a class is past the three-hour window. Teachers are told when somebody
   books, on a notification switch of their own. It also fixed a link that had never worked:
   every invitation email points at `/session/:id`, and no such screen existed.
3. ~~**Written reviews**~~ **Built.** Optional, in the student's own words — the app used to
   invent them — and anonymous to everybody rather than only to the teacher, because a public
   list a teacher can read signed out is not made anonymous by hiding the name on their own
   screen.
4. ~~**The support desk**~~ **Built.** A separate role that cannot be reached through the app
   at all — registration accepts teacher and student only, and an agent is made by promoting an
   account directly in the database. Tickets arrive with the class's attendance record, its
   findings and its whole thread attached, because REFUNDS.md's own principle is that a person
   decides and a person deciding needs the evidence rather than a verdict. Agents can reset a
   password (as a one-time code the person redeems themselves — an agent never sees or sets
   one), review teacher credentials, suspend and unsuspend, and read an activity log of every
   action anybody took. Every action they take is itself logged.
5. ~~**Cancellations**~~ **Built** — section 2b. Moving a class, dropping one, the split, the
   seat going back on sale, and the queue of what is owed.
6. **The dispute record** — next. A refund request against a session, with its state, its
   deadlines and its evidence. Decisions recorded, nothing paid or refunded, because nothing
   can be. Half of this exists already: a report can now name the class it is about, may only
   be filed by somebody who was in that class, and no longer demands an attachment. What is
   missing is the *process* — the 3-day teacher response, the 2-day notification, the appeal,
   and the state a request moves through.
7. **Money**, when there is a provider and an answer on licensing.

### A fourth thing that has to be said, found while building the above

**File attachments have never worked.** Not "worked badly" — every attempt returned 400 before
a byte left the phone, because the app asked for an upload URL with the wrong field names.
That is fixed. But the endpoint behind it wants object-storage settings left over from this
app's Replit origins (`PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`) which do not exist on
Railway, so attachments still will not arrive until somewhere to put files is chosen and
configured. That is a decision, and possibly a cost.

Until then a report goes through without its file, and the person is told so plainly. This
matters more than it sounds for the policy above: several of its steps assume a student or
teacher can hand over evidence, and today they cannot. The attendance ledger covers most of
what those steps actually need — but not a video of a teacher behaving badly, which is exactly
the case the owner described.
