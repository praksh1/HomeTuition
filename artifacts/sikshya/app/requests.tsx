import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useDates } from "@/context/DatePreferenceContext";
import { apiGet } from "@/utils/api";
import { STATUS_TONE, type Ticket, type Allowance } from "@/utils/tickets";

/**
 * Everything this person has reported, and what has happened to it.
 *
 * This screen exists because of one sentence from the owner: "a user can create several
 * hundred requests without knowing the status of their requests/issues." Filing a report used
 * to be the end of it — the words went to the server and nothing ever came back, so the only
 * way to chase an answer was to file another one.
 *
 * So the two things this has to show, above anything else, are the number to quote and the
 * state each request is in. Everything else is detail.
 */
export default function MyRequestsScreen() {
  const colors = useColors();
  const dates = useDates();
  const insets = useSafeAreaInsets();

  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ tickets: Ticket[]; allowance: Allowance }>("/disputes/mine");
      setTickets(data.tickets ?? []);
      setAllowance(data.allowance ?? null);
      setProblem(null);
    } catch (e) {
      setTickets([]);
      setProblem(e instanceof Error ? e.message : "We could not load your requests.");
    }
  }, []);

  // Reloaded on focus rather than once on mount: somebody arriving here from a notification
  // has come to see a status that changed, and a cached list would show them the old one.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /**
   * Open requests first.
   *
   * Somebody with a dozen finished reports and one live one is here about the live one, and
   * making them scroll past their own history to find it is the small version of the same
   * complaint this screen answers.
   */
  const open = (tickets ?? []).filter((t) => !["resolved", "denied", "cancelled"].includes(t.status));
  const closed = (tickets ?? []).filter((t) => ["resolved", "denied", "cancelled"].includes(t.status));

  const row = (ticket: Ticket) => {
    const tone = STATUS_TONE[ticket.status] ?? "waiting";
    const tint =
      tone === "done" ? colors.success
      : tone === "refused" ? colors.destructive
      : tone === "working" ? colors.secondary
      : colors.mutedForeground;

    return (
      <TouchableOpacity
        key={ticket.id}
        testID={`request-row-${ticket.id}`}
        activeOpacity={0.75}
        onPress={() => router.push(`/request/${ticket.id}`)}
        style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={styles.rowTop}>
          <Text style={[styles.ref, { color: colors.mutedForeground }]}>{ticket.ref}</Text>
          <View style={[styles.pill, { backgroundColor: `${tint}1a`, borderColor: tint }]}>
            <Text style={[styles.pillText, { color: tint }]} testID={`request-status-${ticket.id}`}>
              {ticket.statusLabel}
            </Text>
          </View>
        </View>
        <Text style={[styles.reason, { color: colors.foreground }]} numberOfLines={1}>{ticket.reason}</Text>
        <Text style={[styles.summary, { color: colors.mutedForeground }]} numberOfLines={2}>
          {ticket.description}
        </Text>
        <Text style={[styles.when, { color: colors.mutedForeground }]}>
          Sent {dates.format(ticket.createdAt, { withTime: true })}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 60 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        {router.canGoBack() ? (
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} testID="requests-back-btn">
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
        ) : <View style={{ width: 22 }} />}
        <Text style={[styles.title, { color: colors.foreground }]}>My Requests</Text>
        <View style={{ width: 22 }} />
      </View>

      {tickets === null ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.secondary} />
      ) : (
        <>
          {problem ? (
            <Text style={[styles.problem, { color: colors.destructive }]}>{problem}</Text>
          ) : null}

          {tickets.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="inbox" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nothing reported yet</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                If something goes wrong with a class or a payment, tell us and you can follow the
                answer here.
              </Text>
            </View>
          ) : null}

          {open.length > 0 ? (
            <>
              <Text style={[styles.section, { color: colors.mutedForeground }]}>Still open</Text>
              {open.map(row)}
            </>
          ) : null}

          {closed.length > 0 ? (
            <>
              <Text style={[styles.section, { color: colors.mutedForeground }]}>Finished</Text>
              {closed.map(row)}
            </>
          ) : null}

          {/*
            The limit, shown where somebody can see it before they meet it.
            A rule you only find out about at the moment it refuses you reads as a fault.
          */}
          {allowance ? (
            <Text style={[styles.allowance, { color: colors.mutedForeground }]} testID="request-allowance">
              {allowance.remaining > 0
                ? `You can send ${allowance.remaining} more ${allowance.remaining === 1 ? "request" : "requests"} today.`
                : allowance.reason ?? "You have used all of today's requests."}
            </Text>
          ) : null}

          <TouchableOpacity
            testID="requests-new-btn"
            activeOpacity={0.85}
            onPress={() => router.push("/support")}
            style={[styles.newBtn, { backgroundColor: colors.secondary }]}
          >
            <Feather name="plus" size={16} color="#fff" />
            <Text style={styles.newBtnText}>Report something</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 18 },
  section: { fontFamily: "Inter_600SemiBold", fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", marginTop: 18, marginBottom: 8 },
  row: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  ref: { fontFamily: "Inter_600SemiBold", fontSize: 12, letterSpacing: 0.5 },
  pill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  reason: { fontFamily: "Inter_600SemiBold", fontSize: 15, marginBottom: 2 },
  summary: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  when: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 6 },
  empty: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
  emptyBody: { fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center", lineHeight: 19, maxWidth: 300 },
  problem: { fontFamily: "Inter_400Regular", fontSize: 13, marginBottom: 12 },
  allowance: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 18, lineHeight: 18 },
  newBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 13, marginTop: 14 },
  newBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" },
});
