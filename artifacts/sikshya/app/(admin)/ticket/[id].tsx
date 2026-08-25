import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPatch, apiPost, attachmentUrl } from "@/utils/api";
import { confirm, notify } from "@/utils/alerts";
import { openAttachment as openFile } from "@/utils/openAttachment";
import type { TicketEvent } from "@/utils/tickets";

/**
 * One ticket, with everything behind it on the same screen.
 *
 * The point of the support desk: an agent should not have to go and find the class, the
 * attendance, the message thread and the reporter's history in four places, because an agent
 * who has to do that will decide without them.
 *
 * The findings are shown as what they are — statements of fact with the numbers attached, not
 * a verdict. REFUNDS.md is explicit that the outcome is a person's decision, and the whole
 * design of this screen is to give that person something to decide with.
 */

interface TicketDetail {
  ticket: {
    id: number; ref: string; reason: string; description: string; evidenceUrl: string | null;
    status: string; statusLabel: string; resolution: string | null; createdAt: string;
    sessionId: number | null; assignedTo: number | null;
    reporterId: number | null; reporterName: string | null; reporterEmail: string | null;
    reporterRole: string | null; reporterSuspendedAt: string | null;
  };
  /** Everything that has happened to it, internal notes included — this is the agents' view. */
  history: TicketEvent[];
  /** Where it may go from here, taken from the same rules the server enforces. */
  nextStatuses: { value: string; label: string }[];
  session: { id: number; topic: string; subject: string; date: string; duration: number; status: string; teacherName: string } | null;
  attendance: { known: boolean; rows: { userId: number; name: string; role: string; presentMs: number; joinCount: number }[] };
  findings: { code: string; detail: string }[];
  messages: { senderName: string; senderRole: string; body: string; createdAt: string }[];
  reporterActivity: { known: boolean; rows: { id: number; action: string; createdAt: string }[] };
}

