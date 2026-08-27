# The UI upgrade, screen by screen

The owner moved to visual work on 27 Aug 2026 and asked for the app to be brought up to a
premium standard **without touching business logic, database queries or state**. The design
system was agreed first (`DESIGN.md`), then screens are being converted one at a time.

This file is the running state. Anyone picking it up — human or another AI — should read
`DESIGN.md` first, then this.

---

## The standing rules for every screen

1. **No hex literal outside `constants/`.** Colours come from `useColors()`.
2. **No raw `fontSize`.** Text takes a named step from `useLayout().t`.
3. **No spacing value off the 4pt scale** in `constants/layout.ts`.
4. **One primary button per screen.**
5. **Crimson `brand` is identity and LIVE only.** Every action is the royal blue `primary`.
6. **Destructive is never a filled button** — text or outline, filled only on a confirm sheet.
7. **Numbers that line up get `numeric`** (tabular figures): money, counts, clocks.
8. **Loading, empty and failed are three different pictures**, never one placeholder.
9. **Never invent a value.** See the next section — this is the recurring one.

Run after each screen:

```
pnpm run typecheck
pnpm --filter @workspace/sikshya run test
pnpm --filter @workspace/sikshya run lint:design          # must not regress
pnpm --filter @workspace/sikshya run lint:design:update   # lock the improvement in
```

---

## The pattern that keeps turning up: the app invents data

**Every screen converted so far has contained at least one number or claim with nothing behind
it.** This is now the single most valuable thing to look for, and it is worth opening each new
screen expecting to find one.

The tell is always the same: a column that is written once at registration and never again, or
a hardcoded array, or a value derived from `?? 0`.

Found and fixed so far:

| Screen | The fabrication |
|---|---|
| Teacher dashboard | `sessionsThisMonth` — written to 0 at registration, never again. Every teacher saw "0/10 Sessions" forever, against a hardcoded 10 |
| Teacher dashboard | `monthlyEarnings` — same dead column. "NPR 0k Earned" to everybody, forever |
| Subscription | `PAYMENT_HISTORY` — three invented NPR 2,000 payments shown to every teacher, including one who registered that morning |
| Subscription | The plan promised **session recording** and **cloud storage** — neither exists anywhere in the codebase |
| Subscription | "Up to 20 students" and "60-minute maximum" — these are *defaults* on the create form; nothing enforces either |
| Subscription | "Next billing: July 1, 2025" — hardcoded, and in the past |
| Discover | "Available" on every teacher card, from `is_online`, which nothing in the app ever writes |
| Discover | An "Online Now Only" filter on the same column — matched nobody, emptied the storefront, then blamed the student |
| Discover | "Top Pick" was `filtered[0]`. With no reviews yet, the platform crowned somebody at random |
| Discover | `0.0` with empty stars for unreviewed teachers, which reads as *badly* rated |
| TeacherCard | Header counted `teachers.length` (capped at the request's own `limit=200`) while the endpoint returned the real total |

**How to check one:** grep the column in `artifacts/api-server/src/` for a write that is not
`auth.ts` (registration). If the only write is registration, it is dead and the UI is lying.

**What to do:** never a fabricated zero. Either wire the real value, or say plainly that it is
not tracked yet. A made-up zero about money is indistinguishable from a real answer, which makes
it the worst placeholder available.

---

## Done

| Screen | Was | Now | Rendered? |
|---|---|---|---|
| `app/(teacher)/index.tsx` | 13 hex, 23 sizes | **0 / 0** | Yes — 390, 834, 1280, no console errors |
| `app/(teacher)/subscription.tsx` | 17 hex, 24 sizes | **0 / 0** | No — Chromium gone from the container |
| `app/(student)/index.tsx` | 13 hex, 29 sizes | **0 / 0** | No |
| `components/TeacherCard.tsx` | 12 hex, 12 sizes | **0 / 0** | No |

Baseline has fallen from **468 hex / 595 sizes** to **413 / 507**.

## Next, in the order I would take them

1. **`app/(student)/teacher/[id].tsx`** — 20 hex, 26 sizes. The teacher's public page and the
   **Book & Pay** screen; the student's money moment, and the natural partner to Discover.
2. **`app/(teacher)/session-create.tsx`** — 8 hex, 14 sizes. Already returns the tier-limit
   402; the refusal deserves a proper design rather than an alert.
3. **`app/welcome.tsx`** — 18 hex, 10 sizes. First impression, and self-contained.
4. **`app/(teacher)/profile.tsx`** / **`app/(student)/profile.tsx`** — small, similar, do together.
5. **`app/(teacher)/monthly.tsx`** — 4 hex, 24 sizes.
6. **The two classrooms** — `(teacher)/classroom/[id].tsx` (108 hex, 31 sizes) and
   `(student)/classroom/[id].tsx` (62, 21), plus `DailyEmbed` (43 + 23 hex). **Leave these for
   last.** They are the biggest by a wide margin, they are where the whiteboard lives, and they
   are the only screens with real responsive work to do — the board must keep its share of the
   width and never be covered on a phone. `useLayout().boardShare` returns 1 / 0.72 / 0.66 for
   exactly this.

---

## Loose ends this work created or uncovered

- **`is_online` is dead.** No screen sets it. Either wire presence to the classroom socket, or
  drop the column. Right now it is dead weight that already produced one broken filter.
- **The app duplicates the tier price table** in `app/(teacher)/subscription.tsx` while the
  server owns it in `lib/tierLimits.ts` and publishes it at `GET /subscription-tiers`. They
  agree today. A price that disagrees is a financial bug.
- **A per-teacher monthly badge costs one server field.** Discover currently fetches
  `GET /monthly/classes` and matches on `teacherId`, which works but pulls every monthly class
  to answer a yes/no. A `hasMonthlyClass` boolean on `/teachers` would be cheaper.
- **Nothing renders in this container any more.** Chromium disappeared mid-session and cannot be
  re-downloaded through the proxy. The owner has accepted CI as the backstop. If you can render,
  do — it caught two real bugs on the dashboard that the typechecker could not: text overflowing
  its tile, and white text on a pale fill.
- **Subject colours were dropped** from `TeacherCard` (8 hardcoded hues). If categorical colour
  is wanted back, it needs a validated categorical palette in the design system, not eight
  arbitrary values.
