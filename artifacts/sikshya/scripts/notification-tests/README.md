# Does the app actually show a notification?

The server-side suite (`artifacts/api-server/scripts/notification-tests`) proves an event
leaves the server. This proves the other half: that the real built app, in a real browser,
opens the channel, receives the event, and puts it in front of the user.

Between those two halves is where the reported bug actually lived. Nothing was throwing and
nothing was misconfigured — the app simply never listened, and filled the gap with six
notifications it had invented on the device.

## Running them

The app must be built against a running API, because the API address is compiled into the
bundle:

```
EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm.cmd --filter @workspace/sikshya run build
pnpm.cmd --filter @workspace/sikshya run test:notifications
```

Point somewhere else with `API_URL`. Needs Playwright, the same way the whiteboard tests do:
`npm.cmd i -g playwright && npx.cmd playwright install chromium`.

**Rebuild before deploying.** This build points at localhost. The build script clears the
bundler cache when the API address changes, so the next real build is correct — but a build
made for this test must never be the one that ships.

## What they cover

| Test | The failure it would catch |
|---|---|
| A message appears without a refresh | The app never opening the channel — the original bug |
| It names who it is from, and what was said | An event arriving stripped of what makes it useful |
| It can be tapped through to the conversation | A notification that tells you something happened and then abandons you |
| A brand new account has no notifications | The invented sample data coming back |
| The same message is not announced twice | Duplicate delivery across devices or reconnects |
| Turning a switch off stops it reaching the app | A preferences screen that does not change behaviour |

## Proving they work

Three deliberate breaks were run:

- Stopping the app from listening (`useUserChannel(false, ...)`) — exactly the four delivery
  checks went red.
- Restoring `seedSampleNotifications()` — exactly the "brand new account" check went red.
- Removing the preference check on the server — the server suite's preference check went red.

Each restored to 9 passed, 0 failed.
