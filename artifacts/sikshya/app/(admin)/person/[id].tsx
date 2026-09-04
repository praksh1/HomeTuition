import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/utils/api";
import { confirm, notify } from "@/utils/alerts";
import { openAttachment } from "@/utils/openAttachment";

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
  emailVerified: boolean;
  credentials: {
    id: number; documentType: string; fileKey: string; originalName: string;
    status: string; rejectionReason: string | null;
  }[];
  activity: { known: boolean; rows: { id: number; action: string; subjectType: string | null; subjectId: number | null; createdAt: string }[] };
  /**
   * Temporary permission to teach without paying.
   *
   * `enabled` is the server's kill switch, carried so the screen can say *why* the control is
   * unavailable instead of hiding it. `grant` is null unless one is live right now.
   */
  testAccess?: {
    enabled: boolean;
    grant: { id: number; tier: string; reason: string; grantedAt: string; validUntil: string } | null;
  };
  /**
   * Temporary permission to book a test class without paying. The student-side companion.
   *
   * Same shape, separate switch: the teaching one governs whether test *classes* can be created,
   * this one whether they can be *booked* for free.
   */
  testStudentAccess?: {
    enabled: boolean;
    grant: { id: number; reason: string; grantedAt: string; validUntil: string } | null;
  };
}

/**
 * What both decision endpoints return about reaching the teacher.
 *
 * `message` is the operator-facing sentence, composed on the server so there is one copy of it.
 * Optional because an older deployment answering a newer app would omit it — the screen then
 * falls back to the decision alone rather than inventing a delivery claim.
 */
interface DecisionResult {
  notified?: { email: "sent" | "failed" | "not_configured"; inApp: boolean; message: string };
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
  const [grantReason, setGrantReason] = useState("");
  const [studentGrantReason, setStudentGrantReason] = useState("");

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

