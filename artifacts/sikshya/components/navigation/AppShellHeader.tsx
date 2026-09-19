import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FadkoLogo } from "@/components/FadkoLogo";
import { ProfileOverflowMenu, type ProfileMenuItem } from "@/components/profile/ProfileOverflowMenu";
import { HIT_SLOP_MIN, radius, space } from "@/constants/layout";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

type ShellRole = "teacher" | "student";

/** Persistent identity and utilities for every primary app destination. */
export function AppShellHeader({ role, routeName }: { role: ShellRole; routeName: string }) {
  const colors = useColors();
  const { user, logout } = useAuth();
  const { t, gutter, isExpanded } = useLayout();
  const insets = useSafeAreaInsets();
  const initials = (user?.name ?? "Fadko")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const go = (path: string) => router.push(path as never);
  const profilePath = role === "teacher" ? "/(teacher)/profile" : "/(student)/profile";
  const supportPath = role === "teacher" ? "/(teacher)/support" : "/(student)/support";
  const isProfile = routeName === "profile";

  const common: ProfileMenuItem[] = [
    {
      section: "Account",
      icon: "edit-3",
      label: "Personal information",
      detail: "Contact, location and school",
      onPress: () => go(`/onboarding?edit=1&role=${role}`),
    },
    {
      section: "Preferences",
      icon: "bell",
      label: "Notifications",
      detail: "Choose what reaches you",
      onPress: () => go("/notification-settings"),
    },
    {
      section: "Help",
      icon: "life-buoy",
      label: "Fadko Support",
      detail: "Get help without losing your place",
      onPress: () => go(supportPath),
    },
    {
      section: "Help",
      icon: "inbox",
      label: "My support requests",
      detail: "Follow previous questions and decisions",
      onPress: () => go("/requests"),
    },
    {
      section: "Help",
      icon: "zap",
      label: "Fadko assistant",
      detail: "Cost-controlled answers are being prepared",
      disabled: true,
    },
    {
      section: "Access",
      icon: "log-out",
      label: "Log out",
      detail: "Sign out of this device",
      destructive: true,
      onPress: () => { logout(); router.replace("/welcome"); },
    },
  ];

  const roleItems: ProfileMenuItem[] = role === "teacher"
    ? [
        {
          section: "Teaching",
          icon: "calendar",
          label: "My schedule",
          detail: "Upcoming lessons and class dates",
          onPress: () => go("/(teacher)/sessions"),
        },
        {
          section: "Teaching",
          icon: "users",
          label: "My students",
          detail: "Rosters, attendance and class history",
          onPress: () => go("/(teacher)/students"),
        },
        {
          section: "Teaching",
          icon: "message-circle",
          label: "Messages",
          detail: "Class conversations and direct messages",
          onPress: () => go("/(teacher)/messages"),
        },
        {
          section: "Money",
          icon: "credit-card",
          label: "Teaching & earnings",
          detail: "Pending earnings and payout records",
          onPress: () => go("/(teacher)/subscription"),
        },
      ]
    : [
        {
          section: "Learning",
          icon: "calendar",
          label: "My classes",
          detail: "Upcoming and completed lessons",
          onPress: () => go("/(student)/sessions"),
        },
        {
          section: "Learning",
          icon: "message-circle",
          label: "Messages",
          detail: "Teachers and class conversations",
          onPress: () => go("/(student)/messages"),
        },
        {
          section: "Money",
          icon: "credit-card",
          label: "Payments & receipts",
          detail: "Payments, receipts and refunds",
          onPress: () => go("/(student)/payments"),
        },
      ];

  const items = [common[0], ...roleItems, ...common.slice(1)];

  return (
    <View
      testID="app-shell-header"
      style={[
        styles.header,
        {
          minHeight: 58 + insets.top,
          paddingTop: insets.top,
          paddingHorizontal: isExpanded ? space.xxl : gutter,
          borderBottomColor: colors.border,
          backgroundColor: colors.card,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go to Fadko home"
        onPress={() => go(role === "teacher" ? "/(teacher)" : "/(student)")}
        style={({ pressed }) => [styles.brand, pressed && styles.pressed]}
      >
        <FadkoLogo compact />
      </Pressable>

      <View style={styles.utilities}>
        {isProfile ? (
          <ProfileOverflowMenu items={items} />
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open notifications"
              onPress={() => go("/notifications")}
              style={({ pressed }) => [styles.utility, { backgroundColor: colors.muted }, pressed && styles.pressed]}
            >
              <Feather name="bell" size={20} color={colors.foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open profile"
              onPress={() => go(profilePath)}
              style={({ pressed }) => [styles.avatar, { backgroundColor: colors.actionSoft, borderColor: colors.border }, pressed && styles.pressed]}
            >
              <Text style={[t.caption, { color: colors.primary, fontWeight: "700" }]}>{initials}</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth },
  brand: { minHeight: HIT_SLOP_MIN, justifyContent: "center" },
  utilities: { flexDirection: "row", alignItems: "center", gap: space.xs },
  utility: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  avatar: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, borderWidth: 1 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
});
