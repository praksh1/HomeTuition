import { Feather } from "@expo/vector-icons";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/utils/api";
import { notify } from "@/utils/alerts";

/**
 * Money the platform owes people.
 *
 * **This screen is the payment system.** There is no provider wired up — see REFUNDS.md — so
 * every row here is a debt an agent settles by hand and then records, and "Mark paid" is a
 * person saying they did it rather than the app saying it happened. Worth stating plainly on
 * the screen as well as in the code, so nobody using it is confused about which it is.
 *
 * The reference is required for the same reason a suspension needs a reason: a refund marked
 * paid with nothing to point at cannot be told apart from one that was never paid, and the
 * student asking about it next week has to be answerable.
 */

interface Refund {
  id: number;
  sessionId: number;
  studentId: number;
  studentName: string | null;
  studentEmail: string | null;
  topic: string | null;
  sessionDate: string | null;
  pricePaid: number;
  amount: number;
  teacherShare: number;
  platformShare: number;
  reason: string;
  status: string;
  note: string | null;
  requestedAt: string;
  paidAt: string | null;
}

/** Why the money is going back, in words rather than a database value. */
const WHY: Record<string, string> = {
  schedule_change: "The teacher moved the class",
  teacher_cancelled: "The teacher cancelled the class",
  student_drop: "The student dropped the class",
  agent_discretion: "Granted by an agent",
};

const FILTERS = [
  { id: "owed", label: "To pay" },
  { id: "paid", label: "Settled" },
  { id: "all", label: "All" },
] as const;

export default function AdminRefunds() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("owed");
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [totalOwed, setTotalOwed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [references, setReferences] = useState<Record<number, string>>({});
  const [working, setWorking] = useState<number | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await apiGet<{ refunds: Refund[]; totalOwed: number; known: boolean }>(
        `/admin/refunds?status=${filter}`,
      );
      if (!res.known) throw new Error("unreadable");
      setRefunds(res.refunds ?? []);
      setTotalOwed(res.totalOwed ?? 0);
    } catch {
      // "Nothing to pay" and "we could not look" must never look the same to the person whose
      // job is to notice that money is waiting.
      setFailed(true);
      setRefunds([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const markPaid = async (refund: Refund) => {
    const reference = (references[refund.id] ?? "").trim();
    if (!reference) {
      notify(
        "A reference is needed",
        "Record the transaction id or receipt number. A refund marked paid with nothing to " +
          "point at cannot be told apart from one that was never paid.",
      );
      return;
    }
    setWorking(refund.id);
    try {
      await apiPost(`/admin/refunds/${refund.id}/paid`, { reference });
      setReferences((prev) => ({ ...prev, [refund.id]: "" }));
      notify("Recorded", `NPR ${refund.amount.toLocaleString()} marked paid against ${reference}.`);
      await load();
    } catch (e) {
      notify("Not recorded", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setWorking(null);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={colors.primary} />}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>Refunds</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Nothing here moves money. Each of these is paid by hand and then recorded, so students
        are told a refund is <Text style={{ fontFamily: "Inter_600SemiBold" }}>requested</Text> and
        takes 5-7 business days.
      </Text>

      <View style={[styles.total, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.totalValue, { color: colors.foreground }]} testID="admin-refunds-total">
          {failed ? "—" : `NPR ${totalOwed.toLocaleString()}`}
        </Text>
        <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>still to pay out</Text>
      </View>

      <View style={styles.filters}>
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <TouchableOpacity
              key={f.id}
              testID={`admin-refunds-filter-${f.id}`}
              onPress={() => setFilter(f.id)}
              activeOpacity={0.75}
              style={[styles.filter, {
                borderColor: active ? colors.secondary : colors.border,
                backgroundColor: active ? colors.secondary + "12" : colors.muted,
              }]}
            >
              <Text style={[styles.filterText, { color: active ? colors.secondary : colors.mutedForeground }]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : failed ? (
        <Text style={[styles.empty, { color: colors.destructive }]}>
          The queue could not be loaded. This is not the same as nothing being owed — try again.
        </Text>
      ) : refunds.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>Nothing here.</Text>
      ) : (
        refunds.map((refund) => (
          <View
            key={refund.id}
            testID={`admin-refund-${refund.id}`}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.cardHead}>
              <Text style={[styles.amount, { color: colors.foreground }]}>
                NPR {refund.amount.toLocaleString()}
              </Text>
              <View style={[styles.pill, {
                backgroundColor: refund.status === "paid" ? colors.success + "15" : colors.muted,
              }]}>
                <Text style={[styles.pillText, {
                  color: refund.status === "paid" ? colors.success : colors.mutedForeground,
                }]}>
                  {refund.status === "paid" ? "Paid" : "To pay"}
                </Text>
              </View>
            </View>

            <Text style={[styles.who, { color: colors.foreground }]}>
              {refund.studentName ?? `Student #${refund.studentId}`}
            </Text>
            {refund.studentEmail ? (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{refund.studentEmail}</Text>
            ) : null}
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {refund.topic ?? `Class #${refund.sessionId}`}
              {refund.sessionDate ? ` · ${new Date(refund.sessionDate).toLocaleDateString()}` : ""}
            </Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {WHY[refund.reason] ?? refund.reason} · paid NPR {refund.pricePaid.toLocaleString()}
              {refund.teacherShare > 0 || refund.platformShare > 0
                ? ` · cancellation fee NPR ${(refund.teacherShare + refund.platformShare).toLocaleString()}`
                : ""}
            </Text>
            {refund.note ? (
              <Text style={[styles.note, { color: colors.mutedForeground }]}>“{refund.note}”</Text>
            ) : null}

            {refund.status === "paid" ? (
              <Text style={[styles.meta, { color: colors.success }]}>
                Settled {refund.paidAt ? new Date(refund.paidAt).toLocaleString() : ""}
              </Text>
            ) : (
              <View style={styles.payRow}>
                <TextInput
                  testID={`admin-refund-reference-${refund.id}`}
                  style={[styles.input, {
                    color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background,
                  }]}
                  placeholder="Transaction id or receipt number"
                  placeholderTextColor={colors.mutedForeground}
                  value={references[refund.id] ?? ""}
                  onChangeText={(text) => setReferences((prev) => ({ ...prev, [refund.id]: text }))}
                />
                <TouchableOpacity
                  testID={`admin-refund-paid-${refund.id}`}
                  onPress={() => void markPaid(refund)}
                  disabled={working === refund.id}
                  activeOpacity={0.85}
                  style={[styles.payBtn, {
                    backgroundColor: colors.primary, opacity: working === refund.id ? 0.6 : 1,
                  }]}
                >
                  <Feather name="check" size={16} color="#fff" />
                  <Text style={styles.payBtnText}>Mark paid</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 12 },
  title: { fontSize: 24, fontFamily: "Inter_600SemiBold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  total: { borderRadius: 14, borderWidth: 1, padding: 14, alignItems: "center", gap: 2 },
  totalValue: { fontSize: 22, fontFamily: "Inter_600SemiBold" },
  totalLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  filters: { flexDirection: "row", gap: 8, marginTop: 4 },
  filter: { flex: 1, alignItems: "center", borderRadius: 12, borderWidth: 1, paddingVertical: 9 },
  filterText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  empty: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 20, lineHeight: 20 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 5 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  amount: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  who: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  note: { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic", lineHeight: 17 },
  pill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  payRow: { flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 42, fontSize: 13, fontFamily: "Inter_400Regular" },
  payBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, paddingHorizontal: 14, height: 42 },
  payBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
