/**
 * The Sikshya palette.
 *
 * Every colour in the app comes from here. There is a check that enforces it —
 * `pnpm --filter @workspace/sikshya run lint:design` — because this file existed before and was
 * bypassed a hundred times by hex literals written straight into screens, which is how a design
 * system quietly stops being one.
 *
 * ## The idea in one paragraph
 *
 * **Crimson is who Sikshya is. Blue is what you do.** Crimson `#C41E3A` is the brand and it
 * marks a class that is live right now — nothing else. Every action a person takes (Join, Book
 * & Pay, Start, Save) is royal blue. The two are the colours of the Nepali flag, used as ink
 * and action rather than decoration.
 *
 * That split is not a style preference. Before it, `primary` was crimson and `destructive` was
 * red, so the button that took a student's money and the button that cancelled their class were
 * both red. On a screen about money that is a clarity failure.
 *
 * ## Ground is warm, ink is cool
 *
 * The app background is a warm paper white; the text is a cool near-black. Two payoffs: a
 * neutral palette that reads chosen rather than defaulted, and — because the whiteboard is pure
 * white — **the board always sits forward as the brightest surface in the app.**
 *
 * ## Secondary text is a colour, not an opacity
 *
 * There are three solid ink tokens instead of one ink at three opacities. Opacity behaves on a
 * white card and misbehaves everywhere else: 60% ink over a crimson badge is muddy pink, and
 * over the whiteboard it shifts with whatever the teacher just drew. Three tokens give the same
 * hierarchy with no surprises, and one less layer for a cheap GPU to composite.
 *
 * ## Dark mode is deliberately absent
 *
 * The owner's decision, 27 Aug 2026: the product is a whiteboard, which dictates a light
 * environment, and light-only keeps the launch fast and the UI consistent. `useColors()` already
 * falls back to `light` when no `dark` key exists, so adding one later needs no other change —
 * but do not add one without asking.
 *
 * ## Contrast
 *
 * Every value below was measured against the surface it sits on, not eyeballed. Ratios are in
 * the comments. Anything marked *fill only* fails as text and must never be used for one.
 */

