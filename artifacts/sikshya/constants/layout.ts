import { Platform, type ViewStyle } from "react-native";

/**
 * Spacing, radius, elevation and breakpoints.
 *
 * Everything here exists so that a value in a screen is a *choice from a list* rather than a
 * number somebody typed. The app had ten distinct corner radii against one token and no spacing
 * scale at all, which is why it reads as slightly uneven without anyone being able to say where.
 */

/* ================================================================
 * SPACING — 4pt base
 * ============================================================== */

/**
 * Nine steps. A value not on this list is a mistake rather than a decision.
 *
 * `md` (16) is the default gutter on a phone. On a tablet and a laptop it rises — see
 * `gutterFor()` — and that single change is most of what makes a layout look like it belongs on
 * a bigger screen rather than having been stretched onto one.
 */
export const space = {
  /** Hairline gaps: between an icon and its label. */
  xxs: 4,
  /** Inside a chip, between tightly related items. */
  xs: 8,
  /** Between a title and its subtitle. */
  sm: 12,
  /** The default: card padding, gap between cards, screen gutter on a phone. */
  md: 16,
  /** A roomier card, or the gap between groups within a section. */
  lg: 20,
  /** Between sections. Screen gutter on a tablet. */
  xl: 24,
  /** Between major blocks. Screen gutter on a laptop. */
  xxl: 32,
  /** Above a screen title, below the last card. */
  xxxl: 40,
  /** Empty states, welcome screens — space used as emphasis. */
  huge: 48,
} as const;

/* ================================================================
 * RADIUS — five steps
 * ============================================================== */

export const radius = {
  /** Chips, inputs, small tags. */
  xs: 6,
  /** Buttons. */
  sm: 10,
  /** Cards. Kept at 14 because it already was the token and the app's second most-used value. */
  md: 14,
  /** Bottom sheets, modals, the large surfaces a card sits on. */
  lg: 20,
  /** Status chips, floating controls, avatars. */
  pill: 999,
} as const;

/* ================================================================
 * ELEVATION — three levels, all cheap
 * ============================================================== */

/**
 * Most of the app sits at level 0 and lets a one-pixel border do the separating.
 *
 * That is a performance decision as much as a visual one: a hairline is a single rasterised
 * line, and a shadow is a blur pass the GPU repeats every frame the view moves. On Android these
 * map to `elevation`, which the compositor handles almost for free; on iOS and web they are a
 * small-radius shadow, which is not free.
 *
 * **Never put one on a row inside a scrolling list.** That is the single place a shadow will
 * visibly cost frames on the phone this app is built for, and a border does the job.
 */
function shadow(
  elevation: number,
  opacity: number,
  radiusPx: number,
  offsetY: number,
): ViewStyle {
  // Android composites `elevation` natively and ignores the rest; iOS and web do the reverse.
  // Both sets live in one object because each platform quietly drops what it does not use.
  return Platform.select<ViewStyle>({
    android: { elevation },
    default: {
      shadowColor: "#14171A",
      shadowOpacity: opacity,
      shadowRadius: radiusPx,
      shadowOffset: { width: 0, height: offsetY },
    },
  })!;
}

export const elevation = {
  /** Flat. The default. A border separates it from what is behind. */
  none: {} as ViewStyle,
  /** A card lifted off the ground just enough to read as a card. */
  card: shadow(1, 0.05, 3, 1),
  /** A bottom sheet, a dropdown, a floating control pill. */
  sheet: shadow(3, 0.1, 12, 4),
  /** A modal over a dimmed screen. The only place a heavy shadow is earned. */
  modal: shadow(6, 0.18, 28, 10),
} as const;

/* ================================================================
 * BREAKPOINTS
 * ============================================================== */

/**
 * Three tiers, matching how the classroom has to behave rather than any device's spec sheet:
 *
 * - **compact** — one column. Controls float, chat and video are sheets *over* the board, and
 *   nothing permanently covers it.
 * - **medium** — video docks to a narrow rail. Chat stays a sheet, because a third column here
 *   would squeeze the board below usable.
 * - **expanded** — video and chat share a docked right rail, and the board still keeps about
 *   two thirds of the width.
 */
export const breakpoint = {
  medium: 600,
  expanded: 1024,
} as const;

export type Tier = "compact" | "medium" | "expanded";

export function tierFor(width: number): Tier {
  if (width >= breakpoint.expanded) return "expanded";
  if (width >= breakpoint.medium) return "medium";
  return "compact";
}

/** How much the type scale grows per tier. */
export const typeMultiplier: Record<Tier, number> = {
  compact: 1,
  medium: 1.06,
  expanded: 1.12,
};

/** The screen's outer padding per tier. */
export const gutterFor: Record<Tier, number> = {
  compact: space.md,
  medium: space.xl,
  expanded: space.xxl,
};

/**
 * How much of the classroom the whiteboard keeps.
 *
 * The board is the product. These are floors, not suggestions: whatever else is on screen, the
 * board gets at least this share of the width, and on a phone it gets all of it because the
 * other panels are sheets rather than columns.
 */
export const boardShare: Record<Tier, number> = {
  compact: 1,
  medium: 0.72,
  expanded: 0.66,
};

/** Anything a finger has to hit. Below this, people miss — and miss more on a bumpy bus. */
export const HIT_SLOP_MIN = 44;
