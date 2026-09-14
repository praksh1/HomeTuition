import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

type IconName = React.ComponentProps<typeof Feather>["name"];

interface ProfileHeroProps {
  eyebrow: string;
  initials: string;
  name: string;
  subtitle: string;
  status: {
    icon: IconName;
    label: string;
    color: string;
    background: string;
  };
  children?: React.ReactNode;
}

/**
 * One identity surface for both roles.
 *
 * Profile used to be two almost-identical gradients that had already started to drift. Keeping
 * the hero shared means a visual improvement reaches both sides and the role-specific truth stays
 * in the caller: approval for teachers, email verification for students.
 */
export function ProfileHero({ eyebrow, initials, name, subtitle, status, children }: ProfileHeroProps) {
  const colors = useColors();
  const { t, space, radius, elevation } = useLayout();

  return (
    <LinearGradient
      colors={[colors.secondary, colors.primary]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.hero, { borderRadius: radius.lg, padding: space.xl, gap: space.sm, backgroundColor: colors.secondary }, elevation.card]}
    >
      <View style={[styles.eyebrowRow, { gap: space.xs }]}>
        <View style={[styles.brandMark, { width: space.xxl, height: space.xxl, borderRadius: radius.sm, backgroundColor: colors.brand }]}>
          <Feather name="book-open" size={16} color={colors.brandForeground} />
        </View>
        <Text style={[t.overline, { color: colors.onInverseMuted }]}>{eyebrow}</Text>
      </View>

      <View style={[styles.identityRow, { gap: space.md }]}>
        <View style={[styles.avatarRing, { width: space.huge + space.xxl, height: space.huge + space.xxl, padding: space.xxs, borderRadius: radius.pill, borderColor: colors.onInverseMuted }]}>
          <View style={[styles.avatar, { borderRadius: radius.pill, backgroundColor: colors.card }]}>
            <Text style={[t.title2, { color: colors.secondary }]}>{initials}</Text>
          </View>
        </View>
        <View style={[styles.identityCopy, { gap: space.xxs }]}>
          <Text style={[t.title2, { color: colors.onInverse }]}>{name}</Text>
          <Text style={[t.callout, { color: colors.onInverseMuted }]}>{subtitle}</Text>
        </View>
      </View>

      <View style={[styles.status, { minHeight: HIT_SLOP_MIN, gap: space.xxs, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: status.background }]}>
        <Feather name={status.icon} size={15} color={status.color} />
        <Text style={[t.caption, { color: status.color }]}>{status.label}</Text>
      </View>

      {children ? <View style={{ paddingTop: space.xxs }}>{children}</View> : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: { width: "100%", overflow: "hidden" },
  eyebrowRow: { flexDirection: "row", alignItems: "center" },
  brandMark: { alignItems: "center", justifyContent: "center" },
  identityRow: { flexDirection: "row", alignItems: "center" },
  avatarRing: { borderWidth: 1 },
  avatar: { flex: 1, alignItems: "center", justifyContent: "center" },
  identityCopy: { flex: 1 },
  status: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center" },
});
