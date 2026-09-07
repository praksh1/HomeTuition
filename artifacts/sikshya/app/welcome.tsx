import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FadkoLogo } from "@/components/FadkoLogo";
import { HIT_SLOP_MIN, readingWidth } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { t, gutter, space, radius, width, isWide } = useLayout();
  const heroHeight = isWide
    ? readingWidth / 2
    : Math.min(width - gutter * 2, readingWidth) * 0.72;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xl,
        paddingBottom: insets.bottom + space.xxl,
        paddingHorizontal: gutter,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.content, { maxWidth: readingWidth, gap: space.xl }]}>
        <FadkoLogo />

        <Image
          source={require("../assets/images/hero_fadko_live_learning.jpg")}
          style={{ width: "100%", height: heroHeight, borderRadius: radius.lg }}
          contentFit="cover"
          accessibilityLabel="A teacher and student working together on a live mathematics whiteboard"
        />

        <View style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[t.display, { color: colors.foreground }]}>Live learning, built around you.</Text>
          <Text style={[t.body, { color: colors.mutedForeground }]}>Teach, learn and work together on one shared board.</Text>
        </View>

        <View style={{ gap: space.md }}>
          <RoleButton
            title="I’m a teacher"
            description="Create and run live classes"
            icon="monitor"
            primary
            onPress={() => router.push("/(auth)/login?role=teacher")}
          />
          <RoleButton
            title="I’m a student"
            description="Find teachers and join classes"
            icon="book-open"
            onPress={() => router.push("/(auth)/login?role=student")}
          />
        </View>
      </View>
    </ScrollView>
  );
}

interface RoleButtonProps {
  title: string;
  description: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  primary?: boolean;
  onPress: () => void;
}

function RoleButton({ title, description, icon, primary = false, onPress }: RoleButtonProps) {
  const colors = useColors();
  const { t, space, radius, elevation } = useLayout();
  const foreground = primary ? colors.primaryForeground : colors.foreground;
  const secondary = primary ? colors.onInverseMuted : colors.mutedForeground;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      accessibilityHint="Opens sign in and sign up"
      onPress={onPress}
      style={({ pressed }) => [
        styles.roleButton,
        elevation.card,
        {
          minHeight: HIT_SLOP_MIN,
          gap: space.md,
          padding: space.md,
          borderRadius: radius.md,
          borderColor: primary ? colors.primary : colors.border,
          backgroundColor: primary ? colors.primary : colors.card,
          opacity: pressed ? 0.86 : 1,
        },
      ]}
    >
      <View style={[styles.roleIcon, { width: space.huge, height: space.huge, borderRadius: radius.sm, backgroundColor: primary ? colors.card : colors.actionSoft }]}>
        <Feather name={icon} size={space.xl} color={colors.primary} />
      </View>
      <View style={styles.roleCopy}>
        <Text style={[t.title3, { color: foreground }]}>{title}</Text>
        <Text style={[t.callout, { color: secondary }]}>{description}</Text>
      </View>
      <Feather name="chevron-right" size={space.xl} color={primary ? colors.primaryForeground : colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", alignSelf: "center" },
  roleButton: { flexDirection: "row", alignItems: "center", borderWidth: 1 },
  roleIcon: { justifyContent: "center", alignItems: "center" },
  roleCopy: { flex: 1 },
});
