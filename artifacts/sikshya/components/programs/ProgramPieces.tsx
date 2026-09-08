import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import type { ProgramTone } from "@/utils/learningProgramUi";

/**
 * The small parts the program screens share.
 *
 * Kept together because they are the vocabulary rather than the content: a chip, a button, a
 * section heading, an empty state. Three screens drawing their own version of each is three places
 * a tone means something slightly different, and the design system exists precisely so that it
 * means one thing.
 *
 * Every colour comes from `useColors()` and every size from `useLayout().t`. Nothing here writes a
 * hex value or a `fontSize`; `lint:design` is what keeps that true.
 */

/** A tone is a role, and this is the one place it becomes a colour. */
export function toneColours(tone: ProgramTone, colors: ReturnType<typeof useColors>) {
  switch (tone) {
    case "live":
      return { bg: colors.successSoft, ink: colors.success };
    case "waiting":
      return { bg: colors.warnSoft, ink: colors.warn };
    case "stopped":
      return { bg: colors.destructiveSoft, ink: colors.destructive };
    case "neutral":
    default:
      return { bg: colors.muted, ink: colors.mutedForeground };
  }
}

export function ProgramChip({
  label,
  tone = "neutral",
  testID,
}: {
  label: string;
  tone?: ProgramTone;
  testID?: string;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const { bg, ink } = toneColours(tone, colors);
  return (
    <View
      testID={testID}
      style={{
        alignSelf: "flex-start",
        backgroundColor: bg,
        borderRadius: radius.pill,
        paddingHorizontal: space.xs,
        paddingVertical: space.xxs,
      }}
    >
      <Text style={[t.caption, { color: ink }]}>{label}</Text>
    </View>
  );
}

/** A consistent, thumb-sized way back from both program setup screens. */
export function ProgramBackControl({
  onPress,
  testID,
  label = "Back to Programs",
  accessibilityLabel = label,
}: {
  onPress: () => void;
  testID: string;
  label?: string;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        minHeight: HIT_SLOP_MIN,
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: space.xxs,
        paddingHorizontal: space.xs,
        borderRadius: radius.sm,
      }}
    >
      <Feather name="arrow-left" size={space.lg} color={colors.primary} />
      <Text style={[t.bodyStrong, { color: colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A button, in the four weights this feature uses.
 *
 * `danger` is text on a wash and never a filled rust button — DESIGN.md's rule, and the reason is
 * that the filled one exists only on a confirmation sheet where nothing else is on screen to
 * confuse it with. Minimum height is `HIT_SLOP_MIN`, which is 44, because people miss below that
 * and miss more on a bumpy bus.
 */
export function ProgramButton({
  label,
  onPress,
  emphasis = "secondary",
  disabled = false,
  busy = false,
  grow = false,
  icon,
  spoken,
  testID,
}: {
  label: string;
  onPress: () => void;
  emphasis?: "primary" | "secondary" | "quiet" | "danger";
  disabled?: boolean;
  busy?: boolean;
  grow?: boolean;
  icon?: React.ComponentProps<typeof Feather>["name"];
  /** The whole sentence, for a screen reader. "Archive" alone does not say what happens. */
  spoken?: string;
  testID?: string;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();

  const look = {
    primary: { bg: colors.primary, ink: colors.onInverse, border: "transparent" },
    secondary: { bg: colors.card, ink: colors.primary, border: colors.primary },
    quiet: { bg: colors.card, ink: colors.mutedForeground, border: colors.border },
    danger: { bg: colors.destructiveSoft, ink: colors.destructive, border: colors.destructiveSoft },
  }[emphasis];

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={spoken ?? label}
      // Both spellings: React Native reads `accessibilityState`, React Native Web 0.21 reads the
      // `aria-*` props and ignores it entirely. Only one of them is a lie on either platform.
      accessibilityState={{ disabled: disabled || busy, busy }}
      aria-disabled={disabled || busy}
      aria-busy={busy}
      style={{
        flexGrow: grow ? 1 : 0,
        // `auto` rather than 0: a shared basis of zero made every label the same width whatever it
        // said, and on a 390pt phone a row of three read "Take t…", "Arch…", "Del…".
        flexBasis: "auto",
        minHeight: HIT_SLOP_MIN,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: space.xs,
        paddingHorizontal: space.md,
        paddingVertical: space.xs,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: look.border,
        backgroundColor: look.bg,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {busy ? <ActivityIndicator size="small" color={look.ink} /> : null}
      {!busy && icon ? <Feather name={icon} size={16} color={look.ink} /> : null}
      <Text style={[t.bodyStrong, { color: look.ink, textAlign: "center" }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A section heading with an optional count of things needing attention beside it. */
export function SectionHeading({
  title,
  blurb,
  issues = 0,
  stale = false,
  testID,
}: {
  title: string;
  blurb?: string | null;
  issues?: number;
  /**
   * True when the count describes the last *saved* draft rather than what is on screen.
   *
   * The count then says so — "1 at your last save" — instead of "1 to finish", which is a claim
   * about text the server has not seen. A number presented as current when it is not is how a
   * teacher ends up fixing something twice or not at all.
   */
  stale?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  const { t, space } = useLayout();
  return (
    <View testID={testID} style={{ gap: space.xxs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Text style={[t.title2, { color: colors.foreground, flexShrink: 1 }]}>{title}</Text>
        {issues > 0 ? (
          <ProgramChip
            testID={testID ? `${testID}-issues` : undefined}
            label={
              stale
                ? `${issues} at your last save`
                : issues === 1
                  ? "1 to finish"
                  : `${issues} to finish`
            }
            tone={stale ? "neutral" : "waiting"}
          />
        ) : null}
      </View>
      {blurb ? <Text style={[t.callout, { color: colors.mutedForeground }]}>{blurb}</Text> : null}
    </View>
  );
}

/**
 * A card, which is where nearly everything in this feature lives.
 *
 * A hairline border rather than a shadow: DESIGN.md says most of the app is elevation `none` and
 * lets one rasterised line separate things, because a blur pass per frame is what a budget Android
 * cannot afford — and these cards sit inside a scrolling list, which is the one place the cost is
 * visible.
 */
export function ProgramCardShell({
  children,
  onPress,
  testID,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  const { space, radius } = useLayout();
  const style = {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  } as const;

  if (!onPress) return <View testID={testID} style={style}>{children}</View>;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={style}
    >
      {children}
    </Pressable>
  );
}

/**
 * Something did not load, said plainly with a way to try again.
 *
 * Deliberately not an empty state. `.agents/backlog/ui-upgrade-progress.md`: "Loading, empty and
 * failed are three different pictures, never one placeholder" — a failed load drawn as "no programs
 * yet" tells a teacher their work is gone.
 */
export function ProgramFailure({
  message,
  onRetry,
  testID = "program-failure",
}: {
  message: string;
  onRetry: () => void;
  testID?: string;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={{
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Feather name="alert-circle" size={18} color={colors.warn} />
        <Text style={[t.title3, { color: colors.foreground, flexShrink: 1 }]}>
          Your programs could not be loaded
        </Text>
      </View>
      <Text style={[t.callout, { color: colors.mutedForeground }]}>{message}</Text>
      <ProgramButton label="Try again" icon="refresh-cw" onPress={onRetry} testID={`${testID}-retry`} />
    </View>
  );
}

/** The one banner shape this feature uses for "here is something you need to know". */
export function ProgramNotice({
  title,
  body,
  tone = "waiting",
  icon = "info",
  testID,
  children,
}: {
  title: string;
  body?: string | null;
  tone?: ProgramTone;
  icon?: React.ComponentProps<typeof Feather>["name"];
  testID?: string;
  children?: React.ReactNode;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const { bg, ink } = toneColours(tone, colors);
  return (
    <View
      testID={testID}
      accessibilityRole="summary"
      style={{ gap: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: bg }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.xs }}>
        <Feather name={icon} size={18} color={ink} />
        <Text style={[t.bodyStrong, { color: colors.foreground, flexShrink: 1 }]}>{title}</Text>
      </View>
      {body ? <Text style={[t.callout, { color: colors.mutedForeground }]}>{body}</Text> : null}
      {children}
    </View>
  );
}
