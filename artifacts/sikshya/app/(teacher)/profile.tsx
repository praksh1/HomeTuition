import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SocialSignIn } from "@/components/SocialSignIn";
import StarRating from "@/components/StarRating";
import { HIT_SLOP_MIN, readingWidth } from "@/constants/layout";
import { useAuth, type Teacher } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { notify } from "@/utils/alerts";
import { apiDelete, apiGet, apiPost } from "@/utils/api";
import { openAttachment } from "@/utils/openAttachment";
import { uploadFile, type UploadableFile } from "@/utils/uploadFile";

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

type CredentialLoadState = "loading" | "ready" | "error";

export default function TeacherProfile() {
  const { user, logout, refreshUser } = useAuth();
  const colors = useColors();
  const { t, numeric, space, radius, elevation, gutter } = useLayout();
  const insets = useSafeAreaInsets();
  const teacher = user as Teacher;
  const styles = createStyles({ colors, space, radius, elevation, gutter });
  const [uploading, setUploading] = useState(false);
  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [credentialLoadState, setCredentialLoadState] = useState<CredentialLoadState>("loading");
  const [selected, setSelected] = useState<{ documentType: string; file: UploadableFile } | null>(null);

  const loadCredentials = useCallback(async () => {
    setCredentialLoadState("loading");
    try {
      const result = await apiGet<{ credentials: StoredCredential[] }>("/teachers/me/credentials");
      setCredentials(result.credentials ?? []);
      setCredentialLoadState("ready");
    } catch {
      setCredentialLoadState("error");
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
      void doLogout();
      return;
    }
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: () => void doLogout() },
    ]);
  };

  if (!teacher || teacher.role !== "teacher") return null;

  const statusColor = teacher.approvalStatus === "approved" ? colors.success
    : teacher.approvalStatus === "rejected" ? colors.destructive : colors.warn;
  const statusBackground = teacher.approvalStatus === "approved" ? colors.successSoft
    : teacher.approvalStatus === "rejected" ? colors.destructiveSoft : colors.warnSoft;
  const statusLabel = teacher.approvalStatus === "approved" ? "Teaching profile approved"
    : teacher.approvalStatus === "rejected" ? "Teaching review needs action" : "Teaching review pending";
  const hasReviews = teacher.reviewCount > 0;
  const initials = teacher.name.split(" ").map((name) => name[0]).slice(0, 2).join("").toUpperCase();

  const chooseCredential = async (documentType: string) => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setSelected({ documentType, file: {
      uri: asset.uri,
      name: asset.name ?? "credential",
      mimeType: asset.mimeType ?? "application/octet-stream",
      size: asset.size ?? 0,
    } });
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
      // Uploading a new document resets a rejected teaching profile to pending on the server.
      // Refresh the signed-in profile so the status badge reflects that server-owned change.
      // AuthContext deliberately absorbs refresh failures, so a successful upload is never
      // misreported as failed just because the follow-up refresh could not reach the server.
      await refreshUser();
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
        <Text style={[t.title2, styles.inverseText]}>{teacher.name}</Text>
        <Text style={[t.callout, styles.inverseMutedText]}>{teacher.subject || "Subject not added yet"}</Text>
        <View style={[styles.statusBadge, { backgroundColor: statusBackground, borderColor: statusColor }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[t.caption, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        {teacher.approvalStatus === "approved" && (
          <View style={styles.ratingRow}>
            {hasReviews ? <>
              <StarRating rating={teacher.rating} size={16} color={colors.accent} />
              <Text style={[t.callout, numeric, styles.inverseMutedText]}>
                {teacher.rating.toFixed(1)} · {teacher.reviewCount} {teacher.reviewCount === 1 ? "review" : "reviews"}
              </Text>
            </> : <Text style={[t.callout, styles.inverseMutedText]}>No student reviews yet</Text>}
          </View>
        )}
      </LinearGradient>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={[t.title3, styles.primaryText]}>About</Text>
        <Text style={[t.body, styles.secondaryText]}>
          {teacher.bio || "No bio added yet. Add one during profile setup to help students understand your experience."}
        </Text>
        {(teacher.subjects ?? []).length > 0 && <View style={styles.tagRow}>
          {teacher.subjects.map((subject) => <View key={subject} style={styles.tag}>
            <Text style={[t.caption, { color: colors.primary }]}>{subject}</Text>
          </View>)}
        </View>}
        <View style={styles.infoRow}>
          <Feather name="mail" size={16} color={colors.mutedForeground} />
          <Text style={[t.callout, styles.secondaryText]} numberOfLines={2}>{teacher.email}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={[t.title3, styles.primaryText]}>Identity & Credentials</Text>
        <Text style={[t.callout, styles.secondaryText]}>
          Fadko Support reviews each file before it can be approved. You can replace a rejected file; a file already opened for review stays locked.
        </Text>
        <Text style={[t.bodyStrong, styles.primaryText]}>Documents</Text>

        {credentialLoadState === "loading" && <View style={styles.loadState} accessibilityRole="progressbar" accessibilityLabel="Loading documents">
          <ActivityIndicator color={colors.primary} />
          <Text style={[t.callout, styles.secondaryText]}>Loading your documents…</Text>
        </View>}
        {credentialLoadState === "error" && <View style={[styles.loadState, styles.errorState]}>
          <Feather name="alert-circle" size={20} color={colors.destructive} />
          <Text style={[t.callout, styles.secondaryText]}>We could not load your documents. Nothing has been removed.</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Try loading documents again" style={styles.retryButton} onPress={() => void loadCredentials()} activeOpacity={0.7}>
            <Text style={[t.bodyStrong, { color: colors.primary }]}>Try again</Text>
          </TouchableOpacity>
        </View>}
        {credentialLoadState === "ready" && <View style={styles.credentialGrid}>
          {CREDENTIAL_TYPES.map((type) => {
            const uploaded = credentials.find((credential) => credential.documentType === type.id);
            const selectedHere = selected?.documentType === type.id ? selected.file : null;
            const locked = uploaded?.status === "opened" || uploaded?.status === "approved";
            const canReplace = !uploaded || uploaded.status === "rejected";
            const documentColor = uploaded?.status === "rejected" ? colors.destructive
              : uploaded?.status === "approved" ? colors.success : uploaded ? colors.warn : colors.mutedForeground;
            return <View key={type.id} style={[styles.credentialBlock, {
              borderColor: uploaded?.status === "rejected" ? colors.destructive : colors.border,
            }]}>
              <View style={styles.credentialTitleRow}>
                <Feather name={uploaded ? "file-text" : "upload"} size={16} color={documentColor} />
                <Text style={[t.bodyStrong, styles.credentialName]}>{type.label}</Text>
                {uploaded && <Text style={[t.caption, styles.documentStatus, { color: documentColor }]}>
                  {uploaded.status === "opened" ? "Under review" : uploaded.status}
                </Text>}
              </View>
              {uploaded && <TouchableOpacity accessibilityRole="link" accessibilityLabel={`Open ${uploaded.originalName}`} style={styles.fileLink} onPress={() => void openAttachment(uploaded.fileKey)} activeOpacity={0.7}>
                <Text style={[t.caption, { color: colors.primary }]} numberOfLines={2}>{uploaded.originalName}</Text>
              </TouchableOpacity>}
              {uploaded?.rejectionReason && <Text style={[t.caption, { color: colors.destructive }]}>{uploaded.rejectionReason}</Text>}
              {selectedHere && <Text style={[t.caption, styles.primaryText]} numberOfLines={2}>Selected: {selectedHere.name}</Text>}
              <View style={styles.documentActions}>
                {canReplace && <TouchableOpacity accessibilityRole="button" accessibilityLabel={selectedHere ? `Choose another ${type.label} file` : `Select ${type.label} file`} accessibilityState={{ disabled: uploading }} style={styles.outlineAction} onPress={() => void chooseCredential(type.id)} disabled={uploading} activeOpacity={0.7}>
                  <Text style={[t.caption, { color: colors.primary }]}>{selectedHere ? "Choose another" : "Select file"}</Text>
                </TouchableOpacity>}
                {selectedHere && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Upload selected ${type.label}`} accessibilityState={{ disabled: uploading }} style={styles.primaryAction} onPress={() => void submitCredential()} disabled={uploading} activeOpacity={0.8}>
                  <Text style={[t.caption, { color: colors.primaryForeground }]}>{uploading ? "Uploading…" : "Upload"}</Text>
                </TouchableOpacity>}
                {uploaded?.status === "submitted" && !locked && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Delete submitted ${type.label}`} style={styles.destructiveAction} onPress={() => void deleteCredential(uploaded)} activeOpacity={0.7}>
                  <Text style={[t.caption, { color: colors.destructive }]}>Delete</Text>
                </TouchableOpacity>}
              </View>
              {locked && <Text style={[t.caption, styles.secondaryText]}>An operator has opened this file, so it can no longer be deleted.</Text>}
            </View>;
          })}
        </View>}
      </View>

      <View style={styles.socialRow}><SocialSignIn mode="link" /></View>

      <TouchableOpacity accessibilityRole="button" style={styles.navigationRow} onPress={() => router.push("/(teacher)/subscription")} activeOpacity={0.7} testID="subscription-link">
        <Feather name="credit-card" size={18} color={colors.foreground} />
        <Text style={[t.bodyStrong, styles.navigationText]}>Teaching & earnings</Text>
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      </TouchableOpacity>

      <TouchableOpacity accessibilityRole="button" style={styles.navigationRow} onPress={() => router.push("/notification-settings")} activeOpacity={0.7} testID="notification-settings-link">
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
    statusBadge: { flexDirection: "row", alignItems: "center", gap: space.xxs, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: space.sm, paddingVertical: space.xxs },
    statusDot: { width: space.xs, height: space.xs, borderRadius: radius.pill },
    ratingRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: space.xs },
    card: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: space.md, gap: space.sm },
    primaryText: { color: colors.foreground },
    secondaryText: { color: colors.mutedForeground },
    tagRow: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
    tag: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: space.xxs, backgroundColor: colors.actionSoft },
    infoRow: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: HIT_SLOP_MIN },
    loadState: { alignItems: "center", justifyContent: "center", gap: space.xs, minHeight: space.huge + space.huge, padding: space.md },
    errorState: { borderRadius: radius.sm, backgroundColor: colors.destructiveSoft },
    retryButton: { minHeight: HIT_SLOP_MIN, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary },
    credentialGrid: { gap: space.sm },
    credentialBlock: { gap: space.xs, borderRadius: radius.sm, borderWidth: 1, padding: space.sm, backgroundColor: colors.muted },
    credentialTitleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs },
    credentialName: { color: colors.foreground, flexShrink: 1 },
    documentStatus: { marginLeft: "auto", textTransform: "capitalize" },
    fileLink: { minHeight: HIT_SLOP_MIN, justifyContent: "center" },
    documentActions: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
    outlineAction: { minHeight: HIT_SLOP_MIN, justifyContent: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.card, paddingHorizontal: space.sm },
    primaryAction: { minHeight: HIT_SLOP_MIN, justifyContent: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primary, paddingHorizontal: space.sm },
    destructiveAction: { minHeight: HIT_SLOP_MIN, justifyContent: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: colors.destructive, backgroundColor: colors.card, paddingHorizontal: space.sm },
    socialRow: { marginHorizontal: space.xxs },
    navigationRow: { minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingVertical: space.sm, paddingHorizontal: space.md },
    navigationText: { flex: 1, color: colors.foreground },
    logoutButton: { minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.destructive, backgroundColor: colors.card, paddingVertical: space.sm },
  });
}
