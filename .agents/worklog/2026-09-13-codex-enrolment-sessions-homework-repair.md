# Enrolment, Sessions and homework repair — 13 September 2026

## Owner reports reproduced

- A confirmed staging class booking returned to **Try test checkout** after signing out and in.
- Student **Sessions** exposed every generated classroom row, so one purchased class could create
  dozens of nearly identical cards.
- Teacher feedback remained editable after it was returned and the first review could already
  display the contradictory “Feedback already returned” copy.
- Homework events sent while a user was signed out were lost because WebSocket delivery was the
  only in-app path.
- Production still exposed obsolete Monthly-plan/Test-tool entrances, the legacy single-session
  builder still required a purchased teacher tier, and Expo Router could reuse the previous class
  editor at its final step.

The 3:24 production recording and 0:52 staging recording were inspected frame by frame. The staging
recording proved the booking row was not lost: pressing Refresh changed the same page from checkout
to enrolled. This was a client restoration defect, not a payment or database defect.

## Product behavior after this change

### Test enrolment

- An authenticated class page checks the server on mount. A persisted test booking restores without
  another checkout press or a temporary checkout offer.
- Signed-out visitors still receive the existing sign-in/account prompt; the private booking API is
  not called for them.
- Late test enrolment sends the newly enrolled student every still-open homework assignment for that
  class. It does not pretend assignments already closed are new work.

### Student Sessions

- The default screen is **Upcoming**, with **Live** and **History** one tap away.
- Server-owned batch/session relationships group all generated lessons into one class card. Topic
  suffixes are never parsed to guess ownership.
- A continuing class appears in exactly one section. Live wins, then Upcoming; History only contains
  a class after all its lessons have ended. Refunds remain visible in History.
- The class card opens Class Home, where lessons, homework, messages and records already live.

### Homework

- Teacher submissions are sorted **Needs review** first, then **Returned**, and are collapsed until
  opened. This remains usable with twenty or more students.
- Returning feedback is a one-time action for that submission version. The server returns HTTP 409
  to a second return, and the UI shows the returned feedback instead of another editable form.
- A student may hand in a replacement; that creates a new review state and intentionally unlocks the
  teacher review flow for the new version.
- In-app homework events are stored in an additive notification inbox before live delivery. The app
  pulls its per-user cursor on sign-in and every 30 seconds, so an assignment, hand-in or feedback
  sent during logout, sleep or a dropped socket is delivered later. Existing Profile → Notifications
  switches continue to control homework push/in-app and email delivery.

### Obsolete flows

- Monthly-plan cards, filters and shortcuts are removed from current teacher/student UI.
- Earlier Test Tools are removed from the teacher UI.
- The historic routes and implementation remain in the repository for old records and future
  reference; this change does not delete data or schemas.
- “Just one lesson” now uses the current class builder with one date and one price. It no longer opens
  the oversized legacy native time selector or applies the retired teacher-tier purchase gate.
- Every no-id Create Class visit starts a fresh draft. It cannot reopen the last published class at
  Step 4 or reuse its stale idempotency/review state.

## Data and rollout safety

- One additive table, `user_notification_events`, with a user/id index. Boot-time guard uses only
  `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`; there is no alter, drop or rewrite.
- Notification persistence has a live-delivery fallback during a mixed-version deploy. A temporary
  table failure cannot silence subsequent recipients or email.
- All new session grouping is derived from server database joins. The client cannot claim that an
  arbitrary session belongs to a class.
- No payment provider, real charge, refund, payout, Daily/LiveKit setting or production environment
  is changed here.

## Verification before preview deployment

| Gate | Result |
| --- | --- |
| Sikshya unit suite | 420 passed, 0 failed |
| API unit suite | 565 passed, 0 failed |
| Workspace typecheck | 4/4 packages passed |
| Batch checkout rendered UI | 80 passed, 0 failed |
| Current class setup rendered journey | 93 passed, 0 failed |
| Teaching/earnings responsive UI | 24 passed, 0 failed |
| Design ratchet | no new leaks; improved from baseline |
| Staging-targeted web export | passed; bundle verified staging API and Fadko identity |
| `git diff --check` | clean |

The full real-Postgres `test:batch-booking` suite cannot run on this Windows host because no disposable
PostgreSQL/`PGURL` is configured. Its contract was extended for restored booking, server-owned class
grouping, feedback lock, offline inbox delivery and late-enrolment homework catch-up. Those checks must
run against the preview workflow's disposable PostgreSQL database before the preview Worker is deployed;
the workflow now gates deployment on that suite and the notification-delivery suite. Production must
remain untouched until the owner completes the short preview test and explicitly approves release.

## Preview approval and production integration

- Preview workflow `34784817000` passed every gate at staging commit `3c0080d`, including the
  disposable-PostgreSQL batch checkout/homework suite, notification delivery, responsive browser
  checks, staging bundle verification and Cloudflare deployment.
- The staging API answered HTTP 200 at `/api/healthz`; the new authenticated notification inbox
  route answered HTTP 401 without a token, proving Railway was serving the new API rather than an
  older revision. The preview Worker answered HTTP 200.
- The owner completed physical preview testing and replied **Passed**.
- Production integration was made from the then-current `origin/main` so commits `0c9146d`
  (teacher navigation release gate) and `ea46547` (historic monthly journey preservation) remain in
  history. Git merged without conflicts. Unit, typecheck, checkout, class-setup and teaching/billing
  browser gates remained green on the merged tree.
