import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPatch } from "@/utils/api";
import { notify } from "@/utils/alerts";
import WarningModal from "@/components/WarningModal";

/**
 * Moving a class after people have booked it.
 *
 * Everything a teacher needs to decide is on screen before they type anything: how many of the
 * month's five changes are left, whether this class is still far enough away to be moved, and
 * how many people a change would disrupt. Showing a form and then refusing the save is how an
 * app comes to be thought broken, so it is not done here.
 *
 * The server decides all of it again — this is the courtesy, that is the control. It has to be,
 * because a rule about somebody's money that only a screen enforces is a rule anyone with a
 * browser can skip.
 */

export interface ScheduleInfo {
  canMove: boolean;
  reason: string | null;
  /** Null when the count could not be read — which is not the same as zero, and is not drawn as five. */
  editsUsed: number | null;
  editsAllowed: number;
  editsLeft: number | null;
  lockHours: number;
  minNoticeHours: number;
  lastMovedAt: string | null;
  paidStudents: number;
  priceLocked: boolean;
}

interface Props {
  sessionId: number | string;
  /** The class's current start, so the fields open on where it is now. */
  currentDate: string;
  onMoved?: () => void;
}

/** `2026-08-30T14:05:00Z` in the browser's own timezone, split for the two inputs. */
function splitLocal(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export default function RescheduleClass({ sessionId, currentDate, onMoved }: Props) {
  const colors = useColors();
  const [info, setInfo] = useState<ScheduleInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [asking, setAsking] = useState<Date | null>(null);
  const initial = splitLocal(currentDate);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);

  const load = useCallback(async () => {
    try {
      setInfo(await apiGet<ScheduleInfo>(`/sessions/${sessionId}/schedule-info`));
    } catch {
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <ActivityIndicator color={colors.primary} style={styles.loading} />;
  if (!info) return null;

  const move = async () => {
    if (!date.trim() || !time.trim()) {
      notify("Pick a date and a time", "Both are needed to move a class.");
      return;
    }
    const when = new Date(`${date}T${time}:00`);
    if (Number.isNaN(when.getTime())) {
      notify("That date could not be read", "Use YYYY-MM-DD and HH:MM.");
      return;
    }

    // Everything the teacher needs to weigh is on the warning that opens next.
    setAsking(when);
  };

  const confirmMove = async () => {
    const when = asking;
    if (!when) return;
    setAsking(null);
    setWorking(true);
    try {
      await apiPatch(`/sessions/${sessionId}`, { date: when.toISOString() });
      notify("Class moved", "Everyone who booked it has been told.");
      setOpen(false);
      onMoved?.();
      await load();
    } catch (e) {
      notify("This class was not moved", e instanceof Error ? e.message : "Please try again.");
      await load();
    } finally {
      setWorking(false);
    }
  };

  /**
   * What moving the class costs, in the plainest words the facts allow.
   *
   * Two of these a teacher will not have connected on their own: it spends one of five for the
   * month, and it hands everybody who paid the right to leave with all their money. Both belong
   * in front of them before they agree, not in a notification afterwards.
   */
  const consequences = [
    ...(info.paidStudents > 0
      ? [
          `${info.paidStudents} student${info.paidStudents === 1 ? "" : "s"} already paid for this class.`,
          "They will all be told straight away.",
          "Any of them can leave and get ALL their money back. They have 24 hours to decide.",
        ]
      : ["Nobody has booked this class yet, so this affects no one."]),
    info.editsLeft === null
      ? "This uses one of your changes for this month."
      : `This uses 1 of your ${info.editsAllowed} changes this month. You will have ` +
        `${Math.max(0, info.editsLeft - 1)} left.`,
    "You cannot undo this.",
  ];

  return (
    <View style={[styles.card, { borderColor: colors.border }]} testID="reschedule-class">
      <WarningModal
        testID="reschedule-warning"
        visible={asking !== null}
        title="Are you sure you want to move this class?"
        headline={asking ? asking.toLocaleString([], {
          weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        }) : ""}
        headlineNote="The new date and time."
        consequences={consequences}
        confirmLabel="Yes, move it"
        busy={working}
        onConfirm={() => void confirmMove()}
        onCancel={() => setAsking(null)}
      />
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.foreground }]}>Schedule</Text>
        <Text testID="reschedule-edits-left" style={[styles.quota, { color: colors.mutedForeground }]}>
          {/* Never "5 left" from a failed lookup: an unknown count says so. */}
          {info.editsLeft === null
            ? "changes left: unknown"
            : `${info.editsLeft} of ${info.editsAllowed} changes left this month`}
        </Text>
      </View>

      {!info.canMove ? (
        <Text testID="reschedule-reason" style={[styles.reason, { color: colors.mutedForeground }]}>
          {info.reason ?? `A class can only be moved more than ${info.lockHours} hours before it starts.`}
        </Text>
      ) : !open ? (
        <>
          <Text style={[styles.reason, { color: colors.mutedForeground }]}>
            {info.paidStudents > 0
              ? `${info.paidStudents} student${info.paidStudents === 1 ? " has" : "s have"} paid for this class. ` +
                `Moving it lets them drop it for a full refund within 24 hours.`
              : "Nobody has booked this class yet, so moving it disrupts no one."}
          </Text>
          <TouchableOpacity
            testID="reschedule-open-btn"
            onPress={() => setOpen(true)}
            activeOpacity={0.85}
            style={[styles.btn, { borderColor: colors.border }]}
          >
            <Feather name="calendar" size={16} color={colors.foreground} />
            <Text style={[styles.btnText, { color: colors.foreground }]}>Change the date or time</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={[styles.reason, { color: colors.mutedForeground }]}>
            The new time must be at least {info.minNoticeHours} hours away, so the students who
            booked have time to decide whether it suits them.
          </Text>
          <View style={styles.fields}>
            <Field icon="calendar" colors={colors}>
              {Platform.OS === "web" ? (
                React.createElement("input", {
                  type: "date",
                  value: date,
                  "data-testid": "reschedule-date",
                  onChange: (e: any) => setDate(e.target.value),
                  style: webInput(colors),
                })
              ) : (
                <TextInput
                  testID="reschedule-date"
                  style={[styles.input, { color: colors.foreground }]}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.mutedForeground}
                  value={date}
                  onChangeText={setDate}
                />
              )}
            </Field>
            <Field icon="clock" colors={colors}>
              {Platform.OS === "web" ? (
                React.createElement("input", {
                  type: "time",
                  value: time,
                  "data-testid": "reschedule-time",
                  onChange: (e: any) => setTime(e.target.value),
                  style: webInput(colors),
                })
              ) : (
                <TextInput
                  testID="reschedule-time"
                  style={[styles.input, { color: colors.foreground }]}
                  placeholder="HH:MM"
                  placeholderTextColor={colors.mutedForeground}
                  value={time}
                  onChangeText={setTime}
                />
              )}
            </Field>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={() => setOpen(false)}
              activeOpacity={0.85}
              style={[styles.btn, styles.grow, { borderColor: colors.border }]}
            >
              <Text style={[styles.btnText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="reschedule-save-btn"
              onPress={() => void move()}
              disabled={working}
              activeOpacity={0.85}
              style={[styles.btn, styles.grow, { borderColor: colors.primary, backgroundColor: colors.primary, opacity: working ? 0.6 : 1 }]}
            >
              <Text style={[styles.btnText, { color: "#fff" }]}>{working ? "Moving…" : "Move the class"}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

function webInput(colors: ReturnType<typeof useColors>) {
  return {
    flex: 1,
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: colors.foreground,
    width: "100%",
    colorScheme: colors.background === "#0A0A0A" || colors.background === "#000000" ? "dark" : "light",
  };
}

function Field({
  icon, colors, children,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  colors: ReturnType<typeof useColors>;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
      <Feather name={icon} size={16} color={colors.mutedForeground} style={{ marginRight: 8 }} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  quota: { fontSize: 12, fontFamily: "Inter_400Regular" },
  reason: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  fields: { flexDirection: "row", gap: 10, marginTop: 4 },
  inputWrap: {
    flex: 1, flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 46,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  grow: { flex: 1 },
  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderWidth: 1, borderRadius: 10, paddingVertical: 12, marginTop: 6,
  },
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
