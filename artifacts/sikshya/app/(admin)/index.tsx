import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/useColors";
import { useDates } from "@/context/DatePreferenceContext";
import { apiGet } from "@/utils/api";

/** The queue: what has been reported and is waiting for somebody. */

interface Ticket {
  id: number;
  /** The number the reporter quotes on the phone. */
  ref: string;
  reason: string;
  description: string;
  status: string;
  statusLabel: string;
  createdAt: string;
  sessionId: number | null;
  reporterName: string | null;
  reporterRole: string | null;
  assignedTo: number | null;
  assigneeName: string | null;
}

/**
 * How an agent narrows the queue.
 *
 * The owner's complaint about every list in this app lands here first: "I have only been
 * testing for less than a month and already my pages look overcrowded." A support queue gets
 * worse than any other list, because nothing ever leaves it.
 *
 * Two axes rather than one long row of states. What an agent actually asks is "what is still
 * waiting" and "what is mine" — not "show me everything that is currently assigned".
 */
const FILTERS = [
  { id: "active", label: "Waiting" },
  { id: "open", label: "New" },
  { id: "resolved", label: "Resolved" },
  { id: "denied", label: "Denied" },
] as const;

const WHOSE = [
  { id: "", label: "Everyone" },
  { id: "me", label: "Mine" },
  { id: "unassigned", label: "Nobody's" },
] as const;