const colors = {
  light: {
    /* ---------------------------------------------------------------
     * GROUND — the surfaces everything else sits on
     * ------------------------------------------------------------- */

    /** The app behind everything. Warm, so the board reads as brighter than the app. */
    background: "#FBFAF8",
    /** Cards, sheets, and the whiteboard itself. The brightest surface. */
    card: "#FFFFFF",
    /** Alias of `card`, for code that reads better saying "surface". */
    surface: "#FFFFFF",
    /** Inputs, wells, skeleton loaders, disabled fills. */
    muted: "#F2F1EC",
    /** Alias of `muted`. */
    surfaceSunk: "#F2F1EC",

    /* ---------------------------------------------------------------
     * INK — text, in three weights of emphasis
     * ------------------------------------------------------------- */

    /** Primary text. 17.99:1 on white — AAA. */
    foreground: "#14171A",
    /** Alias of `foreground`. */
    ink: "#14171A",
    /** Alias again; some older screens reach for `text`. */
    text: "#14171A",
    /** Text on a card. Same ink; named separately because some components ask that way. */
    cardForeground: "#14171A",
    /** Secondary text — subtitles, list detail, helper copy. 6.19:1 — AA. */
    mutedForeground: "#5A626B",
    /** Alias of `mutedForeground`. */
    inkMuted: "#5A626B",
    /**
     * Metadata, timestamps, placeholders — the third tier below `mutedForeground`.
     *
     * It was `#8A929B`, which measures 3.15:1 on white: legible only at large sizes, and
     * documented as such. That did not survive contact with real screens. Every use it found
     * was small — a timestamp, a seat count, an uppercase label at 11px — because small quiet
     * metadata is exactly what a faint ink is *for*, and three screens in a row reached for it
     * that way, including the ones written by whoever wrote the warning.
     *
     * A token that can only be used where nobody wants to use it is a trap rather than a rule,
     * so the value moved instead of the guidance. **5.25:1 on a card, 5.03:1 on the app ground,
     * 4.64:1 on a sunk surface** — AA on all three, at any size, while staying visibly lighter
     * than `mutedForeground`.
     */
    inkFaint: "#646D78",

    /* ---------------------------------------------------------------
     * STRUCTURE — the lines that do most of the work
     * ------------------------------------------------------------- */

    /** Hairline borders. Most of the app is flat and separated by these, not by shadows. */
    border: "#E7E4DC",
    /** Alias of `border`. */
    line: "#E7E4DC",
    /** A border that needs to be seen — a secondary button, a focused input. */
    lineStrong: "#CFCBC1",
    /** Input borders. Same hairline. */
    input: "#E7E4DC",

    /* ---------------------------------------------------------------
     * ACTION — what a person does. Royal blue, and only blue.
     * ------------------------------------------------------------- */

    /**
     * Every primary button and every link. 10.24:1 with white on it — AAA.
     *
     * This was crimson until 27 Aug 2026. If you are looking at a screen where blue feels wrong
     * because the thing is *about* Sikshya rather than *doing* something, you want `brand`.
     */
    primary: "#123C8C",
    /** Alias of `primary`, for code that reads better saying "action". */
    action: "#123C8C",
    /** Text and icons on top of a filled `primary` button. */
    primaryForeground: "#FFFFFF",
    /** A wash of action blue — selected rows, informational banners, focus rings at low alpha. */
    actionSoft: "#E9EEF9",
    /** Expo's convention key for tab bars and links. Same as `primary`. */
    tint: "#123C8C",

    /**
     * The deep navy already used behind headers and the subscription card gradient.
     *
     * Kept as it was. It is a sibling of the action blue rather than a competitor: navy is a
     * *surface* here, never a button.
     */
    secondary: "#1A365D",
    secondaryForeground: "#FFFFFF",

    /* ---------------------------------------------------------------
     * BRAND — Sikshya itself, and a class that is happening now
     * ------------------------------------------------------------- */

    /**
     * Crimson. The logo, and a live class. **Not a button.**
     *
     * 5.84:1 with white on it — AA. It earns its weight by appearing rarely: when a teacher
     * sees crimson, something is happening.
     */
    brand: "#C41E3A",
    /** The crimson wash behind a LIVE chip. */
    brandSoft: "#FBEDEF",
    /** Text and icons on filled crimson. */
    brandForeground: "#FFFFFF",

    /* ---------------------------------------------------------------
     * MEANING — paid, attention, danger, connected
     * ------------------------------------------------------------- */

    /** Paid, attended, delivered, refund sent. 5.45:1 — AA. */
    success: "#10794A",
    successForeground: "#FFFFFF",
    /** The wash behind a "Paid" chip. */
    successSoft: "#E4F2EA",

    /**
     * Attention, not danger: plan limit approaching, grace period running, refund pending.
     * 5.91:1 — AA, so this one is safe as text. `accent` below is not.
     */
    warn: "#8A5A10",
    /** The wash behind an attention banner. */
    warnSoft: "#FAF0DC",

    /**
     * Saffron. **Fill only — 1.9:1 on white.**
     *
     * It fails as text and is currently used as text in four places, which is a pre-existing
     * contrast bug being fixed screen by screen. When you need attention *text*, use `warn`.
     * Kept at its original value so those four screens do not silently change before anybody
     * has looked at them.
     */
    accent: "#F5A623",
    accentForeground: "#1A1A1A",

    /**
     * Cancel, end, refund, delete. A burnt rust rather than a red.
     *
     * The obvious choice, `#B3261E`, measures **13° in hue from the brand crimson** — the same
     * red to any human eye, which is exactly the confusion this palette exists to remove. This
     * sits 25° away and reads as a different thing at a glance. 7.31:1 — AAA.
     *
     * Hue alone is not enough, so there is a rule with it: **a destructive action is never a
     * filled button.** It is text or an outline. The filled rust button exists only on the
     * confirmation sheet, where nothing else is on screen to confuse it with.
     */
    destructive: "#9A3412",
    destructiveForeground: "#FFFFFF",
    /** The wash behind a destructive banner. */
    destructiveSoft: "#FBEBE4",

    /**
     * A live connection — the socket is up, the other person is online.
     *
     * Its own token because it is its own idea. This was `#22C55E` hardcoded in seventeen
     * places; presence is not the same claim as "paid", so it does not borrow `success`.
     * 3.36:1 — a dot or a fill, not body text.
     */
    online: "#1FA463",
    /** The socket is down or reconnecting. */
    offline: "#8A929B",

    /* ---------------------------------------------------------------
     * INVERSE — ink for the dark branded surfaces
     * ------------------------------------------------------------- */

    /**
     * Text on a dark branded surface — the navy stats card, a filled crimson chip, a photo.
     *
     * Its own token rather than a literal white, because these surfaces paint their own ground
     * and every screen that has one would otherwise invent its own answer.
     */
    onInverse: "#FFFFFF",
    /**
     * Secondary text on those same surfaces. A pale blue-grey, **not white at reduced opacity.**
     *
     * The rule holds here for the same reason it holds everywhere: an alpha value over a
     * gradient lands on a different colour at each end, so it can pass contrast on one side of a
     * card and fail on the other. This is measured against both ends of the navy-to-blue
     * gradient — 6.38:1 on `secondary` and 5.38:1 on `primary`, AA at each.
     */
    onInverseMuted: "#AEBDD4",

    /**
     * The dim behind a modal or a bottom sheet.
     *
     * The one place an alpha is correct rather than a shortcut: a scrim exists *to* let the
     * screen behind show through dimmed, so translucency is the point rather than a way of
     * avoiding a second colour. A token so that every sheet in the app dims by the same amount —
     * they were each choosing their own.
     */
    scrim: "rgba(0,0,0,0.45)",
  },

  /**
   * The card radius, kept at 14 because it already was.
   *
   * The full radius scale lives in `constants/layout.ts`; this key stays so `useColors()`
   * keeps returning what every existing screen expects.
   */
  radius: 14,
};

export default colors;