  /*
    Both confirmations below name the decision that was actually made and then quote the server's
    own account of whether the teacher was reached.

    They used to say "Saved" / "They have been told." — a claim the screen was in no position to
    make. The email was fired and its result discarded, and on a server with no mail provider
    configured nothing was sent at all. `notified.message` comes from `deliveryLine()` on the
    server, which distinguishes delivered, failed, and never-configured.
  */
  const decideCredentials = async (decision: "approved" | "rejected") => {
    if (decision === "rejected" && !note.trim()) {
      notify("Say why", "A rejection they cannot act on is one they will simply send again.");
      return;
    }
    try {
      const res = await apiPost<DecisionResult>(`/admin/teachers/${id}/decision`, {
        decision,
        note: note.trim() || undefined,
      });
      setNote("");
      await load();
      notify(
        decision === "approved" ? "Teacher access approved." : "Teacher access refused.",
        res.notified?.message ?? "The decision was saved.",
      );
    } catch (e) {
      notify("Could not save", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const grantTestAccess = async () => {
    if (!grantReason.trim()) {
      notify("Say why", "An unexplained grant cannot be audited later.");
      return;
    }
    try {
      await apiPost(`/admin/teachers/${id}/test-access`, {
        tier: "base", reason: grantReason.trim(), days: 7,
      });
      setGrantReason("");
      await load();
      notify("Test access granted.", "Seven days, Base allowance. No payment was processed.");
    } catch (e) {
      notify("Could not grant test access", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const revokeTestAccess = async () => {
    if (!(await confirm("End test access?", "They will need a paid plan to create classes again.", "End it"))) return;
    try {
      await apiPost(`/admin/teachers/${id}/test-access/revoke`, {});
      await load();
      notify("Test access ended.", "It stops applying on their next action.");
    } catch (e) {
      notify("Could not end test access", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const grantStudentTestAccess = async () => {
    if (!studentGrantReason.trim()) {
      notify("Say why", "An unexplained grant cannot be audited later.");
      return;
    }
    try {
      await apiPost(`/admin/students/${id}/test-access`, { reason: studentGrantReason.trim(), days: 7 });
      setStudentGrantReason("");
      await load();
      notify("Test booking access granted.", "Seven days. No payment will be processed for test classes.");
    } catch (e) {
      notify("Could not grant test booking access", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const revokeStudentTestAccess = async () => {
    if (!(await confirm("End test booking access?", "They will pay for every class from now on.", "End it"))) return;
    try {
      await apiPost(`/admin/students/${id}/test-access/revoke`, {});
      await load();
      notify("Test booking access ended.", "It stops applying on their next booking.");
    } catch (e) {
      notify("Could not end test booking access", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const decideDocument = async (credentialId: number, decision: "approved" | "rejected") => {
    if (decision === "rejected" && !note.trim()) {
      notify("Say what is wrong", "The teacher needs a specific reason before the upload can be reopened.");
      return;
    }
    try {
      const res = await apiPost<DecisionResult>(`/admin/teacher-credentials/${credentialId}/decision`, {
        decision,
        reason: decision === "rejected" ? note.trim() : undefined,
      });
      setNote("");
      await load();
      // "Document review saved", never "approved": accepting a document for Sikshya's check is
      // not approval of the teacher's account, and the operator screen is where that distinction
      // has to be visible first.
      notify("Document review saved.", res.notified?.message ?? "The decision was saved.");
    } catch (error) {
      notify("Could not save", error instanceof Error ? error.message : "Please try again.");
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

  const { user, teacherProfile, activity, credentials } = data;
  const grant = data.testAccess?.grant ?? null;
  const studentGrant = data.testStudentAccess?.grant ?? null;

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
        <Text style={[styles.meta, { color: data.emailVerified ? colors.success : colors.warn }]}>
          Email {data.emailVerified ? "verified" : "not verified"}
        </Text>
      </View>

      {teacherProfile && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Credentials</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>{teacherProfile.bio ?? "No description given."}</Text>
          {credentials.length === 0 ? (
            <Text style={[styles.meta, { color: colors.destructive }]}>No identity document has been submitted.</Text>
          ) : credentials.map((credential) => (
            <View key={credential.id} style={[styles.document, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <TouchableOpacity onPress={() => void openAttachment(credential.fileKey)} activeOpacity={0.7} style={styles.documentNameRow}>
                <Feather name="file-text" size={16} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.actionText, { color: colors.primary }]}>{credential.documentType.replaceAll("_", " ")}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>{credential.originalName}</Text>
                </View>
                <Text style={[styles.meta, { color: credential.status === "rejected" ? colors.destructive : credential.status === "approved" ? colors.success : colors.warn }]}>{credential.status}</Text>
              </TouchableOpacity>
              {credential.rejectionReason && <Text style={[styles.meta, { color: colors.destructive }]}>{credential.rejectionReason}</Text>}
              {(credential.status === "submitted" || credential.status === "opened") && (
                <View style={styles.actions}>
                  <TouchableOpacity style={[styles.action, { borderColor: colors.destructive }]} onPress={() => void decideDocument(credential.id, "rejected")} activeOpacity={0.8}>
                    <Text style={[styles.actionText, { color: colors.destructive }]}>Reject document</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.action, { backgroundColor: colors.success, borderColor: colors.success }]} onPress={() => void decideDocument(credential.id, "approved")} activeOpacity={0.8}>
                    <Text style={[styles.actionText, { color: colors.successForeground }]}>Approve document</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
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
          {teacherProfile.approvalStatus !== "approved" && <View style={styles.actions}>
            <TouchableOpacity style={[styles.action, { borderColor: colors.border }]} onPress={() => void decideCredentials("rejected")} activeOpacity={0.8}>
              <Text style={[styles.actionText, { color: colors.foreground }]}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="admin-approve-credentials" style={[styles.action, { backgroundColor: colors.success, borderColor: colors.success }]} onPress={() => void decideCredentials("approved")} activeOpacity={0.8}>
              <Text style={[styles.actionText, { color: "#fff" }]}>Approve</Text>
            </TouchableOpacity>
          </View>}
        </View>
      )}

      {/*
        Temporary test access.

        Only rendered for a teacher, and the controls only go live once the account is approved and
        its email verified — because those are exactly what the grant does *not* skip. The server
        re-checks both when the row is written; this only stops the screen offering something it
        already knows will be refused.
      */}
      {teacherProfile && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Test teaching access</Text>
          <Text style={[styles.caveat, { color: colors.mutedForeground }]}>
            Lets this teacher create classes without paying for a plan. It skips payment and nothing
            else, it still obeys the tier&apos;s session limit, and it ends by itself on the date shown.
            No payment is recorded and nothing appears as revenue.
          </Text>

          {!data.testAccess?.enabled ? (
            <Text style={[styles.meta, { color: colors.warn }]}>
              Switched off on this server. ALLOW_TEST_TEACHING_ACCESS must be set on the API before
              grants work.
            </Text>
          ) : grant ? (
            <>
              <View style={[styles.codeBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Text testID="admin-test-access-active" style={[styles.actionText, { color: colors.foreground }]}>
                  Active until {new Date(grant.validUntil).toLocaleString()}
                </Text>
                <Text style={[styles.caveat, { color: colors.mutedForeground }]}>
                  {grant.tier} allowance · {grant.reason}
                </Text>
              </View>
              <TouchableOpacity
                testID="admin-revoke-test-access"
                style={[styles.action, { borderColor: colors.destructive }]}
                onPress={() => void revokeTestAccess()}
                activeOpacity={0.8}
              >
                <Text style={[styles.actionText, { color: colors.destructive }]}>End test access now</Text>
              </TouchableOpacity>
            </>
          ) : teacherProfile.approvalStatus !== "approved" || !data.emailVerified ? (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              Available once the account is approved and its email verified. Test access does not
              skip either of those.
            </Text>
          ) : (
            <>
              <TextInput
                testID="admin-test-access-reason"
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                placeholder="Why does this account need test access?"
                placeholderTextColor={colors.mutedForeground}
                value={grantReason}
                onChangeText={setGrantReason}
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity
                testID="admin-grant-test-access"
                style={[styles.action, { borderColor: colors.border }]}
                onPress={() => void grantTestAccess()}
                activeOpacity={0.8}
              >
                <Text style={[styles.actionText, { color: colors.foreground }]}>
                  Give 7 days of test access (Base allowance)
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/*
        Test booking access — the student-side companion, and only ever on a student's record.

        The same shape as the teaching card above on purpose: an operator moving between the two
        should not have to learn a second control. The eligibility rules the server enforces are
        stated here rather than hidden, so a refusal is never a surprise.
      */}
      {user.role === "student" && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Test booking access</Text>
          <Text style={[styles.caveat, { color: colors.mutedForeground }]}>
            Lets this student book a class that a teacher created under test teaching access, without
            paying. It works on those classes only — every other class is paid for in full, by them
            and by everyone else. Nothing is recorded as revenue and no refund can be claimed against
            it. It ends by itself on the date shown.
          </Text>

          {!data.testStudentAccess?.enabled ? (
            <Text style={[styles.meta, { color: colors.warn }]}>
              Switched off on this server. ALLOW_TEST_STUDENT_ACCESS must be set on the API before
              grants work.
            </Text>
          ) : studentGrant ? (
            <>
              <View style={[styles.codeBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Text testID="admin-student-test-active" style={[styles.actionText, { color: colors.foreground }]}>
                  Active until {new Date(studentGrant.validUntil).toLocaleString()}
                </Text>
                <Text style={[styles.caveat, { color: colors.mutedForeground }]}>
                  Granted {new Date(studentGrant.grantedAt).toLocaleString()} · {studentGrant.reason}
                </Text>
              </View>
              <TouchableOpacity
                testID="admin-revoke-student-test"
                style={[styles.action, { borderColor: colors.destructive }]}
                onPress={() => void revokeStudentTestAccess()}
                accessibilityRole="button"
                accessibilityLabel="End this student's test booking access now"
                activeOpacity={0.8}
              >
                <Text style={[styles.actionText, { color: colors.destructive }]}>End test booking access now</Text>
              </TouchableOpacity>
            </>
          ) : !data.emailVerified || user.suspendedAt ? (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {user.suspendedAt
                ? "Not available while this account is suspended. Lift the suspension first."
                : "Available once this account's email is verified. Test access does not skip that."}
            </Text>
          ) : (
            <>
              <TextInput
                testID="admin-student-test-reason"
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                placeholder="Why does this account need test booking access?"
                placeholderTextColor={colors.mutedForeground}
                value={studentGrantReason}
                onChangeText={setStudentGrantReason}
                accessibilityLabel="Reason for granting test booking access"
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity
                testID="admin-grant-student-test"
                style={[styles.action, { borderColor: colors.border }]}
                onPress={() => void grantStudentTestAccess()}
                accessibilityRole="button"
                accessibilityLabel="Give this student seven days of test booking access"
                activeOpacity={0.8}
              >
                <Text style={[styles.actionText, { color: colors.foreground }]}>
                  Give 7 days of test booking access
                </Text>
              </TouchableOpacity>
              <Text style={[styles.caveat, { color: colors.mutedForeground }]}>
                The server checks again before it writes the grant: verified email, finished
                onboarding, and an account in good standing.
              </Text>
            </>
          )}
        </View>
      )}

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Password</Text>
        <Text style={[styles.caveat, { color: colors.mutedForeground }]}>
          The normal path is the Forgot password link on sign-in, which emails the account owner.
          Use this assisted code only while actively helping someone who cannot receive that email.
          You never see or set their password.
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
            <Text style={[styles.actionText, { color: colors.foreground }]}>Assisted reset (phone support)</Text>
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
  document: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  documentNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
});
