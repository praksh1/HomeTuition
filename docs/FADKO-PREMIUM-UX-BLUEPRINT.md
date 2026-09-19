# Fadko premium experience blueprint

This is the product contract for the next UI pass. It is inspired by the calm, tactile navigation
shown in the Robinhood recording, but it keeps Fadko's identity, education workflows and Nepal-first
clarity. The goal is not decoration. Every surface should make the next useful action obvious while
remaining fast on a low-cost Android phone and spacious on a laptop.

## The north star

Fadko should feel like a calm control room for learning:

- one persistent floating navigation surface on phone and web;
- one clear active state, with a quiet blue glow/bubble and a small live badge;
- a profile overflow menu for account, money, support and settings;
- no screen that makes a teacher or student hunt through legacy tools;
- no invented prices, ratings, earnings, or status claims;
- motion is brief and purposeful, never a loading substitute.

## Navigation contract

Teacher tabs are Dashboard, Schedule, Students, Support, Messages and Profile. Student tabs are
Discover, Classes, Messages, Support and Profile. Hidden detail routes must not paint the bar over
their content.

The shared `FloatingTabBar` is a centered capsule. On phones it stays within the thumb zone and
clears the safe area; on laptops it caps its width rather than stretching across the page. Each item
has a 44-point touch target, icon, short label, selected bubble, four-pixel active dot, and an
unread badge when needed. The bar is intentionally border-first and uses one light shadow so a
cheap device does not repaint a heavy blur on every scroll frame.

## Profile contract

The profile screen keeps the identity hero, but adds a top-right menu for actions people use from
anywhere:

- Edit account details;
- Payments & receipts or Teaching & earnings;
- Notifications;
- Fadko Support;
- Fadko AI assistant (shown as coming soon until a real assistant exists);
- Log out.

The menu is a shortcut, not a second source of truth. The full account and earnings sections remain
available below it. A disabled future feature must be labelled as coming soon; it must never look as
if an AI agent is already handling a customer case.

## Responsive behavior

- Compact (phone): one column, floating bar, sheets for secondary actions, no horizontal overflow.
- Medium (tablet): same interaction model with wider cards and more breathing room.
- Expanded (laptop): readable content columns, centered navigation capsule, no stretched admin-table
  layouts. Keyboard focus, hover/pressed states and browser Back must remain first-class.

## Motion and performance rules

Use one short state transition for selection and opening a menu. Do not add looping animations,
large blur layers, or network requests to a tap that can be local. A realtime message should appear
without a refresh, and opening a conversation should settle at the newest message only when the
user has not deliberately scrolled into history.

## Message experience contract

- Opening a direct or class conversation lands on the newest message.
- On web, Enter sends and Shift+Enter inserts a newline; IME composition must not send early.
- The inbox uses one compact View menu with counts in parentheses: All conversations (n), Classes
  (n), Direct (n), Unread (n).
- Reading a conversation marks its matching notification read on every device through the server,
  not only through local browser state.

## Next high-value slices

1. Verify the floating navigation and profile menu at 390px, 768px and 1440px, including keyboard
   focus and browser Back.
2. Add a shared command/search surface for laptop users, with only routes the current role can use.
3. Modernize the class home into a compact overview: next lesson, attendance summary, students,
   messages, homework and materials as separate cards rather than one long roster.
4. Add document preview as an in-window sheet with page navigation, zoom and download, without
   changing the attachment authorization rules.
5. Add a real notification read contract for cross-device updates and a reconnect indicator for
   class conversations.
6. Only after these are proven in Preview should Production be considered.

## Explicitly out of scope for this visual pass

Real payment activation, payout policy, tax calculations, AI customer-service claims, operator
automation, and Production deployment. Those remain separate product and financial decisions.
