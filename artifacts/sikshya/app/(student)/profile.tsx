import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { notify } from "@/utils/alerts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { apiGet } from "@/utils/api";
import { useColors } from "@/hooks/useColors";
import type { Student } from "@/context/AuthContext";

/**
 * Teachers this student has followed. Following is free — a bookmark, not a purchase.
 */
interface FollowedTeacher {
  id: number;
  name: string;
  subject: string | null;
}

export default function StudentProfile() {
  const { user, logout } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const student = user as Student;
  const [following, setFollowing] = useState<FollowedTeacher[]>([]);
  const [followingLoading, setFollowingLoading] = useState(true);

  const loadFollowing = useCallback(async () => {
    if (!student?.userId) return;
    setFollowingLoading(true);
    try {
      const res = await apiGet<{ teachers: FollowedTeacher[] }>(
        `/students/${student.userId}/followed-teachers`,
      );
      setFollowing(res.teachers);
    } catch {
      setFollowing([]);
    } finally {
      setFollowingLoading(false);
    }
  }, [student?.userId]);

  useFocusEffect(
    useCallback(() => {
      void loadFollowing();
    }, [loadFollowing]),
  );

  const doLogout = async () => {
    await logout();
    router.replace("/welcome");
  };

  const handleLogout = () => {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && !window.confirm("Are you sure you want to log out?")) return;
      doLogout();
      return;
    }
    Alert.alert("Log Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: doLogout },
    ]);
  };

  if (!student || student.role !== "student") return null;

  const initials = student.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient colors={[colors.secondary, "#2D4A7A"]} style={styles.profileHero}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.heroName}>{student.name}</Text>
        <Text style={styles.heroGrade}>{student.grade}</Text>
        <View style={[styles.studentBadge, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
          <Feather name="award" size={13} color="#fff" />
          <Text style={styles.studentBadgeText}>Verified Student</Text>
        </View>
      </LinearGradient>

      <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Account Info</Text>
        <View style={styles.infoRow}>
          <Feather name="mail" size={15} color={colors.mutedForeground} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>{student.email}</Text>
        </View>
        <View style={styles.infoRow}>
          <Feather name="book" size={15} color={colors.mutedForeground} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>{student.grade}</Text>
        </View>
        <View style={styles.infoRow}>
          <Feather name="check-circle" size={15} color={colors.success} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            {student.enrolledSessions.length} sessions attended
          </Text>
        </View>
      </View>

      <View style={[styles.payCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/*
          No "+ Add" button.
          
          It was here and it did nothing — reported exactly that way. Two separate reasons, and
          removing it answers both. `Alert` is not implemented by react-native-web, so the tap
          genuinely did nothing at all on a browser; and had it worked, it promised "add a new
          payment method via eSewa or Khalti" when there is no payment provider connected and
          nothing to add. A control that cannot do its job is worse than no control: it makes
          somebody think the fault is theirs.

          It comes back with the payment provider — see A1 in ISSUES.md — because that is the
          change that gives it something to do.
        */}
        <View style={styles.payHeader}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Payment Methods</Text>
        </View>

        {/* This listed two "verified" eSewa and Khalti accounts with masked numbers, for every
            student, invented in the code. No payment provider is connected yet, so showing
            somebody a verified payment method they do not have is the one thing this screen
            must not do. */}
        <View style={[styles.pmRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <View style={[styles.pmIcon, { backgroundColor: colors.mutedForeground + "20" }]}>
            <Feather name="credit-card" size={16} color={colors.mutedForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.pmType, { color: colors.foreground }]}>No saved payment method</Text>
            <Text style={[styles.pmAccount, { color: colors.mutedForeground }]}>
              Nothing to save yet. Choosing eSewa or Khalti when you book applies to that class
              only — no account is stored, and nothing has been charged to one.
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.securityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Security</Text>
        {[
          { icon: "shield", label: "Two-factor authentication", value: "Enabled" },
          { icon: "lock", label: "Password", value: "Last changed 30 days ago" },
          { icon: "bell", label: "Session alerts", value: "SMS + Email" },
        ].map((item) => (
          <TouchableOpacity
            key={item.label}
            style={styles.secRow}
            onPress={() => notify(item.label, `Manage your ${item.label.toLowerCase()} settings.`)}
            activeOpacity={0.7}
          >
            <Feather name={item.icon as "shield"} size={16} color={colors.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.secLabel, { color: colors.foreground }]}>{item.label}</Text>
              <Text style={[styles.secValue, { color: colors.mutedForeground }]}>{item.value}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.border} />
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.supportBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
        onPress={() => router.push("/notification-settings")}
        activeOpacity={0.7}
        testID="notification-settings-link"
      >
        <Feather name="bell" size={18} color={colors.foreground} />
        <Text style={[styles.supportText, { color: colors.foreground }]}>Notifications</Text>
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.supportBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
        onPress={() => router.push("/support")}
        activeOpacity={0.7}
        testID="customer-support-link"
      >
        <Feather name="help-circle" size={18} color={colors.foreground} />
        <Text style={[styles.supportText, { color: colors.foreground }]}>Customer Support</Text>
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>

      {/* Following a teacher was a one-way door: a student could follow from Discover and then
          had nowhere to see, or undo, who they had followed. */}
      <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Teachers you follow</Text>
        {followingLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 14 }} />
        ) : following.length === 0 ? (
          <>
            <Text style={[styles.paySubtitle, { color: colors.mutedForeground }]}>
              You are not following anyone yet. Follow a teacher from Discover and they will
              appear here, so their new classes are easy to find.
            </Text>
            <TouchableOpacity
              style={[styles.followBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push("/(student)")}
              activeOpacity={0.85}
            >
              <Text style={styles.followBtnText}>Find a teacher</Text>
            </TouchableOpacity>
          </>
        ) : (
          following.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={[styles.pmRow, { backgroundColor: colors.muted, borderColor: colors.border }]}
              onPress={() => router.push(`/(student)/teacher/${t.id}`)}
              activeOpacity={0.75}
            >
              <View style={[styles.pmIcon, { backgroundColor: colors.primary + "18" }]}>
                <Text style={[styles.pmName, { color: colors.primary }]}>
                  {t.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.pmType, { color: colors.foreground }]}>{t.name}</Text>
                {!!t.subject && (
                  <Text style={[styles.pmAccount, { color: colors.mutedForeground }]}>{t.subject}</Text>
                )}
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))
        )}
      </View>

      <TouchableOpacity
        style={[styles.logoutBtn, { borderColor: colors.destructive + "40", backgroundColor: colors.destructive + "08" }]}
        onPress={handleLogout}
        activeOpacity={0.7}
      >
        <Feather name="log-out" size={18} color={colors.destructive} />
        <Text style={[styles.logoutText, { color: colors.destructive }]}>Log Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: 16 },
  profileHero: { paddingTop: 32, paddingBottom: 24, paddingHorizontal: 20, alignItems: "center", gap: 8, marginHorizontal: 20, borderRadius: 20 },
  avatarCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(255,255,255,0.25)", justifyContent: "center", alignItems: "center", marginBottom: 8 },
  avatarText: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#fff" },
  heroName: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  heroGrade: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#ffffff99" },
  studentBadge: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  studentBadgeText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#fff" },
  infoCard: { marginHorizontal: 20, borderRadius: 18, borderWidth: 1, padding: 18, gap: 12 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  infoText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  payCard: { marginHorizontal: 20, borderRadius: 18, borderWidth: 1, padding: 18, gap: 12 },
  payHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  addBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  paySubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  pmRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 12 },
  pmIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  pmName: { fontSize: 18, fontFamily: "Inter_700Bold" },
  pmType: { fontSize: 14, fontFamily: "Inter_500Medium" },
  pmAccount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  verifiedBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4 },
  verifiedText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  securityCard: { marginHorizontal: 20, borderRadius: 18, borderWidth: 1, padding: 18, gap: 4 },
  secRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  secLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  secValue: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  followBtn: { marginTop: 10, alignSelf: "flex-start", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 },
  followBtnText: { fontSize: 13.5, fontFamily: "Inter_600SemiBold", color: "#fff" },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginHorizontal: 20, borderRadius: 16, borderWidth: 1, paddingVertical: 15 },
  logoutText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  supportBtn: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 20, borderRadius: 16, borderWidth: 1, paddingVertical: 15, paddingHorizontal: 16 },
  supportText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
});