export default function AdminTicket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolution, setResolution] = useState("");
  const [saving, setSaving] = useState(false);
  const [internal, setInternal] = useState(false);
  const [refunding, setRefunding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<TicketDetail>(`/admin/tickets/${id}`);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /**
   * The note is the reason, so it has to exist before the money does.
   *
   * The server refuses a refund with no note, but asking here saves an agent typing the
   * decision, tapping the button, and being told to go back and type the decision.
   */
  const grantRefund = async () => {
    if (!data?.session || data.ticket.reporterId === null) return;
    const note = resolution.trim();
    if (!note) {
      notify(
        "Write the decision first",
        "A full refund needs a reason recorded against it. Put it in the decision box below.",
      );
      return;
    }
    const agreed = await confirm(
      "Refund this student in full?",
      `${data.ticket.reporterName ?? "This student"} will be refunded the whole price of ` +
        `"${data.session.topic}". The refund is requested, not instant — it appears in the ` +
        `Refunds queue for somebody to pay within 5-7 business days.`,
      "Grant the refund",
    );
    if (!agreed) return;

    setRefunding(true);
    try {
      await apiPost(`/admin/sessions/${data.session.id}/refund`, {
        studentId: data.ticket.reporterId,
        note,
      });
      notify("Refund recorded", "It is now in the Refunds queue, waiting to be paid.");
      await load();
    } catch (e) {
      notify("Not recorded", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setRefunding(false);
    }
  };

  /**
   * Open an attachment in whatever the agent's device uses for photos and PDFs.
   *
   * The server is asked rather than the bucket: it checks that this person may see the file and
   * only then hands back a signed link, which lasts ten minutes. Nothing durable is stored on
   * this screen, so a screenshot of it is not a way in.
   */
  const openAttachment = async (key: string) => {
    // See utils/openAttachment.ts. This used to call window.open after awaiting the link,
    // which Safari blocks, so an agent's "Open the attachment" did nothing on a phone.
    const result = await openFile(key);
    if (!result.ok) notify("Could not open the file", result.reason ?? "Please try again.");
  };

  /**
   * Move the ticket, or just write on it.
   *
   * Passing no status writes a note and leaves the state alone, which is what an agent
   * part-way through a case needs. Either way the server records who did it and when, and the
   * reporter can read it — unless the note is marked internal, which never leaves the desk.
   */
  const decide = async (status?: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await apiPatch<TicketDetail>(`/admin/tickets/${id}`, {
        ...(status ? { status } : {}),
        resolution: resolution.trim() || undefined,
        internal,
      });
      await load();
      setResolution("");
      setInternal(false);
      notify(
        "Saved",
        status
          ? `${res.ticket.ref} is now "${res.ticket.statusLabel}"${internal ? "." : ", and the reporter has been told."}`
          : internal
            ? "Noted for other agents. The reporter cannot see this."
            : "Noted. The reporter can see this.",
      );
    } catch (e) {
      notify("Could not save", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  /** Taking it on, which is a different act from moving it along. */
  const takeOn = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await apiPost(`/admin/tickets/${id}/assign`, {});
      await load();
    } catch (e) {
      notify("Could not take it on", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <View style={[styles.centre, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!data) {
    return (
      <View style={[styles.centre, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Text style={{ color: colors.mutedForeground }}>This ticket could not be loaded.</Text>
      </View>
    );
  }

  const { ticket, session, attendance, findings, messages, reporterActivity, history, nextStatuses } = data;
  const finished = nextStatuses.length === 0;
  const minutes = (ms: number) => Math.round(ms / 60_000);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 60 }]}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>{ticket.ref}</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.reasonRow}>
          <Text style={[styles.reason, { color: colors.primary }]}>{ticket.reason}</Text>
          <Text
            testID="admin-ticket-status"
            style={[styles.statusChip, {
              color: finished ? colors.mutedForeground : colors.secondary,
              borderColor: finished ? colors.border : colors.secondary,
            }]}
          >
            {ticket.statusLabel}
          </Text>
        </View>
        <Text style={[styles.body, { color: colors.foreground }]}>{ticket.description}</Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          {ticket.reporterName ?? "Unknown"} ({ticket.reporterRole}) · {new Date(ticket.createdAt).toLocaleString()}
        </Text>
        {ticket.reporterSuspendedAt && (
          <Text style={[styles.meta, { color: colors.destructive }]}>This account is currently suspended.</Text>
        )}
        {ticket.reporterId !== null && (
          <TouchableOpacity onPress={() => router.push(`/(admin)/person/${ticket.reporterId}`)} activeOpacity={0.75}>
            <Text style={[styles.link, { color: colors.secondary }]}>Open this person's record →</Text>
          </TouchableOpacity>
        )}
        {/*
          The attachment, openable rather than printed.
          
          This used to render the storage key as plain text — "evidence/42/9f3c…png" — which is
          no use to an agent deciding a refund. It opens the file now, through the server, which
          hands back a link that dies in ten minutes.
        */}
        {ticket.evidenceUrl && (
          <TouchableOpacity
            testID="admin-open-attachment"
            onPress={() => void openAttachment(ticket.evidenceUrl!)}
            activeOpacity={0.8}
            style={[styles.attachment, { borderColor: colors.border }]}
          >
            <Feather name="paperclip" size={15} color={colors.secondary} />
            <Text style={[styles.attachmentText, { color: colors.secondary }]}>
              Open the attachment
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {session && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>The class</Text>
          <Text style={[styles.body, { color: colors.foreground }]}>{session.topic} · {session.subject}</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {new Date(session.date).toLocaleString()} · {session.duration} min · taught by {session.teacherName} · {session.status}
          </Text>

          <Text style={[styles.subTitle, { color: colors.foreground }]}>Who was in the room</Text>
          {!attendance.known ? (
            <Text style={[styles.meta, { color: colors.destructive }]}>
              The attendance record could not be read. That is not the same as nobody attending.
            </Text>
          ) : attendance.rows.length === 0 ? (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>Nobody opened this class.</Text>
          ) : (
            attendance.rows.map((row) => (
              <Text key={row.userId} style={[styles.meta, { color: colors.mutedForeground }]}>
                {row.name} ({row.role}) — {minutes(row.presentMs)} min
                {row.joinCount > 1 ? `, reconnected ${row.joinCount - 1}×` : ""}
              </Text>
            ))
          )}

          {findings.length > 0 && (
            <>
              <Text style={[styles.subTitle, { color: colors.foreground }]}>What the record shows</Text>
              {findings.map((finding, i) => (
                <View key={`${finding.code}-${i}`} style={styles.findingRow}>
                  <Feather name="info" size={13} color={colors.mutedForeground} />
                  <Text style={[styles.meta, { color: colors.mutedForeground, flex: 1 }]}>{finding.detail}</Text>
                </View>
              ))}
              <Text style={[styles.caveat, { color: colors.mutedForeground }]}>
                These are facts from the record, not a decision. The decision is yours.
              </Text>
            </>
          )}
        </View>
      )}

      {messages.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>What was said about this class</Text>
          {messages.map((message, i) => (
            <View key={i} style={styles.msg}>
              <Text style={[styles.msgWho, { color: colors.foreground }]}>
                {message.senderName} ({message.senderRole}) · {new Date(message.createdAt).toLocaleString()}
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>{message.body}</Text>
            </View>
          ))}
        </View>
      )}

      {reporterActivity.rows.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>What the reporter has been doing</Text>
          {reporterActivity.rows.slice(0, 12).map((row) => (
            <Text key={row.id} style={[styles.meta, { color: colors.mutedForeground }]}>
              {new Date(row.createdAt).toLocaleString()} — {row.action}
            </Text>
          ))}
        </View>
      )}

      {/*
        A full refund, for the reporter, for this class.

        Deliberately here rather than on the refunds queue: the queue is for paying out what has
        already been decided, and this is the deciding. An agent granting one has the attendance
        record, the findings and the thread on the same screen, which is the whole point.

        The owner drew the line narrowly — "it has to be for out of one's control type of
        situations" — so the reason typed above is what is stored against it, and refusing
        without one is the server's rule, not this screen's.
      */}
      {session && ticket.reporterId !== null && ticket.reporterRole === "student" && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Refund this student in full</Text>
          <Text style={[styles.caveat, { color: colors.mutedForeground }]}>
            For things outside the student's control — a teacher who never appeared, a power cut.
            Not a way around the half-refund somebody accepts when they change their mind. Your
            note below is stored as the reason and is what an appeal is judged against.
          </Text>
          <TouchableOpacity
            testID="admin-grant-refund"
            style={[styles.action, { borderColor: colors.destructive }]}
            onPress={() => void grantRefund()}
            disabled={refunding}
            activeOpacity={0.8}
          >
            <Feather name="corner-up-left" size={15} color={colors.destructive} />
            <Text style={[styles.actionText, { color: colors.destructive }]}>
              {refunding ? "Recording…" : "Grant a full refund"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Your decision</Text>
        <TextInput
          testID="admin-resolution"
          style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          placeholder="What did you find, and what have you done about it?"
          placeholderTextColor={colors.mutedForeground}
          value={resolution}
          onChangeText={setResolution}
          multiline
          textAlignVertical="top"
        />
        <Text style={[styles.caveat, { color: colors.mutedForeground }]}>
          {internal
            ? "Only other agents will see this. The reporter will not."
            : "This is what the reporter is told, and what an appeal is judged against. A ticket cannot be closed or turned down without it."}
        </Text>

        {/*
          Who the note is for.

          An agent needs both: something the reporter reads, and something they write to the
          next agent. Without the second the first gets used for both, and somebody ends up
          reading half a conversation about themselves.
        */}
        <TouchableOpacity
          testID="admin-internal-toggle"
          onPress={() => setInternal((v) => !v)}
          activeOpacity={0.7}
          style={styles.internalRow}
        >
          <Feather
            name={internal ? "check-square" : "square"}
            size={16}
            color={internal ? colors.secondary : colors.mutedForeground}
          />
          <Text style={[styles.internalText, { color: colors.mutedForeground }]}>
            Keep this between agents
          </Text>
        </TouchableOpacity>

        <View style={styles.actions}>
          <TouchableOpacity
            testID="admin-note"
            disabled={saving || finished}
            style={[styles.action, { borderColor: colors.border, opacity: saving || finished ? 0.5 : 1 }]}
            onPress={() => void decide()}
            activeOpacity={0.8}
          >
            <Text style={[styles.actionText, { color: colors.foreground }]}>Save note</Text>
          </TouchableOpacity>
          {/*
            The buttons come from the server.

            What an agent can reach and what the server will accept cannot be allowed to drift
            apart — a button that produces a 409 is worse than no button. So the states are
            listed by lib/tickets.ts and rendered from that list.
          */}
          {nextStatuses.map((next) => (
            <TouchableOpacity
              key={next.value}
              testID={`admin-move-${next.value}`}
              disabled={saving}
              style={[styles.action, next.value === "resolved"
                ? { backgroundColor: colors.primary, borderColor: colors.primary }
                : { borderColor: colors.border }, { opacity: saving ? 0.5 : 1 }]}
              onPress={() => void decide(next.value)}
              activeOpacity={0.8}
            >
              <Text style={[styles.actionText, { color: next.value === "resolved" ? "#fff" : colors.foreground }]}>
                {next.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {ticket.assignedTo === null && !finished ? (
          <TouchableOpacity
            testID="admin-take-on"
            disabled={saving}
            onPress={() => void takeOn()}
            activeOpacity={0.7}
          >
            <Text style={[styles.link, { color: colors.secondary }]}>Take this on →</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/*
        The trail.

        Last, because an agent opening a ticket reads the complaint and the evidence first. But
        never absent: what the previous agent did, and why, is the difference between a decision
        and a second opinion formed from scratch.
      */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>What has happened</Text>
        {history.map((event) => (
          <View key={event.id} style={styles.event} testID={`admin-event-${event.status}`}>
            <Text style={[styles.eventLabel, { color: colors.foreground }]}>
              {event.label}
              {event.by ? <Text style={{ color: colors.mutedForeground }}>{`  ${event.by}`}</Text> : null}
            </Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {new Date(event.at).toLocaleString()}
            </Text>
            {event.note ? (
              <Text style={[styles.body, { color: colors.foreground }]}>{event.note}</Text>
            ) : null}
            {event.fileKey ? (
              <TouchableOpacity
                onPress={() => void openAttachment(event.fileKey!)}
                activeOpacity={0.8}
                style={styles.attachment}
              >
                <Feather name="paperclip" size={14} color={colors.secondary} />
                <Text style={[styles.attachmentText, { color: colors.secondary }]}>Supporting document</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
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
  reason: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4 },
  reasonRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  statusChip: { fontSize: 11, fontFamily: "Inter_600SemiBold", borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  internalRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  internalText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  event: { gap: 2, paddingTop: 10 },
  eventLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  subTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 8 },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  attachment: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 14, marginTop: 6,
  },
  attachmentText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  caveat: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, fontStyle: "italic" },
  link: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  findingRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  msg: { gap: 2, marginBottom: 6 },
  msgWho: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 90, fontSize: 14, fontFamily: "Inter_400Regular" },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  action: { flex: 1, alignItems: "center", borderRadius: 12, borderWidth: 1, paddingVertical: 12 },
  actionText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
