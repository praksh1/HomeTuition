# Class homework notifications

Date: 2026-09-13
Branch: `codex/class-homework-notifications`

## Delivered

- Replaced the misleading reuse of booking and class-invitation notification types for homework.
  A hand-in no longer looks like a paid booking, and returned feedback no longer looks like a new
  class invitation.
- Added three explicit events: homework set, homework submitted and homework feedback returned.
- A new assignment is sent to the students currently booked into that class. A hand-in goes only
  to the class teacher. Returned feedback goes only to the student whose work was reviewed.
- In-app/device wording names the homework and class without claiming payment, delivery or a new
  schedule. Email wording follows the same rule.
- Tapping any homework notification opens that class's Homework screen rather than a generic
  dashboard or session list.
- An open class home or Homework screen refreshes when a relevant event arrives, so a teacher or
  student does not need to reload to see the update.
- Profile notification settings now include a separate `Homework updates` control. It covers new
  tasks, student hand-ins and returned feedback without changing message or booking preferences.

## Safety and scope

- Notification recipients are derived from the authenticated class and its existing bookings;
  the client cannot nominate another teacher or student.
- Existing class access checks remain the authority for setting, submitting and reviewing work.
- No table, column, migration, payment, refund, booking or video-provider behaviour changed.
- Production was not changed by this work.

## Verification before commit

- Full workspace typecheck: pass across all four packages.
- API production build: pass.
- API unit suite: 561 passed, 0 failed.
- Sikshya unit suite: 407 passed, 0 failed.
- Design lint: unchanged at 94 hex literals / 282 raw sizes.
- `git diff --check`: clean.

## What went wrong / not claimed

- The first app test run found that the notification contract test required every server event name
  to be explicit in `NotificationContext`. The implementation had intentionally grouped the three
  kinds with a prefix check, which worked at runtime but weakened that drift guard. The handler now
  names all three kinds explicitly; the complete app suite then passed.
- The earlier full typecheck inside the restricted sandbox could not follow existing workspace
  dependency links. The required full gate passed outside that restriction.
- This is event-driven notification, not a scheduled before-deadline reminder service.
- Email delivery still depends on the recipient's email preference and the configured Brevo service.
- The web can request vibration where the browser permits it; browsers and devices may refuse it.

## Preview deployment

- Pending commit, safety workflow, Railway staging and Cloudflare preview details.
