import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import type { FloorTone } from "@/utils/classroomFloorUi";

/**
 * The three shapes the classroom floor is built from: a chip, a button, and a count.
 *
 * Kept together because the whole feature is those three repeated, and because the alternative —
 * each screen styling its own — is how the same "Speaking" ends up green in one place and grey in
 * another. Every colour comes from `constants/colors.ts` through `useColors`, and every touch
 * target is at least `HIT_SLOP_MIN`: these are pressed one-handed, on a phone, by somebody halfway
 * through a sentence, and the button next to the one they want ends their turn.
 *
 * ## The colour rules, applied rather than restated
 *
 * DESIGN.md: crimson is identity and LIVE and nothing else; royal blue is every action; burnt rust
 * is destructive and is never the fill of a large button. So a primary control is blue, a
 * destructive one is rust ink on a rust wash with a rust border, and nothing here is crimson —
 * "speaking" is a *state*, and it takes the semantic success colour, not the brand.
 */

export type Emphasis = "primary" | "secondary" | "quiet" | "danger";

/** A small state label: "Hand up", "Speaking", "Turned off". */
export function FloorChipView({
  label,
  tone,
  testID,
}: {
  label: string;
  tone: FloorTone;
  testID?: string;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();

  const paint: Record<FloorTone, { bg: string; ink: string }> = {
    neutral: { bg: colors.muted, ink: colors.mutedForeground },
    waiting: { bg: colors.warnSoft, ink: colors.warn },
    live: { bg: colors.successSoft, ink: colors.success },
    stopped: { bg: colors.destructiveSoft, ink: colors.destructive },
  };
  const { bg, ink } = paint[tone];

  return (
    <View
      testID={testID}
      style={{
        paddingHorizontal: space.xs,
        paddingVertical: space.xxs,
        borderRadius: radius.pill,
        backgroundColor: bg,
        alignSelf: "flex-start",
      }}
    >
      <Text style={[t.caption, { color: ink }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * One control.
 *
 * `spoken` is separate from `label` because "Speak" does not say whether it starts or stops, and a
 * screen reader announces the accessible name rather than the visible one. The same split the
 * Daily and LiveKit embeds already use, from `utils/dailyEmbedUi.ts`.
 */
export function FloorButton({
  label,
  spoken,
  emphasis,
  onPress,
  disabled,
  testID,
  grow,
}: {
  label: string;
  spoken: string;
  emphasis: Emphasis;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
  /** Take a share of any space left over in the row. Never a share of the space it needs. */
  grow?: boolean;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();

  const paint: Record<Emphasis, { bg: string; ink: string; border: string | null }> = {
    primary: { bg: colors.primary, ink: colors.primaryForeground, border: null },
    secondary: { bg: colors.actionSoft, ink: colors.primary, border: null },
    quiet: { bg: "transparent", ink: colors.mutedForeground, border: colors.border },
    // Rust ink on a rust wash, never a filled rust button. See the note above.
    danger: { bg: colors.destructiveSoft, ink: colors.destructive, border: colors.destructive },
  };
  const { bg, ink, border } = paint[emphasis];

  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityState={{ disabled: Boolean(disabled) }}
      activeOpacity={0.7}
      style={{
        minHeight: HIT_SLOP_MIN,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: space.sm,
        paddingVertical: space.xxs,
        borderRadius: radius.sm,
        backgroundColor: bg,
        borderWidth: border ? 1 : 0,
        borderColor: border ?? "transparent",
        opacity: disabled ? 0.5 : 1,
        /**
         * The label decides the width; leftover space is shared afterwards.
         *
         * `flexBasis: 0` was here, which makes every button in a row the same width whatever it
         * says — and on a 390-point phone that turned the teacher's controls into "Let them …",
         * "Take t…", "Came…". A moderation control a teacher cannot read is worse than no control:
         * this app has already had to remove one row of half-buttons for exactly that reason.
         *
         * `auto` means the text is the basis, so a button never shrinks below its own label; the
         * row it sits in wraps instead. `maxWidth` keeps a long label inside a narrow screen, and
         * two lines are allowed rather than an ellipsis, because the whole point is that the words
         * survive.
         */
        flexGrow: grow ? 1 : 0,
        flexShrink: 1,
        flexBasis: "auto",
        maxWidth: "100%",
      }}
    >
      <Text style={[t.caption, { color: ink, textAlign: "center" }]} numberOfLines={2}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * A count with an icon: hands up, people speaking, cameras on.
 *
 * The badge is the teacher's whole peripheral awareness of the class while they are teaching, so
 * it has to be readable without being read — hence an icon, a number, and a colour that changes
 * only when there is something to do.
 */
export function FloorCount({
  icon,
  count,
  label,
  tone,
  testID,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  count: number;
  /** Spoken in full: "3 hands up". A bare number tells a screen-reader user nothing. */
  label: string;
  tone: FloorTone;
  testID?: string;
}) {
  const colors = useColors();
  const { t, numeric, space, radius } = useLayout();

  const paint: Record<FloorTone, { bg: string; ink: string }> = {
    neutral: { bg: colors.muted, ink: colors.mutedForeground },
    waiting: { bg: colors.warnSoft, ink: colors.warn },
    live: { bg: colors.successSoft, ink: colors.success },
    stopped: { bg: colors.destructiveSoft, ink: colors.destructive },
  };
  const { bg, ink } = paint[tone];

  return (
    <View
      testID={testID}
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.xxs,
        paddingHorizontal: space.xs,
        paddingVertical: space.xxs,
        borderRadius: radius.pill,
        backgroundColor: bg,
      }}
    >
      <Feather name={icon} size={14} color={ink} />
      <Text style={[t.caption, numeric, { color: ink }]}>{count}</Text>
    </View>
  );
}

/** Somebody's initials, for a list row that has no picture. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : "")).toUpperCase();
}

export const floorStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  rowWrap: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  grow: { flex: 1, minWidth: 0 },
});
