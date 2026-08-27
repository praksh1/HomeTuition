import { Platform, type TextStyle } from "react-native";

/**
 * The Sikshya type scale.
 *
 * Nine named steps, replacing the eighteen distinct font sizes the app had grown — 9, 10, 11,
 * 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 28, 30, 32, 38. That was not a scale, it was a
 * sequence of individual decisions, and the result reads as slightly-off rather than as wrong,
 * which is worse: nobody can point at it.
 *
 * ## Inter stays
 *
 * It is already loaded at the root in four weights, already paid for in bytes, and is genuinely
 * a screen typeface — drawn for interfaces, with figures that line up in columns and enough
 * contrast to survive 11px on a cheap panel. The work was never choosing a font. It was getting
 * the fifteen screens that ignore it to use the one the app already ships, so that the app stops
 * rendering in two typefaces.
 *
 * ## Devanagari
 *
 * **Inter has no Devanagari coverage**, so every Nepali string falls back to another face
 * whatever we do. On iOS and Android the OS resolves that itself, per glyph, and there is
 * nothing to configure. On web there is no such chain unless we write one — so `family()` below
 * emits a real CSS stack there and a bare family name on native. Getting this wrong is invisible
 * on a developer's laptop and obvious on a Nepali user's phone.
 *
 * ## Sizes are in points, tracking in points
 *
 * React Native's `letterSpacing` is absolute, not em-relative like CSS. The values below are
 * already converted, which is why they look small.
 */

type Weight = "regular" | "medium" | "semibold" | "bold";

const INTER: Record<Weight, string> = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
};

/**
 * The font family string for a weight, with a Devanagari fallback where the platform supports
 * one.
 *
 * A comma-separated stack is valid CSS and **invalid on native** — React Native looks for a
 * font literally named "Inter_400Regular, Noto Sans Devanagari", finds nothing, and silently
 * renders the system default. Hence the platform split.
 */
export function family(weight: Weight = "regular"): string {
  const inter = INTER[weight];
  if (Platform.OS !== "web") return inter;
  return `${inter}, "Noto Sans Devanagari", "Mangal", ui-sans-serif, system-ui, sans-serif`;
}

export interface TypeStep {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
}

/** The scale at phone size. Everything else is this, multiplied. */
function buildScale(mult: number) {
  const px = (n: number) => Math.round(n * mult);

  const step = (
    weight: Weight,
    fontSize: number,
    lineHeight: number,
    letterSpacing = 0,
  ): TypeStep => ({
    fontFamily: family(weight),
    fontSize: px(fontSize),
    lineHeight: px(lineHeight),
    // Tracking scales with the type, or a headline set at 1.12 loses its tightness.
    letterSpacing: Math.round(letterSpacing * mult * 100) / 100,
  });

  return {
    /** Welcome, empty states, the one number on a screen that matters most. */
    display: step("bold", 32, 38, -0.5),
    /** A screen title. */
    title1: step("bold", 24, 30, -0.4),
    /** A section header inside a screen. */
    title2: step("semibold", 20, 26, -0.3),
    /** A card title — a class name, a person's name. */
    title3: step("semibold", 17, 23, -0.2),
    /** Reading text. The default for anything a person has to actually read. */
    body: step("regular", 15, 22),
    /** Body with emphasis — a figure inside a sentence, an answer to a question. */
    bodyStrong: step("semibold", 15, 22),
    /** Secondary text: list subtitles, helper copy, the second line of a card. */
    callout: step("regular", 14, 20),
    /** Metadata: timestamps, counts, "3 seats left". */
    caption: step("medium", 13, 18),
    /**
     * Uppercase labels above a group. Tracking is positive because uppercase letterforms
     * need air; without it they read as a single block.
     */
    overline: {
      ...step("semibold", 11, 14, 0.8),
      textTransform: "uppercase" as const,
    },
  };
}

/** The phone-sized scale. Use `useType()` from `hooks/useLayout` to get the responsive one. */
export const type = buildScale(1);

export type TypeScale = ReturnType<typeof buildScale>;
export type TypeToken = keyof TypeScale;

/** Internal — the responsive hook builds through this. */
export const scaleAt = buildScale;

/**
 * Figures that line up in a column.
 *
 * Spread onto any text showing money, a countdown, a duration or a count:
 *
 * ```ts
 * <Text style={[t.title2, numeric]}>NPR 6,500</Text>
 * ```
 *
 * Proportional digits are set to look even in a word; tabular digits are set to the same width
 * so a column of prices aligns and a ticking clock does not jitter as the digits change. It is
 * one property, and it is most of the difference between a finance screen that looks built and
 * one that looks typed.
 */
export const numeric: TextStyle = {
  fontVariant: ["tabular-nums"],
};
