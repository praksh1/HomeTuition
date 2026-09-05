import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
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

/**
 * A figure that might not exist, mirroring `api-server/src/lib/sessionProof/aggregate.ts`.
 *
 * The shape is deliberately awkward to read carelessly: there is no value to reach for until the
 * `available` branch has been taken, so a screen cannot accidentally render "we were not watching"
 * as a zero.
 */
type Measured<T> = { available: false; because: string } | { available: true; value: T };

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
  caseNarrative: {
    sessionId: number;
    summary: { code: string; detail: string }[];
    timeline: { at: string; code: string; detail: string; source: string }[];
    unavailable: string[];
  } | null;
  /**
   * The provider-corroborated view, or null when the ticket names no class.
   *
   * Optional so an older API answering a newer app renders the rest of the page instead of
   * failing — and so the absence of this block is never mistaken for "there was nothing to say".
   */
  proof?: {
    timeline: { atMs: number; code: string; source: string; userId?: number; detail: string }[];
    people: {
      userId: number; name: string; role: string;
      presentMs: Measured<number>;
      providerJoinCount: Measured<number>;
      reportedReconnects: Measured<number>;
      confidence: "corroborated" | "single-source" | "self-reported" | "absent";
    }[];
    providerSawMeeting: Measured<boolean>;
    /**
     * Every meeting the provider recorded in this room, each timed on its own.
     *
     * A list rather than a total, because a room that held one meeting of fifty minutes and one
     * that held three of four are different lessons and no single number says which.
     */
    providerMeetings?: {
      meetingId: string | null;
      startedAtMs: number | null;
      endedAtMs: number | null;
      spanMs: Measured<number>;
    }[];
    sources: { ledger: boolean; provider: boolean; telemetry: boolean };
    caveats: string[];
  } | null;
  messages: { senderName: string; senderRole: string; body: string; createdAt: string }[];
  reporterActivity: { known: boolean; rows: { id: number; action: string; createdAt: string }[] };
}

