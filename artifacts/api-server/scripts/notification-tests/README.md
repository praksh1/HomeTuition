# Notification tests

These drive the real thing: a running API, a real Postgres, real WebSockets. They exist
because the last report about notifications was that they "are not realtime", and the truth
was worse — there was no notification system at all. The list a user saw was sample data
written into their own device's storage the first time the app opened, and nothing on the
server ever told a teacher they had a new follower.

A unit test would not have caught that. Nothing was broken; the wiring was missing.

## Running them

You need a database and the API running against it. From the repo root:

```
pnpm --filter @workspace/api-server run test:notifications
```

That expects the API on `http://127.0.0.1:8080`. Point it somewhere else with `API_URL`:

```
API_URL=http://localhost:3000 pnpm --filter @workspace/api-server run test:notifications
```

Two of them wait for the server's heartbeat, which is 25 seconds in production — so run the
server with `WS_HEARTBEAT_MS=3000` and the tests with `HEARTBEAT_MS=3000` unless you want to
wait a minute, or skip them with `SKIP_SLOW=1`. They prove the mechanism, not the number.

They create their own users (a fresh email per run), so they can be run repeatedly against
the same database without cleaning up first. Do not run them against production: they write
users, classes, bookings and messages.

## What they cover

| Test | The failure it would catch |
|---|---|
| A message reaches someone who is not on the Messages screen | Announcing only from the Messages list poll — the original bug |
| The sender is not told about their own message | Echoing an event back to whoever caused it |
| Following a teacher tells the teacher | Following writes a row nobody reads |
| Every device a person is signed in on hears it | Delivering to one socket and dropping the rest |
| Turning a notification off actually stops it | A preferences screen that does not change behaviour |
| An older app cannot wipe settings it has never heard of | A partial update clearing switches it did not send |
| The channel cannot be opened without proving who you are | An unauthenticated socket reading someone else's notifications |
| Taking a class live tells the students who paid for it | Telling everyone, or telling nobody |
| Many people at once, and nobody misses theirs | Events lost or merged under concurrency |
| A disconnected listener does not break the thing being announced | A dead socket failing the message that triggered it |
| A connection that dies silently is noticed and cleaned up | A half-open socket the app never learns to retry (E8) |
| A student whose connection dies is noticed, and can come back | The same, on the socket a student sits on during a lesson |

## Proving they work

A test suite that has never failed has not been shown to do anything. Both of these were run
deliberately:

- Removing the preference check in `src/lib/notify.ts` — exactly one check went red
  ("no message notification arrives").
- Removing the token check on the user channel in `src/ws/classroomHub.ts` — exactly the
  three security checks went red.

- Commenting out `startHeartbeat` — exactly the "server closed the dead connection" check went
  red, which is precisely the state the product was in before.

Restoring each returned the suite to 44 passed, 0 failed.

## The email path

The suite runs with no mail provider configured, which is the state the server ships in — so
it asserts that the app is *told* email is unavailable rather than shown switches that cannot
work. Sending itself was checked separately, by running the server with a deliberately invalid
`RESEND_API_KEY`:

- `emailAvailable` flips to `true` as soon as `RESEND_API_KEY` and `EMAIL_FROM` are set.
- A message sent while the provider is unreachable still returns 201 and is still stored. The
  failure is logged (`email send failed`) and nothing else happens.
- The server stays up.

That is the property that matters: announcing a message must never be able to fail the message.
`sendEmail` catches everything and no route awaits it.
