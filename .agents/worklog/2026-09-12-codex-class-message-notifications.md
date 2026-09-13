# Class-message notifications and unread acknowledgements

Status: safety-tested and deployed to preview; awaiting owner review
Branch: `codex/class-message-notifications`

## Goal

Make a teacher's class update visible without requiring a student to discover it accidentally:
give every class conversation a durable unread count, a clear badge, live refresh and an actionable
notification, while never calling a delivery or socket event “read”.

## Work performed

- Added the additive `class_group_message_reads` table. Its `(batch_id, user_id)` key stores only
  the highest message the person explicitly acknowledged after successfully loading the thread.
- Class-home unread counts exclude the reader's own messages and, for late-joining students,
  messages written before they joined. The visible total follows the same joining boundary.
- Added an authenticated read-acknowledgement endpoint. It refuses invented IDs and messages from
  another class, and uses `greatest(...)` so delayed requests cannot move a read position backward.
- Sending a teacher message alerts the booked students. Sending a student question alerts the
  teacher without ringing every classmate's phone or inbox.
- Added a `class_message` notification kind governed by the existing Messages switches. Its email
  and notification open the exact class conversation rather than a generic inbox.
- Added device sound through Expo notifications, an Android-browser vibration cue where supported,
  and a crimson unread badge on the Class messages card.
- The class chat refreshes from the server on a live event; the event is only a nudge and is never
  trusted as message content. Returning from chat refreshes the class home so a cleared badge does
  not remain painted on screen.

## Verification so far

- Repository-wide typecheck: pass across all four workspaces (run with dependency-junction access).
- API unit suite: pass, including class-group and notification-kind coverage.
- App unit suite: 399 passed, 0 failed.
- Focused notification/class-group tests: 20 passed, 0 failed.
- `git diff --check`: clean.
- The real API/Postgres batch journey was extended with unread/read isolation checks. Local run
  correctly refused to start because no disposable local PostgreSQL URL was configured; CI is the
  authorized disposable-database gate.
- Disposable-database safety workflow `34727662529`: passed, including schema push, API build,
  real Program/batch journeys, video/proof/access gates and rendered browser checks.
- Railway staging was fast-forwarded to commit `5e73017`; the protected read endpoint returned 401
  after deployment, proving the new API route is live rather than missing.
- Preview workflow `34727893858`: passed and deployed the matching web bundle to
  `https://hometuition-preview.praksh-dhakal.workers.dev`.

## Deliberate boundaries

- This does not create a real payment, enrollment or new access path. Recipients come only from the
  existing teacher ownership and test-booking authority.
- Offline users receive the email fallback if they left Messages email enabled. On reopening a
  class, the database-backed badge remains authoritative even if the live socket was unavailable.
- iPhone Safari does not support the browser vibration API; the visible badge, notification entry
  and email fallback still work. Native apps use the existing sound-capable Expo notification path.
- Attachments, reactions, pins management and teacher marking/feedback have not been copied from the
  legacy Monthly tools yet.
- Production is unchanged.