export default function AdminTicket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const { t, numeric, gutter, space, radius } = useLayout();
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

  const { ticket, session, attendance, findings, caseNarrative, proof, messages, reporterActivity, history, nextStatuses } = data;
  const finished = nextStatuses.length === 0;
  const minutes = (ms: number) => Math.round(ms / 60_000);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, {
        paddingHorizontal: gutter,
        gap: space.md,
        paddingTop: insets.top + space.md,
        paddingBottom: insets.bottom + space.xl,
      }]}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[t.title3, { color: colors.foreground }]}>{ticket.ref}</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm }]}>
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
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm }]}>
          <Text style={[t.title3, { color: colors.foreground }]}>The class</Text>
          <Text style={[t.body, { color: colors.foreground }]}>{session.topic} · {session.subject}</Text>
          <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>
            {new Date(session.date).toLocaleString()} · {session.duration} min · taught by {session.teacherName} · {session.status}
          </Text>

          {caseNarrative && (
            <View
              testID="admin-session-case-summary"
              style={[styles.summaryPanel, {
                backgroundColor: colors.surfaceSunk,
                borderColor: colors.border,
                borderRadius: radius.sm,
                padding: space.md,
                gap: space.sm,
              }]}
            >
              <View style={styles.summaryHeading}>
                <Feather name="file-text" size={18} color={colors.primary} />
                <View style={styles.summaryHeadingCopy}>
                  <Text style={[t.bodyStrong, { color: colors.foreground }]}>Session #{caseNarrative.sessionId} summary</Text>
                  <Text style={[t.caption, { color: colors.mutedForeground }]}>Readable facts for this case</Text>
                </View>
              </View>
              {caseNarrative.summary.map((line) => (
                <View key={line.code} style={styles.summaryLine}>
                  <View style={[styles.summaryDot, { backgroundColor: colors.primary }]} />
                  <Text style={[t.body, { color: colors.foreground, flex: 1 }]}>{line.detail}</Text>
                </View>
              ))}
              <View style={[styles.limitations, { backgroundColor: colors.warnSoft, borderRadius: radius.sm, padding: space.md, gap: space.xs }]}>
                <Text style={[t.caption, { color: colors.warn }]}>What this record cannot confirm yet</Text>
                {caseNarrative.unavailable.map((line) => (
                  <Text key={line} style={[t.caption, { color: colors.mutedForeground }]}>• {line}</Text>
                ))}
              </View>
            </View>
          )}

          <Text style={[t.bodyStrong, { color: colors.foreground, marginTop: space.sm }]}>Who was in the room</Text>
          {!attendance.known ? (
            <Text style={[t.caption, { color: colors.destructive }]}>
              The attendance record could not be read. That is not the same as nobody attending.
            </Text>
          ) : attendance.rows.length === 0 ? (
            <Text style={[t.caption, { color: colors.mutedForeground }]}>Nobody opened this class.</Text>
          ) : (
            attendance.rows.map((row) => (
              <Text key={row.userId} style={[t.caption, numeric, { color: colors.mutedForeground }]}>
                {row.name} ({row.role}) — {minutes(row.presentMs)} min
                {row.joinCount > 1 ? `, reconnected ${row.joinCount - 1}×` : ""}
              </Text>
            ))
          )}

          {findings.length > 0 && (
            <>
              <Text style={[t.bodyStrong, { color: colors.foreground, marginTop: space.sm }]}>What the record shows</Text>
              {findings.map((finding, i) => (
                <View key={`${finding.code}-${i}`} style={styles.findingRow}>
                  <Feather name="info" size={13} color={colors.mutedForeground} />
                  <Text style={[t.caption, { color: colors.mutedForeground, flex: 1 }]}>{finding.detail}</Text>
                </View>
              ))}
              <Text style={[styles.caveat, { color: colors.mutedForeground }]}>
                These are facts from the record, not a decision. The decision is yours.
              </Text>
            </>
          )}

          {/*
            What each source saw, and which ones were not there.

            The section exists for one distinction: "nothing happened" and "we were not watching"
            must never look the same on the screen an agent decides from. Every figure below either
            shows a number or says plainly why there is none — see the Measured type above.

            Deliberately compact and deliberately free of raw diagnostics. An agent needs to know
            that a line was reported bad, not the jitter in milliseconds, and this page is read by
            people who do not have to be engineers to do their job.
          */}
          {proof && (
            <>
              <Text style={[styles.subTitle, { color: colors.foreground }]}>What each source saw</Text>

              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {`Attendance ledger: ${proof.sources.ledger ? "available" : "UNAVAILABLE"}`}
                {` · Video provider: ${proof.sources.provider ? "available" : "UNAVAILABLE"}`}
                {` · Device reports: ${proof.sources.telemetry ? "available" : "UNAVAILABLE"}`}
              </Text>

              {proof.people.map((person) => (
                <Text key={person.userId} style={[styles.meta, { color: colors.mutedForeground }]}>
                  {`${person.name} (${person.role}) — `}
                  {person.presentMs.available
                    ? `${minutes(person.presentMs.value)} min by our own record`
                    : `time present unknown: ${person.presentMs.because}`}
                  {person.providerJoinCount.available
                    ? ` · provider recorded ${person.providerJoinCount.value} join${person.providerJoinCount.value === 1 ? "" : "s"}`
                    : " · provider could not name them"}
                  {person.reportedReconnects.available
                    ? ` · device reported ${person.reportedReconnects.value} reconnection${person.reportedReconnects.value === 1 ? "" : "s"}`
                    : ""}
                  {` · ${person.confidence}`}
                </Text>
              ))}

              {/*
                Each meeting on its own line, never added up.

                A call that drops and is rejoined makes two meetings in one room. Reporting the
                first start and the last end as one lesson counts the gap between them as
                teaching — which is the number a refund argument would lean on hardest, and the
                one it would be most wrong about.
              */}
              {proof.providerMeetings && proof.providerMeetings.length > 0 && (
                <>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {proof.providerMeetings.length === 1
                      ? "The video provider recorded one meeting:"
                      : `The video provider recorded ${proof.providerMeetings.length} separate meetings — the call dropped and was rejoined. Do not add them together:`}
                  </Text>
                  {proof.providerMeetings.map((meeting, i) => (
                    <Text key={`meeting-${i}`} style={[styles.meta, { color: colors.mutedForeground }]}>
                      {`  ${i + 1}. `}
                      {meeting.startedAtMs !== null
                        ? new Date(meeting.startedAtMs).toLocaleTimeString()
                        : "start not reported"}
                      {" to "}
                      {meeting.endedAtMs !== null
                        ? new Date(meeting.endedAtMs).toLocaleTimeString()
                        : "end not reported"}
                      {meeting.spanMs.available
                        ? ` — ${minutes(meeting.spanMs.value)} min`
                        : " — length unknown"}
                    </Text>
                  ))}
                </>
              )}

              {proof.timeline.length > 0 && (
                <>
                  <Text style={[styles.subTitle, { color: colors.foreground }]}>In order</Text>
                  {/*
                    Capped. An agent scanning a dispute needs the shape of the hour, and a class
                    with a bad line can produce hundreds of samples; the count below says what was
                    left out rather than silently truncating.
                  */}
                  {proof.timeline.slice(0, 20).map((entry, i) => (
                    <Text key={`${entry.code}-${i}`} style={[styles.meta, { color: colors.mutedForeground }]}>
                      {`${new Date(entry.atMs).toLocaleTimeString()} — ${entry.detail} [${entry.source}]`}
                    </Text>
                  ))}
                  {proof.timeline.length > 20 && (
                    <Text style={[styles.caveat, { color: colors.mutedForeground }]}>
                      {`${proof.timeline.length - 20} further entries are not shown.`}
                    </Text>
                  )}
                </>
              )}

              {proof.caveats.map((caveat, i) => (
                <Text key={`caveat-${i}`} style={[styles.caveat, { color: colors.warn }]}>{caveat}</Text>
              ))}

              <Text style={[styles.caveat, { color: colors.mutedForeground }]}>
                Corroboration is not a verdict. Sources can disagree, and a disagreement is a thing
                to read rather than a thing to resolve automatically.
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

      {caseNarrative && caseNarrative.timeline.length > 0 && (
        <View
          testID="admin-session-timeline"
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm }]}
        >
          <Text style={[t.title3, { color: colors.foreground }]}>Session timeline</Text>
          <Text style={[t.caption, { color: colors.mutedForeground }]}>The technical trail, translated into plain language.</Text>
          {caseNarrative.timeline.map((entry, index) => (
            <View key={`${entry.code}-${entry.at}-${index}`} style={styles.timelineRow}>
              <View style={styles.timelineRail}>
                <View style={[styles.timelineDot, { backgroundColor: colors.primary }]} />
                {index < caseNarrative.timeline.length - 1 ? (
                  <View style={[styles.timelineLine, { backgroundColor: colors.border }]} />
                ) : null}
              </View>
              <View style={[styles.timelineCopy, { paddingBottom: space.md }]}>
                <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>
                  {new Date(entry.at).toLocaleString("en-NP", { timeZone: "Asia/Kathmandu" })} Nepal time
                </Text>
                <Text style={[t.body, { color: colors.foreground }]}>{entry.detail}</Text>
                <Text style={[t.overline, { color: colors.inkFaint }]}>{entry.source.replace("-", " ")}</Text>
              </View>
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
              <Text style={[styles.actionText, { color: next.value === "resolved" ? colors.onInverse : colors.foreground }]}>
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
  container: {},
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
  summaryPanel: { borderWidth: 1 },
  summaryHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryHeadingCopy: { flex: 1 },
  summaryLine: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  summaryDot: { width: 6, height: 6, borderRadius: 999, marginTop: 8 },
  limitations: {},
  timelineRow: { flexDirection: "row", alignItems: "stretch", gap: 12 },
  timelineRail: { width: 12, alignItems: "center" },
  timelineDot: { width: 8, height: 8, borderRadius: 999, marginTop: 5 },
  timelineLine: { width: 1, flex: 1, marginTop: 4 },
  timelineCopy: { flex: 1 },
  msg: { gap: 2, marginBottom: 6 },
  msgWho: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 90, fontSize: 14, fontFamily: "Inter_400Regular" },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  action: { flex: 1, alignItems: "center", borderRadius: 12, borderWidth: 1, paddingVertical: 12 },
  actionText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
