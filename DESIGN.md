# The Sikshya design system

Agreed with the owner on 27 August 2026. Read this before styling any screen.

The visual proposal, with every swatch and the type scale rendered at real size, is at
`https://claude.ai/code/artifact/c41a1bcb-c253-48f5-99b2-27ccef2cc979`.

---

## Where everything lives

| File | Holds |
|---|---|
| `constants/colors.ts` | Every colour. Read through `useColors()`. |
| `constants/typography.ts` | The nine type steps, the Inter families, `numeric`. |
| `constants/layout.ts` | Spacing, radius, elevation, breakpoints, board share. |
| `hooks/useColors.ts` | Unchanged. Returns the palette plus `radius`. |
| `hooks/useLayout.ts` | The responsive type scale, the tier, the gutter. One call. |
| `scripts/design-lint/` | The check that stops the tokens leaking. |

A screen needs two hooks:

```tsx
const colors = useColors();
const { t, gutter, space, radius, elevation, isWide } = useLayout();

<View style={{ padding: gutter, gap: space.md, backgroundColor: colors.background }}>
  <Text style={[t.title1, { color: colors.foreground }]}>Your classes today</Text>
  <Text style={[t.callout, { color: colors.mutedForeground }]}>Two left this week.</Text>
</View>
```

---

## Colour: crimson is who we are, blue is what you do

**Crimson `#C41E3A` is the brand and a class that is live right now. Nothing else.** It is not
a button. It earns its weight by appearing rarely — when a teacher sees crimson, something is
happening.

**Royal blue `#123C8C` is every action.** Join, Book & Pay, Start, Save, and every link.

The two are the colours of the Nepali flag, used as ink and action rather than decoration.

### Why the split exists

Before it, `primary` was crimson and `destructive` was red — so **the button that took a
student's money and the button that cancelled their class were both red.** On a screen about
money that is not a style problem.

### Destructive is a burnt rust, and never a filled button

`destructive` is `#9A3412`. The obvious choice, `#B3261E`, measures **13° in hue from the brand
crimson** — the same red to anyone looking. This one sits 25° away.

Hue alone is not enough, so there is a rule with it: **a destructive action is text or an
outline, never a filled button.** The filled rust button exists only on the confirmation sheet,
where nothing else is on screen to confuse it with.

### The tokens

Old names are kept and still work, so no screen breaks. New names are aliases where they mean
the same thing.

| Use | Token | Value | Notes |
|---|---|---|---|
| App ground | `background` | `#FBFAF8` | Warm, so the white board reads as brighter |
| Cards, board | `card` / `surface` | `#FFFFFF` | |
| Inputs, wells, skeletons | `muted` / `surfaceSunk` | `#F2F1EC` | |
| Primary text | `foreground` / `ink` / `text` | `#14171A` | 17.99:1 — AAA |
| Secondary text | `mutedForeground` / `inkMuted` | `#5A626B` | 6.19:1 — AA |
| Metadata | `inkFaint` | `#646D78` | 5.25:1 — AA at any size |
| Borders | `border` / `line` | `#E7E4DC` | |
| Visible border | `lineStrong` | `#CFCBC1` | |
| **Every action** | `primary` / `action` | `#123C8C` | 10.24:1 — AAA |
| Action wash | `actionSoft` | `#E9EEF9` | |
| Header/gradient navy | `secondary` | `#1A365D` | A surface, never a button |
| **Brand, and LIVE** | `brand` | `#C41E3A` | 5.84:1 — AA |
| Brand wash | `brandSoft` | `#FBEDEF` | |
| Paid, delivered | `success` | `#10794A` | 5.45:1 — AA |
| Success wash | `successSoft` | `#E4F2EA` | |
| Attention **text** | `warn` | `#8A5A10` | 5.91:1 — AA |
| Attention wash | `warnSoft` | `#FAF0DC` | |
| Saffron **fill** | `accent` | `#F5A623` | **1.9:1 — never text** |
| Cancel, end, refund | `destructive` | `#9A3412` | 7.31:1 — AAA |
| Destructive wash | `destructiveSoft` | `#FBEBE4` | |
| Ink on a dark branded card | `onInverse` | `#FFFFFF` | |
| Secondary ink on the same | `onInverseMuted` | `#AEBDD4` | Measured at both gradient ends |
| Modal / sheet dim | `scrim` | `rgba(0,0,0,.45)` | The one correct alpha |
| Socket up / person online | `online` | `#1FA463` | Was `#22C55E` hardcoded 17× |
| Socket down | `offline` | `#8A929B` | Dot, not text |

### Two things not to do

**Do not use opacity for secondary text.** Use `mutedForeground` or `inkFaint`. Opacity behaves
on a white card and misbehaves everywhere else — 60% ink over a crimson badge is muddy pink, and
over the whiteboard it shifts with whatever the teacher just drew.

**`inkFaint` was `#8A929B` and passed only at large sizes.** Three screens in a row used it
for 11–13px metadata anyway — because quiet small metadata is what a faint ink is *for*. The
value moved rather than the guidance: a token that can only be used where nobody wants to use
it is a trap, not a rule.

**Do not use `accent` as a text colour.** It fails contrast badly. Four screens currently do;
they are being fixed as each is touched. For attention *text*, use `warn`.

### Dark mode is deliberately absent

