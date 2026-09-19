import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SocialSignIn } from "@/components/SocialSignIn";
import { AccountDetailsCard } from "@/components/profile/AccountDetailsCard";
import { ProfileActionRow } from "@/components/profile/ProfileActionRow";
import { ProfileHero } from "@/components/profile/ProfileHero";
import { ProfileOverflowMenu } from "@/components/profile/ProfileOverflowMenu";
import { HIT_SLOP_MIN, readingWidth } from "@/constants/layout";
import { useAuth, type Student } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

export default function StudentProfile() {
  const { user, logout } = useAuth();
  const colors = useColors();
  const { t, space, radius, gutter } = useLayout();
  const insets = useSafeAreaInsets();
  const student = user as Student;
  const styles = createStyles({ colors, space, radius, gutter });

  const doLogout = async () => {
    await logout();
    router.replace("/welcome");
  };

  const handleLogout = () => {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && !window.confirm("Are you sure you want to log out?")) return;
      void doLogout();
      return;
    }
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: () => void doLogout() },
    ]);
  };

  if (!student || student.role !== "student") return null;

  const initials = student.name.split(" ").map((name) => name[0]).slice(0, 2).join("").toUpperCase();
  const verificationColor = student.emailVerified ? colors.success : colors.warn;
  const verificationBackground = student.emailVerified ? colors.successSoft : colors.warnSoft;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.container, {
        paddingTop: insets.top + space.md,
        paddingBottom: insets.bottom + space.huge + space.huge,
      }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.profileTopRow}>
        <View style={styles.profileWordmark}>
          <View style={[styles.profileWordmarkMark, { borderRadius: radius.xs, backgroundColor: colors.brand }]}>
            <Feather name="book-open" size={13} color={colors.brandForeground} />
          </View>
          <Text style={[t.bodyStrong, { color: colors.foreground }]}>Fadko</Text>
        </View>
        <ProfileOverflowMenu items={[
          { icon: "edit-3", label: "Edit account details", detail: "Location, school and contact", onPress: () => router.push({ pathname: "/onboarding", params: { edit: "1", role: "student" } }) },
          { icon: "credit-card", label: "Payments & receipts", detail: "Charges and refunds", onPress: () => router.push("/(student)/payments") },
          { icon: "bell", label: "Notifications", detail: "Choose what reaches you", onPress: () => router.push("/notification-settings") },
          { icon: "life-buoy", label: "Fadko Support", detail: "Get help from the support team", onPress: () => router.push("/support") },
          { icon: "zap", label: "Fadko AI assistant", detail: "Coming soon", disabled: true },
          { icon: "log-out", label: "Log out", onPress: handleLogout, destructive: true },
        ]} />
      </View>
      <ProfileHero
        eyebrow="MY FADKO PROFILE"
        initials={initials}
        name={student.name}
        subtitle={student.grade || "Grade not added yet"}
        status={{
          icon: student.emailVerified ? "check-circle" : "mail",
          label: student.emailVerified ? "Email verified" : "Email not verified",
          color: verificationColor,
          background: verificationBackground,
        }}
      />

      <AccountDetailsCard email={student.email} role="student" />

      <View style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[t.title3, { color: colors.foreground }]}>Account & payments</Text>
        <ProfileActionRow
          icon="file-text"
          title="Payments & receipts"
          detail="Charges, test payments and refunds"
          onPress={() => router.push("/(student)/payments")}
          testID="student-payments-link"
        />
        <ProfileActionRow
          icon="bell"
          title="Notifications"
          detail="Choose which updates reach you"
          onPress={() => router.push("/notification-settings")}
          testID="notification-settings-link"
        />
      </View>

      <View style={styles.socialRow}><SocialSignIn mode="link" /></View>

      <TouchableOpacity accessibilityRole="button" style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.7}>
        <Feather name="log-out" size={18} color={colors.destructive} />
        <Text style={[t.bodyStrong, { color: colors.destructive }]}>Log Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

interface StyleOptions {
  colors: ReturnType<typeof useColors>;
  space: ReturnType<typeof useLayout>["space"];
  radius: ReturnType<typeof useLayout>["radius"];
  gutter: number;
}

function createStyles({ colors, space, radius, gutter }: StyleOptions) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    container: { width: "100%", maxWidth: readingWidth, alignSelf: "center", gap: space.md, paddingHorizontal: gutter },
    socialRow: { marginHorizontal: space.xxs },
    profileTopRow: { minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    profileWordmark: { flexDirection: "row", alignItems: "center", gap: space.xs },
    profileWordmarkMark: { width: space.lg, height: space.lg, alignItems: "center", justifyContent: "center" },
    logoutButton: { minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.destructive, backgroundColor: colors.card, paddingVertical: space.sm },
  });
}
