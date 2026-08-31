import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { notify } from "@/utils/alerts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import StarRating from "@/components/StarRating";
import type { Teacher } from "@/context/AuthContext";
import { apiDelete, apiGet, apiPost } from "@/utils/api";
import { uploadFile, type UploadableFile } from "@/utils/uploadFile";
import { openAttachment } from "@/utils/openAttachment";
import { SocialSignIn } from "@/components/SocialSignIn";

const CREDENTIAL_TYPES = [
  { id: "citizenship", label: "National ID / Citizenship" },
  { id: "teaching_license", label: "Teaching License" },
  { id: "university_degree", label: "University Degree" },
  { id: "professional_certificate", label: "Professional Certificate" },
] as const;

interface StoredCredential {
  id: number;
  documentType: string;
  fileKey: string;
  originalName: string;
  contentType: string;
  status: "submitted" | "opened" | "approved" | "rejected";
  rejectionReason: string | null;
  createdAt: string;
}

export default function TeacherProfile() {
  const { user, logout } = useAuth();
  const colors = useColors();
  const { t, space } = useLayout();
  const insets = useSafeAreaInsets();
  const teacher = user as Teacher;
  const [uploading, setUploading] = useState(false);
  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [selected, setSelected] = useState<{ documentType: string; file: UploadableFile } | null>(null);

  const loadCredentials = useCallback(async () => {
    try {
      const result = await apiGet<{ credentials: StoredCredential[] }>("/teachers/me/credentials");
      setCredentials(result.credentials ?? []);
    } catch {
      setCredentials([]);
    }
  }, []);

  useEffect(() => { void loadCredentials(); }, [loadCredentials]);

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

  const chooseCredential = async (documentType: string) => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setSelected({
      documentType,
      file: {
        uri: asset.uri,
        name: asset.name ?? "credential",
        mimeType: asset.mimeType ?? "application/octet-stream",
        size: asset.size ?? 0,
      },
    });
  };

  const submitCredential = async () => {
    if (!selected) return;
    setUploading(true);
    try {
      const fileKey = await uploadFile(selected.file);
      await apiPost("/teachers/me/credentials", {
        documentType: selected.documentType,
        fileKey,
        originalName: selected.file.name,
        contentType: selected.file.mimeType,
      });
      setSelected(null);
      await loadCredentials();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      notify("Submitted", "The document is now waiting for an operator to review it.");
    } catch (error) {
      notify("Upload failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const deleteCredential = async (credential: StoredCredential) => {
    try {
      await apiDelete(`/teachers/me/credentials/${credential.id}`);
      await loadCredentials();
      notify("Deleted", "The document was removed before review.");
    } catch (error) {
      notify("Cannot delete", error instanceof Error ? error.message : "An operator may already have opened it.");
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

        <Text style={[styles.uploadLabel, { color: colors.foreground }]}>Documents</Text>
        <View style={styles.credTypeGrid}>
          {CREDENTIAL_TYPES.map((type) => {
            const uploaded = credentials.find((credential) => credential.documentType === type.id);
            const selectedHere = selected?.documentType === type.id ? selected.file : null;
            const locked = uploaded?.status === "opened" || uploaded?.status === "approved";
            const canReplace = !uploaded || uploaded.status === "rejected";
            return (
              <View key={type.id} style={[styles.credentialBlock, { borderColor: uploaded?.status === "rejected" ? colors.destructive : colors.border, backgroundColor: colors.muted }]}>
                <View style={styles.credentialTitleRow}>
                  <Feather name={uploaded ? "file-text" : "upload"} size={16} color={uploaded?.status === "rejected" ? colors.destructive : uploaded ? colors.success : colors.mutedForeground} />
                  <Text style={[styles.credTypeName, { color: colors.foreground }]}>{type.label}</Text>
                  {uploaded && <Text style={[t.caption, styles.documentStatus, { color: uploaded.status === "rejected" ? colors.destructive : uploaded.status === "approved" ? colors.success : colors.warn }]}>{uploaded.status === "opened" ? "Under review" : uploaded.status}</Text>}
                </View>
                {uploaded && (
                  <TouchableOpacity onPress={() => void openAttachment(uploaded.fileKey)} activeOpacity={0.7}>
                    <Text style={[t.caption, { color: colors.primary }]} numberOfLines={1}>{uploaded.originalName}</Text>
                  </TouchableOpacity>
                )}
                {uploaded?.rejectionReason && <Text style={[t.caption, { color: colors.destructive }]}>{uploaded.rejectionReason}</Text>}
                {selectedHere && <Text style={[t.caption, { color: colors.foreground }]} numberOfLines={1}>Selected: {selectedHere.name}</Text>}
                <View style={styles.documentActions}>
                  {canReplace && (
                    <TouchableOpacity style={[styles.documentAction, { borderColor: colors.border }]} onPress={() => void chooseCredential(type.id)} disabled={uploading} activeOpacity={0.7}>
                      <Text style={[t.caption, { color: colors.primary }]}>{selectedHere ? "Choose another" : "Select file"}</Text>
                    </TouchableOpacity>
                  )}
                  {selectedHere && (
                    <TouchableOpacity style={[styles.documentAction, { backgroundColor: colors.primary, borderColor: colors.primary }]} onPress={() => void submitCredential()} disabled={uploading} activeOpacity={0.8}>
                      <Text style={[t.caption, { color: colors.primaryForeground }]}>{uploading ? "Uploading…" : "Upload"}</Text>
                    </TouchableOpacity>
                  )}
                  {uploaded?.status === "submitted" && !locked && (
                    <TouchableOpacity style={[styles.documentAction, { borderColor: colors.destructive }]} onPress={() => void deleteCredential(uploaded)} activeOpacity={0.7}>
                      <Text style={[t.caption, { color: colors.destructive }]}>Delete</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {locked && <Text style={[t.caption, { color: colors.mutedForeground }]}>An operator has opened this file, so it can no longer be deleted.</Text>}
              </View>
            );
          })}
        </View>
      </View>

      {/*
        Plan lives here now rather than in the tab bar — the owner asked for it: "the 'Plan'
        tab can be integrated inside the 'Profile' tab". A subscription is set up once and then
        forgotten; it does not earn a permanent place on every screen.
      */}
      <View style={{ marginHorizontal: space.lg }}><SocialSignIn mode="link" /></View>

      <TouchableOpacity
        style={[styles.supportBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
        onPress={() => router.push("/(teacher)/subscription")}
        activeOpacity={0.7}
        testID="subscription-link"
      >
        <Feather name="credit-card" size={18} color={colors.foreground} />
        <Text style={[styles.supportText, { color: colors.foreground }]}>My Plan</Text>
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>

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

      {/*
        Customer Support used to sit here.

        It is a tab of its own now, for both roles — the owner asked for that, and then asked
        for this link to go: "Remove the 'Support' link from the Profile section for both
        teachers and students (it now lives in its own tab)." Two doors to the same screen is
        one more than anybody needs, and the one buried two taps down was never the one to
        keep.
      */}

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
  credentialBlock: { gap: 8, borderRadius: 12, borderWidth: 1, padding: 13 },
  credentialTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  documentStatus: { marginLeft: "auto", textTransform: "capitalize" },
  documentActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  documentAction: { minHeight: 36, justifyContent: "center", borderRadius: 10, borderWidth: 1, paddingHorizontal: 12 },
  credTypeBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, padding: 13 },
  credTypeName: { fontSize: 14, fontFamily: "Inter_400Regular" },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginHorizontal: 20, borderRadius: 16, borderWidth: 1, paddingVertical: 15 },
  logoutText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  supportBtn: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 20, borderRadius: 16, borderWidth: 1, paddingVertical: 15, paddingHorizontal: 16 },
  supportText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
});