The owner's decision: the product is a whiteboard, which dictates a light environment, and
light-only keeps the launch fast and the UI consistent. `useColors()` already falls back to
`light` when no `dark` key exists, so adding one later needs no other change — **but do not add
one without asking.**

---

## Typography: nine steps

Inter, already loaded at the root in four weights. The app had **eighteen distinct font sizes**;
these nine replace them.

| Step | Size / line | Weight | Use |
|---|---|---|---|
| `display` | 32 / 38 | Bold | Welcome, empty states |
| `title1` | 24 / 30 | Bold | Screen title |
| `title2` | 20 / 26 | SemiBold | Section header |
| `title3` | 17 / 23 | SemiBold | Card title, a class name |
| `body` | 15 / 22 | Regular | Anything read as prose |
| `bodyStrong` | 15 / 22 | SemiBold | A figure inside a sentence |
| `callout` | 14 / 20 | Regular | List subtitles, helper copy |
| `caption` | 13 / 18 | Medium | Timestamps, counts |
| `overline` | 11 / 14 | SemiBold | Uppercase group labels |

**Always spread `numeric` onto money, counts, durations and clocks:**

```tsx
<Text style={[t.title2, numeric]}>NPR 6,500</Text>
```

Tabular figures make every digit the same width, so a column of prices lines up and a countdown
does not jitter as it ticks. One property, and most of the difference between a finance screen
that looks built and one that looks typed.

### Devanagari

**Inter has no Devanagari coverage**, so Nepali text falls back to another face whatever we do.
On iOS and Android the OS resolves that per glyph and there is nothing to configure. On web there
is no such chain unless we write one — so `family()` emits a real CSS stack on web and a bare
family name on native. A comma-separated family on native silently renders the system default,
which is invisible on a laptop and obvious on a Nepali user's phone.

### Scaling

One multiplier, so there is only ever one ladder to maintain:

| Tier | Width | × | Body |
|---|---|---|---|
| compact | < 600 | 1.00 | 15 |
| medium | 600–1023 | 1.06 | 16 |
| expanded | ≥ 1024 | 1.12 | 17 |

`useLayout()` returns the scale already multiplied. Never scale at the call site — it misses
`lineHeight` and `letterSpacing`, and a headline that keeps its phone tracking at 1.12 loses
exactly the tightness that made it look considered.

---

## Spacing, radius, elevation

**Spacing is 4pt-based**: 4, 8, 12, 16, 20, 24, 32, 40, 48. A value off this list is a mistake,
not a decision. `space.md` (16) is the phone gutter; `useLayout().gutter` gives 16 / 24 / 32 by
tier, and that single change is most of what makes a layout belong on a bigger screen rather
than having been stretched onto one.

**Radius**: 6 chips and inputs · 10 buttons · **14 cards** (kept, it was already the token) · 20
sheets and modals · `pill` for status chips and floating controls.

**Elevation**: `none` · `card` · `sheet` · `modal`. Most of the app is `none` and lets a
one-pixel border separate things — a hairline is one rasterised line, a shadow is a blur pass
per frame. **Never put a shadow on a row inside a scrolling list**; that is the one place it will
visibly cost frames on the phone this app is built for.

---

## Layout: the board keeps the screen

| Tier | Classroom |
|---|---|
| **compact** | One column. Controls float and dismiss; chat and video are sheets **over** the board. Nothing permanently covers it. |
| **medium** | Video docks to a narrow rail. Chat stays a sheet — a third column here squeezes the board below usable. |
| **expanded** | Video and chat share a docked right rail. The board keeps about two thirds. |

`useLayout().boardShare` gives 1 / 0.72 / 0.66. Those are floors, not suggestions.

Anything a finger has to hit is at least `HIT_SLOP_MIN` (44). People miss below that, and miss
more on a bumpy bus.

---

## The check that keeps this real

`constants/colors.ts` existed long before this system and was bypassed **468 times** by hex
written straight into screens. That is how a token file quietly stops being one.

```
pnpm --filter @workspace/sikshya run lint:design          # check
pnpm --filter @workspace/sikshya run lint:design:update   # re-baseline after cleaning a screen
```

It runs in `deploy-web.yml` before the tests, so nothing ships past it.

**It is a ratchet, not a wall.** A check that goes red on 468 pre-existing violations is a check
somebody deletes on the afternoon they need to ship. So every file's current count is recorded in
`scripts/design-lint/baseline.json`, and the run fails only when a file gets **worse**, or when a
new file arrives dirty. Clean a screen, run `lint:design:update`, and its number drops for good.

The end state is a baseline of zero, one screen at a time. Where it stands today:

| File | hex | sizes |
|---|---|---|
| `components/DailyEmbed.tsx` | 43 | 10 |
| `app/welcome.tsx` | 18 | 10 |
| `app/(teacher)/monthly.tsx` | 4 | 24 |
| `components/DailyEmbed.web.tsx` | 23 | 0 |
| `app/(teacher)/session-create.tsx` | 8 | 14 |
| …52 more | | |

If a literal genuinely is not a design decision — a colour inside a third-party embed's own
config — put `design-lint-ignore` on the line and say why. That is the difference between an
exception and a leak.

---

## The four rules

1. **No hex literal outside `constants/`.** Colours come from `useColors()`.
2. **No raw `fontSize`.** Text takes a named step from `useLayout().t`.
3. **No spacing value off the 4pt scale.**
4. **One primary button per screen.** If two things are both the loudest, neither is.
