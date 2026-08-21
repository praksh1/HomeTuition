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

In order, each useful on its own:

1. **The evidence ledger** (section 3). No money, no provider, no legal question. Also powers
   the attendance list and the "teacher is late" rule the owner asked for separately.
2. **The session page**: who has enrolled, before; who attended, after. Teachers told when
   somebody books.
3. **Written reviews**, shown to teachers without the student's name.
4. **The dispute record** — a refund request against a session, with its state, its deadlines
   and its evidence. Decisions recorded, nothing paid or refunded, because nothing can be.
5. **Money**, when there is a provider and an answer on licensing.
