# A notification with no off switch

Adding a notification kind takes four edits, and the fourth is easy to miss:

1. `api-server/src/lib/notificationPrefs.ts` — the `PrefKind` union, `PREF_KINDS`, `DEFAULT_PREFS`
2. `api-server/src/lib/notify.ts` — the `NotificationKind`, the `PREF_KEY` mapping, the email body
3. `sikshya/utils/notificationPrefs.ts` — the app's mirror of the same type and defaults
4. **`PREF_ORDER` in the same file** — which switches the settings screen actually renders

Miss the fourth and the notification ships on by default, on both channels, with no way
anywhere to turn it off. Nothing fails: the server sends it, the screen simply has no row for
it, and the only person who finds out is the user being notified.

This happened with `bookings` and survived one commit. The fix was to move the order list next
to the type it has to cover and assert they match in both directions —
`sikshya/utils/notificationPrefs.test.ts`. That test is the guard; the four-step list above is
why it exists.

The two packages deliberately do not share code, so the app's copy of the type will always be a
mirror that can drift. The test only covers the app's side of the mirror; keeping the server's
`PREF_KINDS` and the app's `PrefKind` in step is still a manual step.
