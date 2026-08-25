import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { confirm, notify } from "@/utils/alerts";
import { useColors } from "@/hooks/useColors";
import { useDates } from "@/context/DatePreferenceContext";
import { apiGet, apiPost, attachmentUrl } from "@/utils/api";
import { STATUS_TONE, type Ticket, type TicketEvent } from "@/utils/tickets";

interface RequestDetail {
  ticket: Ticket;
  history: TicketEvent[];
  canCancel: boolean;
}

/**
 * One request, and everything that has happened to it.
 *
 * The trail is the point. A single word that changes when somebody happens to look tells the
 * reporter nothing about whether their problem is being dealt with — so every move an agent
 * makes is written down as it happens, and this is where the person who reported it reads it.
 *
 * Internal notes between agents never reach here. That is decided on the server, not by
 * leaving them off the screen: see lib/ticketStore.ts.
 */
export default function RequestScreen() {
  const colors = useColors();
  const dates = useDates();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await apiGet<RequestDetail>(`/disputes/${id}`));
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "We could not load this request.");
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const withdraw = async () => {
    const sure = await confirm(
      "Withdraw this request?",
      "We will stop working on it. You can always send a new one.",
    );
    if (!sure) return;
    setBusy(true);
    try {
      setDetail(await apiPost<RequestDetail>(`/disputes/${id}/cancel`, {}));
    } catch (e) {
      notify("Could not withdraw", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (key: string) => {
    try {
      const url = await attachmentUrl(key);
      await Linking.openURL(url);
    } catch {
      notify("Could not open", "We could not open that file. Please try again in a moment.");
    }
  };

  if (problem) {
    return (
      <View style={[styles.centre, { backgroundColor: colors.background }]}>
        <Text style={[styles.problem, { color: colors.mutedForeground }]}>{problem}</Text>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={[styles.link, { color: colors.secondary }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={[styles.centre, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.secondary} />
      </View>
    );
  }

  const { ticket, history, canCancel } = detail;
  const tone = STATUS_TONE[ticket.status] ?? "waiting";
  const tint =
    tone === "done" ? colors.success
    : tone === "refused" ? colors.destructive
    : tone === "working" ? colors.secondary
    : colors.mutedForeground;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 60 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} testID="request-back-btn">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.ref, { color: colors.foreground }]} testID="request-ref">{ticket.ref}</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={[styles.statusCard, { backgroundColor: `${tint}12`, borderColor: tint }]}>
        <Text style={[styles.statusLabel, { color: tint }]} testID="request-status">{ticket.statusLabel}</Text>
        <Text style={[styles.statusExplains, { color: colors.foreground }]}>{ticket.statusExplains}</Text>
      </View>

      {/*
        The decision, lifted out of the trail.
        Somebody who opens a finished request is here for this sentence and nothing else.
      */}
      {ticket.resolution ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>What was decided</Text>
          <Text style={[styles.body, { color: colors.foreground }]} testID="request-resolution">
            {ticket.resolution}
          </Text>
        </View>
      ) : null}

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>What you told us</Text>
        <Text style={[styles.reason, { color: colors.foreground }]}>{ticket.reason}</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>{ticket.description}</Text>
        <Text style={[styles.when, { color: colors.mutedForeground }]}>
          Sent {dates.format(ticket.createdAt, { withTime: true })}
        </Text>
      </View>

      <Text style={[styles.section, { color: colors.mutedForeground }]}>Progress</Text>
      <View style={styles.timeline}>
        {history.map((event, i) => (
          <View key={event.id} style={styles.event} testID={`request-event-${event.status}`}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: i === history.length - 1 ? tint : colors.border }]} />
              {i < history.length - 1 ? <View style={[styles.line, { backgroundColor: colors.border }]} /> : null}
            </View>
            <View style={styles.eventBody}>
              <Text style={[styles.eventLabel, { color: colors.foreground }]}>{event.label}</Text>
              <Text style={[styles.eventWhen, { color: colors.mutedForeground }]}>
                {dates.format(event.at, { withTime: true })}
                {event.by ? ` · ${event.by}` : ""}
              </Text>
              {event.note ? (
                <Text style={[styles.eventNote, { color: colors.foreground }]}>{event.note}</Text>
              ) : null}
              {event.fileKey ? (
                <TouchableOpacity
                  onPress={() => openFile(event.fileKey!)}
                  activeOpacity={0.7}
                  style={styles.fileRow}
                  testID="request-event-file"
                >
                  <Feather name="paperclip" size={13} color={colors.secondary} />
                  <Text style={[styles.link, { color: colors.secondary }]}>Supporting document</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {canCancel ? (
        <TouchableOpacity
          testID="request-withdraw-btn"
          activeOpacity={0.85}
          disabled={busy}
          onPress={withdraw}
          style={[styles.withdraw, { borderColor: colors.border, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={[styles.withdrawText, { color: colors.mutedForeground }]}>Withdraw this request</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  ref: { fontFamily: "Inter_600SemiBold", fontSize: 16, letterSpacing: 0.5 },
  statusCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 14 },
  statusLabel: { fontFamily: "Inter_600SemiBold", fontSize: 15, marginBottom: 4 },
  statusExplains: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 14 },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8 },
  reason: { fontFamily: "Inter_600SemiBold", fontSize: 14, marginBottom: 4 },
  body: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  when: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 8 },
  section: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", marginTop: 6, marginBottom: 12 },
  timeline: { gap: 0 },
  event: { flexDirection: "row", gap: 12 },
  rail: { alignItems: "center", width: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  line: { width: 2, flex: 1, marginVertical: 2 },
  eventBody: { flex: 1, paddingBottom: 18 },
  eventLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  eventWhen: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 },
  eventNote: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, marginTop: 6 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  link: { fontFamily: "Inter_500Medium", fontSize: 13 },
  problem: { fontFamily: "Inter_400Regular", fontSize: 14, textAlign: "center" },
  withdraw: { borderRadius: 12, borderWidth: 1, paddingVertical: 13, alignItems: "center", marginTop: 8 },
  withdrawText: { fontFamily: "Inter_500Medium", fontSize: 14 },
});
