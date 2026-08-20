import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import StarRating from "@/components/StarRating";
import type { Teacher, Credential } from "@/context/AuthContext";

const CREDENTIAL_TYPES = [
  "National ID / Citizenship",
  "Teaching License",
  "University Degree",
  "Professional Certificate",
];

export default function TeacherProfile() {
  const { user, logout, updateUser } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const teacher = user as Teacher;
  const [uploading, setUploading] = useState(false);

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
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: doLogout },
    ]);
  };

  if (!teacher || teacher.role !== "teacher") return null;

  const statusColor = teacher.approvalStatus === "approved" ? colors.success :
    teacher.approvalStatus === "rejected" ? colors.destructive : colors.accent;
  const statusLabel = teacher.approvalStatus === "approved" ? "Verified Teacher" :
    teacher.approvalStatus === "rejected" ? "Rejected – Resubmit" : "Pending Verification";

  const initials = teacher.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  const uploadCredential = async (type: string) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please grant photo library access to upload credentials.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: true,
    });
    if (result.canceled) return;
    setUploading(true);
    try {
      const newCred: Credential = {
        id: Date.now().toString(),
        type,
        uri: result.assets[0]?.uri ?? "",
        name: type,
        uploadedAt: new Date().toISOString(),
      };
      const updated = [...(teacher.credentials ?? []), newCred];
      await updateUser({ credentials: updated, approvalStatus: "pending" } as Partial<Teacher>);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Uploaded", `${type} uploaded successfully. It will be reviewed within 24-48 hours.`);
    } catch (_e) {
      Alert.alert("Error", "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient colors={[colors.primary, "#8B0000"]} style={styles.profileHero}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.heroName}>{teacher.name}</Text>
        <Text style={styles.heroSubject}>{teacher.subject}</Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + "25", borderColor: statusColor + "50" }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        {teacher.approvalStatus === "approved" && (
          <View style={styles.ratingRow}>
            <StarRating rating={teacher.rating} size={16} color="#F5A623" />
            <Text style={styles.ratingText}>{teacher.rating.toFixed(1)} ({teacher.reviewCount} reviews)</Text>
          </View>
        )}
      </LinearGradient>

      <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>About</Text>
        <Text style={[styles.bio, { color: colors.mutedForeground }]}>
          {teacher.bio || "No bio added yet. Update your profile to let students know about your experience."}
        </Text>
        <View style={styles.tagRow}>
          {(teacher.subjects ?? []).map((s) => (
            <View key={s} style={[styles.tag, { backgroundColor: colors.primary + "12" }]}>
              <Text style={[styles.tagText, { color: colors.primary }]}>{s}</Text>
            </View>
          ))}
        </View>
        <View style={styles.infoRow}>
          <Feather name="mail" size={15} color={colors.mutedForeground} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>{teacher.email}</Text>
        </View>
      </View>

      <View style={[styles.credCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.credHeader}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Identity & Credentials</Text>
          {teacher.approvalStatus === "pending" && (
            <View style={[styles.pendingBadge, { backgroundColor: colors.accent + "15" }]}>
              <Text style={[styles.pendingText, { color: colors.accent }]}>Under Review</Text>
            </View>
          )}
        </View>
        <Text style={[styles.credSubtitle, { color: colors.mutedForeground }]}>
          Upload valid documents to get verified. All documents are reviewed by the Sikshya team within 24-48 hours.
        </Text>

        {teacher.credentials.length > 0 && (
          <View style={styles.uploadedList}>
            {teacher.credentials.map((cred) => (
              <View key={cred.id} style={[styles.credItem, { backgroundColor: colors.success + "10", borderColor: colors.success + "30" }]}>
                <Feather name="file-text" size={16} color={colors.success} />
                <Text style={[styles.credName, { color: colors.success }]}>{cred.name}</Text>
                <Feather name="check" size={14} color={colors.success} />
              </View>
            ))}
          </View>
        )}

        <Text style={[styles.uploadLabel, { color: colors.foreground }]}>Upload Document:</Text>
        <View style={styles.credTypeGrid}>
          {CREDENTIAL_TYPES.map((type) => {
            const uploaded = teacher.credentials.some((c) => c.type === type);
            return (
              <TouchableOpacity
                key={type}
                style={[styles.credTypeBtn, { borderColor: uploaded ? colors.success : colors.border, backgroundColor: uploaded ? colors.success + "10" : colors.muted }]}
                onPress={() => uploadCredential(type)}
                disabled={uploading}
                activeOpacity={0.7}
              >
                <Feather name={uploaded ? "check-circle" : "upload"} size={16} color={uploaded ? colors.success : colors.mutedForeground} />
                <Text style={[styles.credTypeName, { color: uploaded ? colors.success : colors.mutedForeground }]}>{type}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
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
  heroSubject: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#ffffff99" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  ratingText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#ffffffcc" },
  infoCard: { marginHorizontal: 20, borderRadius: 18, borderWidth: 1, padding: 18, gap: 12 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  bio: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  tagText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  credCard: { marginHorizontal: 20, borderRadius: 18, borderWidth: 1, padding: 18, gap: 12 },
  credHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pendingBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  pendingText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  credSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  uploadedList: { gap: 8 },
  credItem: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 10, borderWidth: 1, padding: 10 },
  credName: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  uploadLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  credTypeGrid: { gap: 10 },
  credTypeBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, padding: 13 },
  credTypeName: { fontSize: 14, fontFamily: "Inter_400Regular" },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginHorizontal: 20, borderRadius: 16, borderWidth: 1, paddingVertical: 15 },
  logoutText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  supportBtn: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 20, borderRadius: 16, borderWidth: 1, paddingVertical: 15, paddingHorizontal: 16 },
  supportText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
});
