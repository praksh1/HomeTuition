# Premium notification centre — 15 September 2026

## Outcome

Rebuilt the shared teacher/student notification centre and its settings as one coherent surface.
The change is local on `codex/premium-notifications`; it has not been pushed, previewed, merged or
deployed.

## Product changes

- Opening one notification now reads only that item. Previously it silently marked the entire
  inbox read.
- All and Unread views show real counts, and the newest 20 updates are shown first with an
  explicit **Show older updates** action.
- Notifications are grouped by Nepal calendar day, with exact times labelled **Nepal time**.
- One shared routing authority now opens class chat, homework, lesson, classroom, program,
  conversation and payment history destinations. The notification tray and device notification
  tap cannot drift to different screens.
- Settings are role-aware: students do not see teacher-only booking/follower switches, and
  teachers do not see the followed-teacher publishing switch.
- Notification and calendar settings now use the Fadko type, colour, spacing and touch-target
  tokens. Raw design debt fell by 12 colour literals and 21 font sizes.

## Evidence

- Sikshya TypeScript: clean.
- Sikshya unit suite: **464 passed, 0 failed**.
- Focused notification contracts: **13 passed, 0 failed**.
- Rendered notification/settings suite: **40 passed, 0 failed** at 390 and 1440 widths.
- Visual inspection: initial, all-read and settings states at both widths; no clipped content or
  horizontal overflow.
- Design gate: **71 raw hex / 225 raw font sizes**, down from 83 / 246; baseline locked.
- `git diff --check`: clean.

## Deliberate boundaries

- Notification history remains device-local after durable server events arrive. Moving read state
  between multiple signed-in devices is a separate server/schema change and is not claimed here.
- No payment, booking, class, homework, message or provider behavior changed.
- No notification text invents attendance, delivery, payment or refund outcomes.

## Next

After review and explicit push approval: deploy this branch to Preview, verify with both a teacher
and student account, then ask separately before production. The next premium slice after this is
the Sessions experience and its class/lesson hierarchy, not another Messages rewrite.
