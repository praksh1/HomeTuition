# Fadko Support Knowledge Base — review draft

These are article *slots*, not production truth. Every row must be reviewed by the owner before
its status can become `published`. The assistant must never answer from a draft.

| Slug | Intent | Draft question | Required source before publishing |
|---|---|---|---|
| `test-checkout` | billing | What does test checkout do? | Current test-access / commerce contract |
| `payment-receipt` | billing | Where can I see my payment or receipt? | Current payment ledger and student screen |
| `refund-original-method` | billing | How does a refund return? | `REFUNDS.md` plus payment-provider behaviour |
| `join-booked-class` | class_access | How do I join a class I paid for? | Session access and time-window rules |
| `class-ended` | class_access | Why did the room say the session ended? | Session lifecycle and redirect behaviour |
| `messages-realtime` | messaging | Why did my message not appear yet? | WebSocket/reconnect contract |
| `homework-submit` | homework | How do I submit homework and view feedback? | Homework routes and notification preferences |
| `profile-location` | account | How do I correct Province/District/Municipality? | Nepal location validation contract |
| `change-login-contact` | account | What if my login phone/email changed? | Auth and refund-contact policy |
| `report-safety` | safety | How do I report unsafe or inappropriate behaviour? | Existing dispute and evidence flow |

Editorial rules:

- Use short, direct language and one action per paragraph.
- Never publish a number, fee, refund promise, tax statement, plan name or payout date unless it
  comes from the current server contract and has an owner review date.
- Never claim that Fadko or a teacher is “verified” unless the existing approval state supports the
  exact wording.
- Link to the relevant screen, not an invented URL.
- Keep Nepali and English copies as separate reviewed versions; do not machine-publish a translation.
