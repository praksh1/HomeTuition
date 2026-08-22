import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/utils/api";

/** The queue: what has been reported and is waiting for somebody. */

interface Ticket {
  id: number;
  reason: string;
  description: string;
  status: "open" | "in_review" | "resolved";
  createdAt: string;
  sessionId: number | null;
  reporterName: string | null;
  reporterRole: string | null;
}

const FILTERS = [
  { id: "open", label: "Open" },
  { id: "in_review", label: "In review" },
  { id: "resolved", label: "Resolved" },
] as const;

export default function AdminTickets() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("open");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [counts, setCounts] = useState<{ openTickets: number; pendingTeachers: number; suspendedAccounts: number; known: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [list, overview] = await Promise.all([
        apiGet<{ tickets: Ticket[] }>(`/admin/tickets?status=${filter}`),
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
  }, [filter]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={colors.primary} />}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>Support</Text>

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
                {new Date(ticket.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <Text style={[styles.body, { color: colors.foreground }]} numberOfLines={2}>{ticket.description}</Text>
            <View style={styles.cardFoot}>
              <Feather name="user" size={12} color={colors.mutedForeground} />
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {ticket.reporterName ?? "Unknown"}{ticket.reporterRole ? ` · ${ticket.reporterRole}` : ""}
              </Text>
              {ticket.sessionId !== null && (
                <View style={[styles.pill, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.pillText, { color: colors.mutedForeground }]}>About a class</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
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
  pillText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
});
