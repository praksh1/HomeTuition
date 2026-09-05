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
| Teacher profile + TeacherCard | `totalStudents` was labelled "students", but the server increments it for every paid enrollment. It is a cumulative paid-booking count, not a unique-person count |
| Teacher profile | `sessionsThisMonth` was the same registration-only zero already removed from the dashboard |
| Teacher profile | "Sessions Hosted" summed only the first API page (at most 20 sessions per status), then presented the partial count as a lifetime total |
| Teacher profile | An unreviewed teacher showed `0.0`, and a free follow action was labelled "Subscribe" beside a separate paid monthly product |
| Teacher profile | A hidden payment-sheet fallback turned a missing class price into `NPR 0`; the sheet is now rendered only when a real selected session exists |
| Operator person screen | "They have been told." — asserted after a fire-and-forget email whose result was thrown away. With no mail provider configured, nothing was sent and the operator was told it had been |
| Operator decisions (server) | "Your citizenship was approved." — Sikshya accepted a copy of a document for its own check. It does not approve citizenship and has no standing to say so |
| Operator decisions (server) | "Your teaching credentials have been approved. You can schedule classes now." — announced a *document* outcome for an *account* decision, and an approved teacher still cannot schedule anything without a teaching plan |
| Operator decisions (server) | "They were not connected, so they will see it when they next open the app." — mine, not inherited. There is no server-side notification store, so an offline teacher receives nothing then *or later*. Written by the same pass that had just documented why that is false; caught by Codex, not by me |
| Teacher login | Named `ram@example.com`, `sunita@example.com`, and "any email" as demo sign-ins although the accounts do not exist in isolated staging and arbitrary email cannot authenticate |
| Session proof (worklog) | "Daily cannot tell us which account joined" — mine. True only because token minting omitted `user_id`, which I had scoped out myself and then recorded as a property of Daily. Repeated in four code comments and presented as the finding the whole design followed from |
| Session proof (worklog) | "Adding a `user_id` claim is a one-line change, deliberately not made, since altering a working token path was not in scope." — mine. It *was* in scope: without it the provider corroboration could say nothing about a person, which is the only thing a refund argument asks |
| Session proof (server) | The Daily webhook verifier — mine. Not a false sentence but the same defect in code: a confident implementation of a signing scheme nobody had checked, whose tests agreed with it because they were written from it. Four independent departures from Daily's contract, each individually fatal, all green |

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
| `app/(student)/teacher/[id].tsx` | 20 hex, 26 sizes | **0 / 0** | No — local Metro never completed its first web bundle |
| `app/(teacher)/classroom/[id].tsx` | 108 hex, 31 sizes | **0 / 0** | Yes — owner verified whiteboard touch propagation and PIP dragging |
| `app/(student)/classroom/[id].tsx` | 62 hex, 21 sizes | **0 / 0** | No — awaiting student-side touch verification |
| `app/welcome.tsx` | 18 hex, 10 sizes | **0 / 0** | Not yet — implementation and automated checks passed; bundle rebuild deliberately batched with the next reviewed slice |

Baseline has fallen from **468 hex / 595 sizes** to **205 / 419**.

## Next, in the order I would take them

Reordered 2 Sep 2026. `welcome.tsx` was second and is now first: it is the only remaining screen
whose fabrication is **already live on the public front door**, and the production smoke check on
2026-08-29 exposed it. Everything below it is a logged-in screen.

1. **`app/(teacher)/session-create.tsx`** — 8 hex, 14 sizes. Already returns the tier-limit
   402; the refusal deserves a proper design rather than an alert. It is the moment a teacher
   hits the paywall, so it is also the best upsell surface in the app — `GET /teachers/me/allowance`
   already returns what the next tier up would allow.
2. **`app/(teacher)/profile.tsx`** (6 hex, 16 sizes) / **`app/(student)/profile.tsx`** (7 hex,
   15 sizes) — small, similar, do together.
3. **`app/(teacher)/monthly.tsx`** — 4 hex, 24 sizes.
4. **Shared video embeds, only after the student touch test passes** — `components/DailyEmbed.tsx`
   (43 hex, 10 sizes) and `components/DailyEmbed.web.tsx` (23 hex). Keep provider behavior and
   bandwidth strategy fixed; this is a token/accessibility pass, not a video rewrite.

---

## Loose ends this work created or uncovered

- **The welcome fabrication was removed on staging integration.** The `5,000+ Teachers`,
  `50,000+ Students`, and `77 Districts` band was cut rather than replaced with another invented
  statistic. It is not a production claim until the owner reviews and later approves deployment.
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
- **`totalStudents` is not a unique-student metric.** It increments once per paid enrollment.
  The UI now calls it "paid bookings"; renaming or replacing the database field is server work
  and was deliberately left outside this UI-only pass.
- **Teacher PIP controls still belong to the video provider.** Native mic/camera/share/leave and
  web Daily Prebuilt controls remain inside the PIP. Moving them into the classroom HUD requires
  a provider-level imperative control contract and must not be faked with non-working buttons.
