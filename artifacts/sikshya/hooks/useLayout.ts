import { useMemo } from "react";
import { useWindowDimensions } from "react-native";

import {
  boardShare,
  elevation,
  gutterFor,
  radius,
  space,
  tierFor,
  typeMultiplier,
  type Tier,
} from "@/constants/layout";
import { numeric, scaleAt, type TypeScale } from "@/constants/typography";

/**
 * Everything a screen needs to lay itself out at the size it is actually being shown at.
 *
 * One hook rather than four, because a screen that has to call `useWindowDimensions`,
 * `useTypeScale`, `useGutter` and `useTier` separately will call three of them and forget the
 * fourth. This returns them already agreeing with each other.
 *
 * ```tsx
 * const { t, gutter, isExpanded, space, radius, elevation } = useLayout();
 *
 * <View style={{ padding: gutter, gap: space.md }}>
 *   <Text style={t.title1}>Your classes today</Text>
 *   <Text style={[t.body, { color: colors.mutedForeground }]}>Two left this week.</Text>
 * </View>
 * ```
 *
 * ## Why the type scale is rebuilt rather than multiplied at the call site
 *
 * Scaling at the call site — `fontSize: t.body.fontSize * mult` — misses `lineHeight` and
 * `letterSpacing` almost every time, and a headline that keeps its phone tracking at 1.12 loses
 * exactly the tightness that made it look considered. Rebuilding the whole step keeps the three
 * numbers in proportion, and it is memoised on the multiplier, so it recomputes on a rotation or
 * a window resize and never on a re-render.
 */
export interface Layout {
  /** The responsive type scale. Short name because it is used on nearly every line. */
  t: TypeScale;
  /** Spread onto any text showing money, a count, or a clock. */
  numeric: typeof numeric;

  /** Which of the three layout tiers this screen is being shown at. */
  tier: Tier;
  isCompact: boolean;
  isMedium: boolean;
  isExpanded: boolean;
  /** True from `medium` up — the usual test for "is there room for a second column?". */
  isWide: boolean;

  /** The screen's outer padding at this size. */
  gutter: number;
  /**
   * The share of the width the whiteboard keeps. 1 on a phone, where the other panels are
   * sheets over the board rather than columns beside it.
   */
  boardShare: number;

  width: number;
  height: number;
  /** True when the window is wider than it is tall — a phone in a teacher's hand, sideways. */
  isLandscape: boolean;

  space: typeof space;
  radius: typeof radius;
  elevation: typeof elevation;
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const tier = tierFor(width);
  const mult = typeMultiplier[tier];

  const t = useMemo(() => scaleAt(mult), [mult]);

  return {
    t,
    numeric,
    tier,
    isCompact: tier === "compact",
    isMedium: tier === "medium",
    isExpanded: tier === "expanded",
    isWide: tier !== "compact",
    gutter: gutterFor[tier],
    boardShare: boardShare[tier],
    width,
    height,
    isLandscape: width > height,
    space,
    radius,
    elevation,
  };
}
