# A refusal has to name its own reason

Found on 4 September 2026 while walking the whole staging journey against a real server
(`.agents/worklog/2026-09-04-claude-staging-user-journey-audit.md`). Two defects, in unrelated
files, with exactly the same shape — which is why it is worth a note rather than two.

## The shape

A check answers **yes or no**, several different situations map onto the same **no**, and the
caller words that one `no` using whichever situation whoever wrote it had in mind. The sentence is
then true for one case and false for the others — and it is *fluent*, so nobody reads it as a bug.

- `canAccessSession` returned `false` for four different things: never enrolled, not paid, class
  cancelled, and simply too early. The room route said **"You must be enrolled in this session to
  join it."** To a student who had booked and paid and opened their class the evening before, that
  is a false statement about their own booking.
- `sendVerificationEmail` consulted the rate limiter before the mail configuration, so a server
  with no provider answered **"Please wait a minute before asking for another email."** Nobody was
  waiting for anything; none had been sent and none could be.

## What to do instead

Return **which** refusal it is, and define the boolean in terms of that:

```ts
export function accessRefusalFor(m, now): "not-enrolled" | "unpaid" | "cancelled" | "outside-window" | null
export function canAccessSession(m, now) { return accessRefusalFor(m, now) === null; }
```

The decision stays in one place — which is the whole reason `membership.ts` exists, since the
video room and the whiteboard socket must never disagree about who is allowed in — and only the
*wording* varies by caller.

And when several conditions can refuse, **order them by which is true**, not by which is cheapest
to check. Configuration outranks a cooldown: a server that cannot send email should say so
whatever the rate limiter thinks.

## Why it matters more here than it looks

Both defects lived in what happens when something is **switched off**, which is exactly the state
staging is deliberately in — no mail, no payment provider, no storage. A suite that only tests the
working path never sees them. The second one also silently defeated a fix made the day before:
`check-email.tsx` had just been rewritten to stop claiming an email it could not confirm, and then
faithfully displayed the server's untrue sentence instead. **A screen can only be as honest as the
answer it is given.**
