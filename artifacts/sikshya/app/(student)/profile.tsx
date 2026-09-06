import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SocialSignIn } from "@/components/SocialSignIn";
import { HIT_SLOP_MIN, readingWidth } from "@/constants/layout";
import { useAuth, type Student } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

export default function StudentProfile() {
  const { user, logout } = useAuth();
  const colors = useColors();
  const { t, space, radius, elevation, gutter } = useLayout();
  const insets = useSafeAreaInsets();
  const student = user as Student;
  const styles = createStyles({ colors, space, radius, elevation, gutter });

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
      <LinearGradient colors={[colors.secondary, colors.primary]} style={styles.profileHero}>
        <View style={styles.avatarCircle}>
          <Text style={[t.title1, styles.avatarText]}>{initials}</Text>
        </View>
        <Text style={[t.title2, styles.inverseText]}>{student.name}</Text>
        <Text style={[t.callout, styles.inverseMutedText]}>{student.grade || "Grade not added yet"}</Text>
        <View style={[styles.verificationBadge, {
          backgroundColor: verificationBackground,
          borderColor: verificationColor,
        }]}>
          <Feather name={student.emailVerified ? "check-circle" : "mail"} size={16} color={verificationColor} />
          <Text style={[t.caption, { color: verificationColor }]}>
            {student.emailVerified ? "Email verified" : "Email not verified"}
          </Text>
        </View>
      </LinearGradient>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={[t.title3, styles.primaryText]}>Account details</Text>
        <View style={styles.infoRow}>
          <Feather name="mail" size={16} color={colors.mutedForeground} />
          <Text style={[t.callout, styles.secondaryText]} numberOfLines={2}>{student.email}</Text>
        </View>
        <View style={styles.infoRow}>
          <Feather name="book" size={16} color={colors.mutedForeground} />
          <Text style={[t.callout, styles.secondaryText]}>{student.grade || "Grade not added yet"}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={[t.title3, styles.primaryText]}>Payment methods</Text>
        <View style={styles.paymentState}>
          <View style={styles.paymentIcon}>
            <Feather name="credit-card" size={18} color={colors.mutedForeground} />
          </View>
          <View style={styles.paymentCopy}>
            <Text style={[t.bodyStrong, styles.primaryText]}>No saved payment method</Text>
            <Text style={[t.callout, styles.secondaryText]}>
              Payment methods are not stored on this profile. Any payment option offered while booking applies only to that booking.
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.socialRow}><SocialSignIn mode="link" /></View>

      <TouchableOpacity
        accessibilityRole="button"
        style={styles.navigationRow}
        onPress={() => router.push("/notification-settings")}
        activeOpacity={0.7}
        testID="notification-settings-link"
      >
        <Feather name="bell" size={18} color={colors.foreground} />
        <Text style={[t.bodyStrong, styles.navigationText]}>Notifications</Text>
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      </TouchableOpacity>

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
  elevation: ReturnType<typeof useLayout>["elevation"];
  gutter: number;
}

function createStyles({ colors, space, radius, elevation, gutter }: StyleOptions) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    container: { width: "100%", maxWidth: readingWidth, alignSelf: "center", gap: space.md, paddingHorizontal: gutter },
    profileHero: { paddingTop: space.xxl, paddingBottom: space.xl, paddingHorizontal: space.lg, alignItems: "center", gap: space.xs, borderRadius: radius.lg, ...elevation.card },
    avatarCircle: { width: 80, height: 80, borderRadius: radius.pill, backgroundColor: colors.card, justifyContent: "center", alignItems: "center", marginBottom: space.xs },
    avatarText: { color: colors.secondary, textAlign: "center" },
    inverseText: { color: colors.onInverse, textAlign: "center" },
    inverseMutedText: { color: colors.onInverseMuted, textAlign: "center" },
    verificationBadge: { flexDirection: "row", alignItems: "center", gap: space.xxs, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: space.sm, paddingVertical: space.xxs },
    card: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: space.md, gap: space.sm },
    primaryText: { color: colors.foreground },
    secondaryText: { color: colors.mutedForeground },
    infoRow: { minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.sm },
    paymentState: { flexDirection: "row", alignItems: "flex-start", gap: space.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted, padding: space.sm },
    paymentIcon: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, borderRadius: radius.sm, justifyContent: "center", alignItems: "center", backgroundColor: colors.card },
    paymentCopy: { flex: 1, gap: space.xxs },
    socialRow: { marginHorizontal: space.xxs },
    navigationRow: { minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingVertical: space.sm, paddingHorizontal: space.md },
    navigationText: { flex: 1, color: colors.foreground },
    logoutButton: { minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.destructive, backgroundColor: colors.card, paddingVertical: space.sm },
  });
}
