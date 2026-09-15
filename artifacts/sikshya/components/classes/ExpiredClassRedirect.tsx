import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { HIT_SLOP_MIN, readingWidth } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

export const EXPIRED_CLASS_REDIRECT_SECONDS = 10;

interface Props {
  message?: string | null;
  onDashboard: () => void;
}

/**
 * A Fadko-owned ending for a stale classroom link.
 *
 * The video provider must never be the first thing that explains an expired lesson. Apart from
 * looking broken, a provider error cannot offer the user a reliable way home. This screen is
 * deliberately outside the video frame and is rendered before VideoCall is ever mounted.
 */
export function ExpiredClassRedirect({ message, onDashboard }: Props) {
  const colors = useColors();
  const { t, numeric, space, radius, elevation } = useLayout();
  const [seconds, setSeconds] = useState(EXPIRED_CLASS_REDIRECT_SECONDS);
  const redirected = useRef(false);

  useEffect(() => {
    if (seconds <= 0) {
      if (!redirected.current) {
        redirected.current = true;
        onDashboard();
      }
      return;
    }
    const timer = setTimeout(() => setSeconds((current) => Math.max(0, current - 1)), 1000);
    return () => clearTimeout(timer);
  }, [onDashboard, seconds]);

  return (
    <View
      style={[styles.screen, { paddingHorizontal: space.lg, backgroundColor: colors.background }]}
      testID="expired-class-redirect"
      accessibilityRole="alert"
    >
      <View
        style={[
          styles.card,
          elevation.sheet,
          {
            width: "100%",
            maxWidth: readingWidth,
            gap: space.md,
            padding: space.xl,
            borderRadius: radius.lg,
            borderColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      >
        <View style={[styles.icon, { borderRadius: radius.pill, backgroundColor: colors.warnSoft }]}>
          <Feather name="clock" size={26} color={colors.warn} />
        </View>
        <View style={{ gap: space.xs }}>
          <Text style={[t.title2, styles.center, { color: colors.foreground }]}>This class has ended</Text>
          <Text style={[t.body, styles.center, { color: colors.mutedForeground }]}>
            {message || "The lesson is over, so its video room is now closed."}
          </Text>
        </View>

        <View style={[styles.countdown, { gap: space.sm, borderRadius: radius.md, backgroundColor: colors.muted }]}>
          <View style={[styles.countCircle, { borderRadius: radius.pill, backgroundColor: colors.primary }]}>
            <Text style={[t.bodyStrong, numeric, { color: colors.primaryForeground }]} testID="expired-class-countdown">
              {seconds}
            </Text>
          </View>
          <Text style={[t.callout, { flex: 1, color: colors.mutedForeground }]}>Returning to your dashboard</Text>
        </View>

        <TouchableOpacity
          testID="expired-class-dashboard"
          accessibilityRole="button"
          accessibilityLabel="Go to dashboard now"
          activeOpacity={0.82}
          onPress={onDashboard}
          style={[
            styles.button,
            {
              minHeight: HIT_SLOP_MIN,
              gap: space.xs,
              borderRadius: radius.md,
              backgroundColor: colors.primary,
            },
          ]}
        >
          <Feather name="home" size={18} color={colors.primaryForeground} />
          <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Go to dashboard now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { alignItems: "center", borderWidth: 1 },
  icon: { width: 58, height: 58, alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" },
  countdown: { width: "100%", minHeight: 60, flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  countCircle: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  button: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
});
