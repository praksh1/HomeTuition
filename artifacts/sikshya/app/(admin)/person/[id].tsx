import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/utils/api";
import { confirm, notify } from "@/utils/alerts";

/**
 * One person, and the four things an agent can do about them.
 *
 * Reset a password, review credentials, suspend, unsuspend — with what they have been doing
 * underneath, because every one of those decisions is made by looking at that.
 */

interface PersonDetail {
  user: {
    id: number; name: string; email: string; role: string; createdAt: string;
    suspendedAt: string | null; suspendedReason: string | null;
  };
  teacherProfile: { subject: string; bio: string | null; approvalStatus: string; rating: number; reviewCount: number } | null;
  activity: { known: boolean; rows: { id: number; action: string; subjectType: string | null; subjectId: number | null; createdAt: string }[] };
}

export default function AdminPerson() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<PersonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [resetCode, setResetCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<PersonDetail>(`/admin/users/${id}`));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const suspend = async () => {
    if (!reason.trim()) {
      notify("A reason is needed", "A suspension nobody can explain is one nobody can appeal.");
      return;
    }
    if (!(await confirm("Suspend this account?", "They will be signed out and told why.", "Suspend"))) return;
    try {
      await apiPost(`/admin/users/${id}/suspend`, { reason: reason.trim() });
      setReason("");
      await load();
      notify("Suspended", "They can no longer sign in.");
    } catch (e) {
      notify("Could not suspend", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const unsuspend = async () => {
    try {
      await apiPost(`/admin/users/${id}/unsuspend`, {});
      await load();
      notify("Restored", "They can sign in again.");
    } catch (e) {
      notify("Could not restore", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const issueReset = async () => {
    try {
      const res = await apiPost<{ code: string; expiresInMinutes: number }>(`/admin/users/${id}/password-reset`, {});
      setResetCode(res.code);
    } catch (e) {
      notify("Could not issue a code", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const decideCredentials = async (decision: "approved" | "rejected") => {
    if (decision === "rejected" && !note.trim()) {
      notify("Say why", "A rejection they cannot act on is one they will simply send again.");
      return;
    }
    try {
      await apiPost(`/admin/teachers/${id}/decision`, { decision, note: note.trim() || undefined });
      setNote("");
      await load();
      notify("Saved", "They have been told.");
    } catch (e) {
      notify("Could not save", e instanceof Error ? e.message : "Please try again.");
    }
  };

  if (loading) {
    return <View style={[styles.centre, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!data) {
    return (
      <View style={[styles.centre, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Text style={{ color: colors.mutedForeground }}>This record could not be loaded.</Text>
      </View>
    );
  }

  const { user, teacherProfile, activity } = data;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 60 }]}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>{user.name}</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>{user.email} · {user.role}</Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          Joined {new Date(user.createdAt).toLocaleDateString()}
        </Text>
        {user.suspendedAt ? (
          <Text style={[styles.meta, { color: colors.destructive }]}>
            Suspended {new Date(user.suspendedAt).toLocaleString()} — {user.suspendedReason}
          </Text>
        ) : null}
        {teacherProfile && (
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {teacherProfile.subject} · credentials {teacherProfile.approvalStatus} · {teacherProfile.rating.toFixed(1)}★ from {teacherProfile.reviewCount}
          </Text>
        )}
      </View>

      {teacherProfile && teacherProfile.approvalStatus === "pending" && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Credentials</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>{teacherProfile.bio ?? "No description given."}</Text>
          <TextInput
            testID="admin-credential-note"
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            placeholder="If rejecting, say what they need to fix"
            placeholderTextColor={colors.mutedForeground}
            value={note}
            onChangeText={setNote}
            multiline
            textAlignVertical="top"
          />
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.action, { borderColor: colors.border }]} onPress={() => void decideCredentials("rejected")} activeOpacity={0.8}>
              <Text style={[styles.actionText, { color: colors.foreground }]}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="admin-approve-credentials" style={[styles.action, { backgroundColor: colors.success, borderColor: colors.success }]} onPress={() => void decideCredentials("approved")} activeOpacity={0.8}>
              <Text style={[styles.actionText, { color: "#fff" }]}>Approve</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Password</Text>
        <Text style={[styles.caveat, { color: colors.mutedForeground }]}>
          You never see or set their password. This gives you a code to read out; they choose
          the password themselves.
        </Text>
        {resetCode ? (
          <View style={[styles.codeBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Text testID="admin-reset-code" style={[styles.code, { color: colors.foreground }]}>{resetCode}</Text>
            <Text style={[styles.caveat, { color: colors.mutedForeground }]}>
              Valid for 30 minutes, once. It is not shown again.
            </Text>
          </View>
        ) : (
          <TouchableOpacity testID="admin-issue-reset" style={[styles.action, { borderColor: colors.border }]} onPress={() => void issueReset()} activeOpacity={0.8}>
            <Text style={[styles.actionText, { color: colors.foreground }]}>Issue a reset code</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Account</Text>
        {user.suspendedAt ? (
          <TouchableOpacity testID="admin-unsuspend" style={[styles.action, { backgroundColor: colors.success, borderColor: colors.success }]} onPress={() => void unsuspend()} activeOpacity={0.8}>
            <Text style={[styles.actionText, { color: "#fff" }]}>Lift the suspension</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TextInput
              testID="admin-suspend-reason"
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="Why is this account being suspended?"
              placeholderTextColor={colors.mutedForeground}
              value={reason}
              onChangeText={setReason}
              multiline
              textAlignVertical="top"
            />
            <TouchableOpacity testID="admin-suspend" style={[styles.action, { backgroundColor: colors.destructive, borderColor: colors.destructive }]} onPress={() => void suspend()} activeOpacity={0.8}>
              <Text style={[styles.actionText, { color: "#fff" }]}>Suspend this account</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>What they have been doing</Text>
        {!activity.known ? (
          <Text style={[styles.meta, { color: colors.destructive }]}>
            The log could not be read. That is not the same as nothing having happened.
          </Text>
        ) : activity.rows.length === 0 ? (
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>Nothing recorded.</Text>
        ) : (
          activity.rows.slice(0, 40).map((row) => (
            <Text key={row.id} style={[styles.meta, { color: colors.mutedForeground }]}>
              {new Date(row.createdAt).toLocaleString()} — {row.action}
              {row.subjectType ? ` (${row.subjectType} ${row.subjectId})` : ""}
            </Text>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 14 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  caveat: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, fontStyle: "italic" },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 70, fontSize: 14, fontFamily: "Inter_400Regular" },
  actions: { flexDirection: "row", gap: 10 },
  action: { flex: 1, alignItems: "center", borderRadius: 12, borderWidth: 1, paddingVertical: 12 },
  actionText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  codeBox: { borderRadius: 12, borderWidth: 1, padding: 14, alignItems: "center", gap: 6 },
  code: { fontSize: 30, fontFamily: "Inter_600SemiBold", letterSpacing: 6 },
});