export default function AdminTickets() {
  const colors = useColors();
  const dates = useDates();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("active");
  const [whose, setWhose] = useState<(typeof WHOSE)[number]["id"]>("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [counts, setCounts] = useState<{ openTickets: number; pendingTeachers: number; suspendedAccounts: number; known: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [list, overview] = await Promise.all([
        apiGet<{ tickets: Ticket[] }>(`/admin/tickets?status=${filter}&assigned=${whose}`),
        apiGet<{ openTickets: number; pendingTeachers: number; suspendedAccounts: number; known: boolean }>("/admin/overview"),
      ]);
      setTickets(list.tickets ?? []);
      setCounts(overview);
    } catch {
      // An empty queue and an unreachable server must not look the same to somebody whose job
      // is to notice that nothing is waiting.
      setFailed(true);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [filter, whose]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={colors.primary} />}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>Support</Text>

      {/*
        Can this server actually store a file?
        
        Here rather than at a URL, because the API takes a Bearer token the app holds and a
        browser tab has none — the owner was sent to open the endpoint directly and got
        "Missing or invalid Authorization header", which is the only thing it could ever have
        said. A button on a screen that is already signed in is the only version of this that
        works on a phone.
      */}
      <StorageCheck colors={colors} />

      {counts && (
        <View style={styles.stats}>
          <Stat label="Open tickets" value={counts.known ? counts.openTickets : "—"} colors={colors} />
          <Stat label="Teachers to review" value={counts.known ? counts.pendingTeachers : "—"} colors={colors} />
          <Stat label="Suspended" value={counts.known ? counts.suspendedAccounts : "—"} colors={colors} />
        </View>
      )}

      <View style={styles.filters}>
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <TouchableOpacity
              key={f.id}
              testID={`admin-filter-${f.id}`}
              onPress={() => setFilter(f.id)}
              activeOpacity={0.75}
              style={[styles.filter, { borderColor: active ? colors.secondary : colors.border, backgroundColor: active ? colors.secondary + "12" : colors.muted }]}
            >
              <Text style={[styles.filterText, { color: active ? colors.secondary : colors.mutedForeground }]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.filters}>
        {WHOSE.map((w) => {
          const active = whose === w.id;
          return (
            <TouchableOpacity
              key={w.id || "all"}
              testID={`admin-whose-${w.id || "all"}`}
              onPress={() => setWhose(w.id)}
              activeOpacity={0.75}
              style={[styles.filter, { borderColor: active ? colors.secondary : colors.border, backgroundColor: active ? colors.secondary + "12" : colors.muted }]}
            >
              <Text style={[styles.filterText, { color: active ? colors.secondary : colors.mutedForeground }]}>{w.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : failed ? (
        <Text style={[styles.empty, { color: colors.destructive }]}>
          The queue could not be loaded. This is not the same as it being empty — try again.
        </Text>
      ) : tickets.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>Nothing here.</Text>
      ) : (
        tickets.map((ticket) => (
          <TouchableOpacity
            key={ticket.id}
            testID={`admin-ticket-${ticket.id}`}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push(`/(admin)/ticket/${ticket.id}`)}
            activeOpacity={0.8}
          >
            <View style={styles.cardHead}>
              <Text style={[styles.reason, { color: colors.primary }]}>{ticket.reason}</Text>
              <Text style={[styles.when, { color: colors.mutedForeground }]}>
                {ticket.ref}
              </Text>
            </View>
            <Text style={[styles.body, { color: colors.foreground }]} numberOfLines={2}>{ticket.description}</Text>
            <View style={styles.cardFoot}>
              <Feather name="user" size={12} color={colors.mutedForeground} />
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {ticket.reporterName ?? "Unknown"}{ticket.reporterRole ? ` · ${ticket.reporterRole}` : ""}
                {` · ${dates.format(ticket.createdAt)}`}
              </Text>
              {ticket.sessionId !== null && (
                <View style={[styles.pill, { backgroundColor: colors.muted, marginLeft: 0 }]}>
                  <Text style={[styles.pillText, { color: colors.mutedForeground }]}>About a class</Text>
                </View>
              )}
              {/*
                The state, and who holds it. Both, because "somebody is on this" and "nobody has
                picked this up" are the two things an agent scanning a queue needs to tell apart.
              */}
              <View style={[styles.pill, { backgroundColor: colors.secondary + "14" }]}>
                <Text style={[styles.pillText, { color: colors.secondary }]} testID={`admin-ticket-status-${ticket.id}`}>
                  {ticket.assigneeName ? `${ticket.statusLabel} · ${ticket.assigneeName}` : ticket.statusLabel}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

interface CheckResult {
  ok: boolean;
  settings: Record<string, boolean>;
  completed: string[];
  bucket?: string;
  message?: string;
  failedAt?: string;
  code?: string;
  advice?: string;
  detail?: string;
  /** The address the server actually used — where a wrong setting shows itself. */
  endpoint?: string | null;
  /** Set when a setting had to be interpreted rather than taken as given. */
  note?: string | null;
}

/**
 * The file-storage check, on a button.
 *
 * It writes a small file, reads it back and deletes it, rather than reporting whether the
 * settings look present — every setting can be set and the API token still be read-only, which
 * is exactly far enough to pass a settings check and fail every upload somebody tries.
 *
 * Collapsed until asked. An agent working tickets does not need it; the owner needs it on the
 * one day uploads stop working.
 */
function StorageCheck({ colors }: { colors: ReturnType<typeof useColors> }) {
  const [result, setResult] = useState<CheckResult | null>(null);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setProblem(null);
    try {
      setResult(await apiGet<CheckResult>("/admin/storage/check"));
    } catch (e) {
      setResult(null);
      setProblem(e instanceof Error ? e.message : "The check could not be run.");
    } finally {
      setRunning(false);
    }
  };

  const missing = result ? Object.entries(result.settings).filter(([, set]) => !set).map(([k]) => k) : [];

  return (
    <View style={[styles.checkCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity
        testID="admin-storage-check"
        onPress={() => void run()}
        disabled={running}
        activeOpacity={0.8}
        style={styles.checkRow}
      >
        <Feather name="upload-cloud" size={16} color={colors.secondary} />
        <Text style={[styles.checkTitle, { color: colors.foreground }]}>
          {running ? "Checking file uploads…" : "Check file uploads"}
        </Text>
        {running ? <ActivityIndicator size="small" color={colors.secondary} /> : null}
      </TouchableOpacity>

      {problem ? (
        <Text style={[styles.checkBody, { color: colors.destructive }]}>{problem}</Text>
      ) : null}

      {result ? (
        <View style={{ gap: 6, marginTop: 8 }}>
          <Text
            testID="admin-storage-verdict"
            style={[styles.checkVerdict, { color: result.ok ? colors.success : colors.destructive }]}
          >
            {result.ok
              ? `Working — a file can be written, read back and deleted${result.bucket ? ` in "${result.bucket}"` : ""}.`
              : `Not working — it failed at "${result.failedAt}".`}
          </Text>

          {!result.ok && result.advice ? (
            <Text style={[styles.checkBody, { color: colors.foreground }]}>{result.advice}</Text>
          ) : null}

          {!result.ok && result.code ? (
            <Text style={[styles.checkMeta, { color: colors.mutedForeground }]}>
              Storage said: {result.code}
              {result.detail ? ` — ${result.detail}` : ""}
            </Text>
          ) : null}

          {/*
            What was corrected, if anything. A setting quietly interpreted and never mentioned
            is a typo that survives for months.
          */}
          {result.note ? (
            <Text style={[styles.checkBody, { color: colors.foreground }]} testID="admin-storage-note">
              {result.note}
            </Text>
          ) : null}

          {result.endpoint ? (
            <Text style={[styles.checkMeta, { color: colors.mutedForeground }]}>
              Using: {result.endpoint}
            </Text>
          ) : null}

          {/* Names only, never values: this screen must never become a place to read a secret. */}
          <Text style={[styles.checkMeta, { color: colors.mutedForeground }]}>
            {missing.length === 0
              ? "All storage settings are present."
              : `Not set: ${missing.join(", ")}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Stat({ label, value, colors }: { label: string; value: number | string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 12 },
  title: { fontSize: 24, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  checkCard: { borderRadius: 14, borderWidth: 1, padding: 12 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  checkVerdict: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  checkBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  checkMeta: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  stats: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 12, alignItems: "center", gap: 2 },
  statValue: { fontSize: 20, fontFamily: "Inter_600SemiBold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center" },
  filters: { flexDirection: "row", gap: 8, marginTop: 4 },
  filter: { flex: 1, alignItems: "center", borderRadius: 12, borderWidth: 1, paddingVertical: 9 },
  filterText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  empty: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 20, lineHeight: 20 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reason: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4 },
  when: { fontSize: 11, fontFamily: "Inter_400Regular" },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  cardFoot: { flexDirection: "row", alignItems: "center", gap: 6 },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  pill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginLeft: "auto" },
  cardDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  pillText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
});
