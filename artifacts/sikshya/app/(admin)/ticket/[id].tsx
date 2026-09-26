import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPatch, apiPost, attachmentUrl } from "@/utils/api";
import { confirm, notify } from "@/utils/alerts";
import { openAttachment as openFile } from "@/utils/openAttachment";
import { HIT_SLOP_MIN, readingWidth } from "@/constants/layout";
import { groupSessionSummary } from "@/utils/sessionSummaryGroups";
import type { TicketEvent } from "@/utils/tickets";

/**
 * One clock for the whole page.
 *
 * Every stored instant on this screen used to be rendered with a bare `toLocaleString()`, which
 * takes the *viewer's* timezone and says nothing about it — while the case narrative beside it
 * renders in Nepal time and says so. On a container running UTC that put "9/5/2026, 4:15:00 AM"
 * for the class directly above "Sep 5, 2026, 10:00 AM Nepal time" for the same lesson. An agent
 * deciding a refund would see one class at two times and have no way to tell which was real, and
 * an agent working from a laptop set to another timezone would see it silently.
 *
 * So the timezone is pinned and labelled everywhere, not only where somebody remembered. Teachers
 * and students are in Nepal; the operator desk reasons about their day, not the desk's own.
 */
function nepalTime(value: string | number | Date): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "an unreadable time";
  // The same options the server's own narrative formatter uses, so one card cannot show
  // "9/5/2026, 10:00:00 AM" beside "Sep 5, 2026, 10:00 AM" for the same instant and read as two
  // systems. Seconds go with it: nothing an agent decides turns on them.
  return `${parsed.toLocaleString("en-NP", {
    timeZone: "Asia/Kathmandu",
    dateStyle: "medium",
    timeStyle: "short",
  })} Nepal time`;
}

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
  caseNarrative: {
    sessionId: number;
    summary: { code: string; detail: string }[];
    timeline: { at: string; code: string; detail: string; source: string }[];
    unavailable: string[];
    /** Optional while the web app and API can briefly be on adjacent deploys. */
    sourceNotes?: string[];
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
  const [section, setSection] = useState<"overview" | "records" | "timeline" | "decision">("overview");
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const res = await apiGet<TicketDetail>(`/admin/tickets/${id}`);
      if (version === requestVersion.current) setData(res);
    } catch {
      if (version === requestVersion.current) setData(null);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    setData(null);
    setSection("overview");
    setResolution("");
    setInternal(false);
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]));

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
        <TouchableOpacity accessibilityRole="button" testID="admin-ticket-retry" onPress={() => { setLoading(true); void load(); }} style={{ minHeight: HIT_SLOP_MIN, justifyContent: "center" }}>
          <Text style={[t.bodyStrong, { color: colors.primary }]}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { ticket, session, attendance, findings, caseNarrative, messages, reporterActivity, history, nextStatuses } = data;
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
        /*
          A column of text, not a window's worth.

          At 1440px these evidence sentences ran to about 180 characters and the eye lost its
          place coming back to the start of the next line. `maxWidth` with `width: "100%"` caps
          the wide case and leaves a phone exactly as it was, so nothing here can introduce a
          horizontal scroll on the screen size that matters most.
        */
        width: "100%",
        maxWidth: readingWidth,
        alignSelf: "center",
      }]}
    >
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to support queue" onPress={() => router.back()} activeOpacity={0.7} style={{ minWidth: HIT_SLOP_MIN, minHeight: HIT_SLOP_MIN, justifyContent: "center" }}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[t.title3, { color: colors.foreground }]}>{ticket.ref}</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
        {([ ["overview", "Overview"], ["records", "Class records"], ["timeline", "Timeline"], ["decision", "Decision"] ] as const).map(([key, label]) => (
          <TouchableOpacity key={key} accessibilityRole="button" accessibilityState={{ selected: section === key }} aria-pressed={section === key}
            testID={`admin-case-${key}`} onPress={() => setSection(key)}
            style={{ minHeight: HIT_SLOP_MIN, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: section === key ? colors.actionSoft : colors.card, borderWidth: 1, borderColor: section === key ? colors.primary : colors.border }}>
            <Text style={[t.caption, { color: section === key ? colors.primary : colors.mutedForeground }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {section === "overview" && <>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm }]}>
        <Text style={[t.overline, { color: colors.mutedForeground }]}>REPORTER'S ACCOUNT · NOT A VERIFIED FINDING</Text>
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
          {ticket.reporterName ?? "Unknown"} ({ticket.reporterRole}) · {nepalTime(ticket.createdAt)}
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

      <View testID="admin-case-gaps" style={[styles.card, { backgroundColor: colors.warnSoft, borderColor: colors.border }]}>
        <Text style={[t.title3, { color: colors.foreground }]}>Before deciding</Text>
        <Text style={[t.body, { color: colors.mutedForeground }]}>Compare the report with the class records and timeline. Attendance alone does not establish lesson quality or decide a refund.</Text>
        {!session && <Text style={[t.callout, { color: colors.warn }]}>No lesson is linked. Ask which class and date are affected if this request concerns a lesson.</Text>}
        {session && !attendance.known && <Text style={[t.callout, { color: colors.warn }]}>Attendance could not be read. Do not interpret this as an absence.</Text>}
        {session && !caseNarrative && <Text style={[t.callout, { color: colors.warn }]}>The session summary is unavailable. Review the available records before drawing conclusions.</Text>}
        {caseNarrative?.unavailable.map((line) => <Text key={line} style={[t.callout, { color: colors.warn }]}>• {line}</Text>)}
        <Text style={[t.caption, { color: colors.mutedForeground }]}>Refunds and account restrictions remain human decisions. This checklist does not approve either.</Text>
      </View>
      </>}

      {section === "records" && !session && <Text style={[t.body, { color: colors.mutedForeground }]}>No lesson is linked to this request. No class records are available here.</Text>}
      {section === "records" && session && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm }]}>
          <Text style={[t.title3, { color: colors.foreground }]}>The class</Text>
          <Text style={[t.body, { color: colors.foreground }]}>{session.topic} · {session.subject}</Text>
          <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>
            {nepalTime(session.date)} · {session.duration} min · taught by {session.teacherName} · {session.status}
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
              {groupSessionSummary(caseNarrative.summary).map((group) => (
                <View key={group.id} style={{ gap: space.xs }}>
                  <Text
                    accessibilityRole="header"
                    style={[t.caption, { color: colors.mutedForeground, marginTop: space.xs }]}
                  >
                    {group.heading}
                  </Text>
                  {group.lines.map((line) => (
                    <View key={line.code} style={styles.summaryLine}>
                      <View style={[styles.summaryDot, { backgroundColor: colors.primary }]} />
                      <Text style={[t.body, { color: colors.foreground, flex: 1 }]}>{line.detail}</Text>
                    </View>
                  ))}
                </View>
              ))}
              <View style={[styles.limitations, { backgroundColor: colors.warnSoft, borderRadius: radius.sm, padding: space.md, gap: space.xs }]}>
                <Text style={[t.caption, { color: colors.warn }]}>What this record cannot confirm yet</Text>
                {caseNarrative.unavailable.map((line) => (
                  <Text key={line} style={[t.caption, { color: colors.mutedForeground }]}>• {line}</Text>
                ))}
                {(caseNarrative.sourceNotes?.length ?? 0) > 0 && (
                  <>
                    <Text style={[t.caption, { color: colors.warn, marginTop: space.xs }]}>Source cautions</Text>
                    {caseNarrative.sourceNotes?.map((line) => (
                      <Text key={line} style={[t.caption, { color: colors.mutedForeground }]}>• {line}</Text>
                    ))}
                  </>
                )}
              </View>
            </View>
          )}

          <Text style={[t.bodyStrong, { color: colors.foreground, marginTop: space.sm }]}>Who was in the room</Text>
          {!attendance.known ? (
            <Text style={[t.caption, { color: colors.destructive }]}>
              The attendance record could not be read. That is not the same as nobody attending.
            </Text>
          ) : attendance.rows.length === 0 ? (
            <Text style={[t.caption, { color: colors.mutedForeground }]}>No attendance entries were returned. This alone does not prove that nobody attended.</Text>
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

        </View>
      )}

      {section === "records" && messages.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>What was said about this class</Text>
          {messages.map((message, i) => (
            <View key={i} style={styles.msg}>
              <Text style={[styles.msgWho, { color: colors.foreground }]}>
                {message.senderName} ({message.senderRole}) · {nepalTime(message.createdAt)}
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>{message.body}</Text>
            </View>
          ))}
        </View>
      )}

      {section === "timeline" && caseNarrative && caseNarrative.timeline.length > 0 && (
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
                  {nepalTime(entry.at)}
                </Text>
                <Text style={[t.body, { color: colors.foreground }]}>{entry.detail}</Text>
                <Text style={[t.overline, { color: colors.inkFaint }]}>{entry.source.replace("-", " ")}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {section === "timeline" && reporterActivity.rows.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>What the reporter has been doing</Text>
          {reporterActivity.rows.slice(0, 12).map((row) => (
            <Text key={row.id} style={[styles.meta, { color: colors.mutedForeground }]}>
              {nepalTime(row.createdAt)} — {row.action}
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
      {section === "decision" && session && ticket.reporterId !== null && ticket.reporterRole === "student" && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Refund this student in full</Text>
          <Text style={[styles.caveat, { color: colors.mutedForeground }]}>
            For things outside the student's control — a teacher who never appeared, a power cut.
            Not a way around the half-refund somebody accepts when they change their mind. Your
            note below is stored as the reason and is what an appeal is judged against.
          </Text>
          <TouchableOpacity
            testID="admin-grant-refund"
            style={[styles.action, { borderColor: colors.destructive, flexBasis: "auto", flexGrow: 0 }]}
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

      {section === "decision" && <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
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
      </View>}

      {/*
        The trail.

        Last, because an agent opening a ticket reads the complaint and the evidence first. But
        never absent: what the previous agent did, and why, is the difference between a decision
        and a second opinion formed from scratch.
      */}
      {section === "timeline" && <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>What has happened</Text>
        {history.map((event) => (
          <View key={event.id} style={styles.event} testID={`admin-event-${event.status}`}>
            <Text style={[styles.eventLabel, { color: colors.foreground }]}>
              {event.label}
              {event.by ? <Text style={{ color: colors.mutedForeground }}>{`  ${event.by}`}</Text> : null}
            </Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {nepalTime(event.at)}
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
      </View>}
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
  reasonRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  statusChip: { fontSize: 11, fontFamily: "Inter_600SemiBold", borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  // The row is one control, so the whole row carries the minimum height rather than the 16px
  // icon inside it.
  internalRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, minHeight: HIT_SLOP_MIN },
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
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  // `paddingVertical` alone left "Save note" at 34px high on a phone, because the padding is
  // added to a 14px line rather than to a minimum. `minHeight` sets the floor and the padding
  // still grows it wherever the type scale is larger; `justifyContent` keeps the label centred
  // when the floor is doing the work.
  action: {
    flexGrow: 1, flexBasis: 120, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1,
    paddingVertical: 12, minHeight: HIT_SLOP_MIN,
  },
  actionText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
