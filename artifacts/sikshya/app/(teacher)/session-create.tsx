import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { ApiError, apiGet, apiPatch, apiPost } from "@/utils/api";
import { useDates } from "@/context/DatePreferenceContext";
import NepaliDatePicker from "@/components/NepaliDatePicker";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { HIT_SLOP_MIN, readingWidth, space as layoutSpace } from "@/constants/layout";
import { allowancePresentation, limitDetailsFromResponse, type SessionAllowanceSummary, type SessionLimitDetails } from "@/utils/sessionCreateAllowance";
import { useNotifications } from "@/context/NotificationContext";
import { scheduleSessionReminder } from "@/utils/notifications";
import type { Teacher } from "@/context/AuthContext";

const FALLBACK_SUBJECTS = ["Mathematics", "Science", "English", "Nepali", "Computer Science", "History", "Geography", "Economics"];
const CUSTOM_SUBJECT_OPTION = "Create your own";
const DURATIONS = [30, 45, 60];
const MAX_STUDENTS_OPTIONS = [5, 10, 15, 20];

interface InvitableStudent {
  id: number;
  name: string;
  follower: boolean;
  pastStudent: boolean;
}

export default function SessionCreate() {
  const { user } = useAuth();
  const colors = useColors();
  const { t, numeric, gutter, space, radius, elevation, isCompact } = useLayout();
  const insets = useSafeAreaInsets();
  const teacher = user as Teacher;

  const [subjects, setSubjects] = useState<string[]>(FALLBACK_SUBJECTS);
  const [subject, setSubject] = useState(teacher?.subject ?? "Mathematics");
  const [customSubject, setCustomSubject] = useState("");
  const [isCustomSubject, setIsCustomSubject] = useState(false);
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState(60);
  const [maxStudents, setMaxStudents] = useState(20);
  const [price, setPrice] = useState("500");
  const [date, setDate] = useState("");
  const [pickingDate, setPickingDate] = useState(false);
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [allowance, setAllowance] = useState<SessionAllowanceSummary | null>(null);
  const [allowanceLoading, setAllowanceLoading] = useState(true);
  const [allowanceUnavailable, setAllowanceUnavailable] = useState(false);
  const [limitDetails, setLimitDetails] = useState<SessionLimitDetails | null>(null);
  /**
   * Students to tell about this class: the teacher's followers and anyone who has taken a
   * paid class with them. Telling them is all this does — they book and pay like anyone else,
   * and the classroom door checks enrolment, not invitations.
   */
  const [invitable, setInvitable] = useState<InvitableStudent[]>([]);
  const [invited, setInvited] = useState<number[]>([]);
  const [showInvites, setShowInvites] = useState(false);
  const { refresh: refreshNotifs, preferences } = useNotifications();

  const refreshAllowance = React.useCallback(async () => {
    setAllowanceLoading(true);
    setAllowanceUnavailable(false);
    try {
      setAllowance(await apiGet<SessionAllowanceSummary>("/teachers/me/allowance"));
    } catch {
      // Unknown is not zero. The server still enforces the exact allowance when the form is sent.
      setAllowance(null);
      setAllowanceUnavailable(true);
    } finally {
      setAllowanceLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshAllowance();
    (async () => {
      try {
        const res = await apiGet<{ subjects: string[] }>("/sessions/subjects");
        if (res.subjects?.length) setSubjects(res.subjects);
      } catch {}
    })();
    (async () => {
      try {
        const res = await apiGet<{ students: InvitableStudent[] }>("/sessions/invitable-students");
        setInvitable(res.students ?? []);
      } catch {
        // No list is the same as an empty one here: the section simply does not appear.
      }
    })();
  }, [refreshAllowance]);

  // A refusal applies to the date that was checked. Changing that date gives the server a new
  // question, so restore the actions and let the server decide again rather than keeping a stale
  // client-side lock in force.
  React.useEffect(() => {
    setLimitDetails(null);
  }, [date, time]);

  const effectiveSubject = isCustomSubject ? customSubject.trim() : subject;

  /**
   * Every field marked with * on this form, actually enforced.
   *
   * `needsSchedule` is false for "Create & Go Live Now", which starts the class immediately
   * and so has no scheduled date to supply — the only starred field it legitimately skips.
   */
  const validate = (needsSchedule: boolean): string | null => {
    if (!effectiveSubject) return "Please choose or enter a subject.";
    if (!topic.trim()) return "Please enter a session topic.";
    if (needsSchedule) {
      if (!date.trim() || !time.trim()) return "Please choose the session date and time.";
      if (isNaN(new Date(`${date}T${time}:00`).getTime())) {
        return "That date and time could not be read. Use YYYY-MM-DD and HH:MM.";
      }
    }
    if (!Number.isFinite(duration) || duration <= 0) return "Duration must be more than zero minutes.";
    if (!Number.isFinite(maxStudents) || maxStudents <= 0) return "Maximum students must be at least one.";

    // Amount previously fell back to 500 whenever it was blank or zero, inventing a price the
    // teacher never chose. It is mandatory, and it has to be a real charge.
    const amount = Number(price);
    if (!price.trim() || !Number.isFinite(amount)) return "Please enter the session amount.";
    if (amount <= 0) return "Amount must be greater than zero.";
    return null;
  };

  const reportInvalid = (message: string) => {
    if (Platform.OS === "web") window.alert(`Missing Info\n\n${message}`);
    else Alert.alert("Missing Info", message);
  };

  /**
   * A plan refusal belongs on the screen where the teacher can act on it, not in a dismissible
   * alert. Keep the server's words and refresh the server-owned summary; never calculate a tier
   * or price from client defaults.
   */
  const showPlanLimit = (error: unknown): boolean => {
    if (!(error instanceof ApiError) || error.status !== 402) return false;
    setLimitDetails(limitDetailsFromResponse(error.message, error.data));
    void refreshAllowance();
    return true;
  };

  const handleCreate = async () => {
    const problem = validate(true);
    if (problem) { reportInvalid(problem); return; }
    const parsed = new Date(`${date}T${time}:00`);
    setSaving(true);
    try {
      const newSession = await apiPost<{ id: number; topic: string; date: string }>("/sessions", {
        subject: effectiveSubject,
        topic: topic.trim(),
        description: description.trim(),
        date: parsed.toISOString(),
        duration,
        maxStudents,
        price: Number(price),
        inviteStudentIds: invited,
      });
      // Honoured here rather than inside the scheduler: a reminder is booked once, now, and a
      // user who has turned reminders off should never have one queued in the first place.
      if (preferences.push.reminders) {
        try { await scheduleSessionReminder({ id: String(newSession.id), topic: newSession.topic, date: newSession.date }); } catch {}
      }
      try { await refreshNotifs(); } catch {}
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
      if (Platform.OS === "web") {
        window.alert(`Session Created!\n\n"${newSession.topic}" has been scheduled. You'll find it in your Sessions tab.`);
        router.replace("/(teacher)/sessions");
      } else {
        Alert.alert(
          "Session Created!",
          `"${newSession.topic}" has been scheduled. You'll find it in your Sessions tab.`,
          [{ text: "OK", onPress: () => router.replace("/(teacher)/sessions") }]
        );
      }
    } catch (_e) {
      /**
       * Show what the server actually said.
       *
       * "Check your inputs" is the wrong advice for the two refusals a teacher will really
       * hit — being over their plan's allowance (402), where the inputs are fine and the fix is
       * a later date or an upgrade. Telling them to re-read a correct form sends them round a
       * loop with no way out of it.
       */
      if (showPlanLimit(_e)) return;
      const message =
        _e instanceof ApiError && _e.message
          ? _e.message
          : "Failed to create session. Please check your inputs and try again.";
      if (Platform.OS === "web") window.alert(`Error\n\n${message}`);
      else Alert.alert("Error", message);
    } finally {
      setSaving(false);
    }
  };

  const handleGoLive = async () => {
    // Same rules, minus the scheduled date — this class starts now.
    const problem = validate(false);
    if (problem) { reportInvalid(problem); return; }
    setSaving(true);
    let createdId: number | null = null;
    try {
      const newSession = await apiPost<{ id: number; topic: string; date: string }>("/sessions", {
        subject: effectiveSubject,
        topic: topic.trim(),
        description: description.trim(),
        date: new Date().toISOString(),
        duration,
        maxStudents,
        price: Number(price),
        inviteStudentIds: invited,
      });
      createdId = newSession.id;
      await apiPatch(`/sessions/${newSession.id}`, { status: "live" });
      try { await refreshNotifs(); } catch {}
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
      router.replace(`/(teacher)/classroom/${newSession.id}`);
    } catch (_e) {
      if (createdId != null) {
        const msg =
          _e instanceof ApiError && _e.status === 409
            ? `${_e.message} Your new class is saved — start it from your Sessions tab once you have.`
            : "Your session was created but couldn't go live. You can start it from your Sessions tab.";
        if (Platform.OS === "web") window.alert(`Session Created\n\n${msg}`);
        else Alert.alert("Session Created", msg);
        router.replace("/(teacher)/sessions");
      } else {
        // Nothing was created, so the refusal is about the class itself — most often the plan's
        // allowance. Same reasoning as the scheduled path above: say what the server said.
        if (showPlanLimit(_e)) return;
        const message =
          _e instanceof ApiError && _e.message
            ? _e.message
            : "Failed to start the live session. Please try again.";
        if (Platform.OS === "web") window.alert(`Error\n\n${message}`);
        else Alert.alert("Error", message);
      }
    } finally {
      setSaving(false);
    }
  };

  const dates = useDates();
  const allowanceView = allowance ? allowancePresentation(allowance) : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[
          styles.container,
          {
            alignSelf: "center",
            maxWidth: readingWidth,
            paddingHorizontal: gutter,
            paddingTop: insets.top + space.md,
            paddingBottom: insets.bottom + space.huge * 2 + space.xl,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close new session" onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="x" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text accessibilityRole="header" style={[t.title1, { color: colors.foreground }]}>New Session</Text>
          <View style={styles.headerBalance} />
        </View>

        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.allowanceCard,
            {
              backgroundColor: allowanceView?.isFullAtBusiestPoint ? colors.warnSoft : colors.card,
              borderColor: allowanceView?.isFullAtBusiestPoint ? colors.warn : colors.border,
              borderRadius: radius.md,
              padding: space.md,
              gap: space.sm,
            },
            elevation.card,
          ]}
        >
          {allowanceLoading ? (
            <View style={[styles.allowanceRow, { gap: space.sm }]}>
              <ActivityIndicator color={colors.primary} accessibilityLabel="Checking teaching plan" />
              <Text style={[t.callout, { color: colors.mutedForeground }]}>Checking your teaching plan…</Text>
            </View>
          ) : allowanceUnavailable ? (
            <View style={[styles.allowanceRow, { gap: space.sm }]}>
              <Feather name="alert-circle" size={20} color={colors.warn} />
              <View style={styles.allowanceText}>
                <Text style={[t.bodyStrong, { color: colors.foreground }]}>Plan status unavailable</Text>
                <Text style={[t.callout, { color: colors.mutedForeground }]}>You can complete the form. Sikshya will check your exact allowance before creating the class.</Text>
              </View>
            </View>
          ) : allowanceView && allowance ? (
            <View style={[styles.allowanceRow, { gap: space.sm }]}>
              <Feather
                name={allowanceView.isFullAtBusiestPoint ? "alert-triangle" : "check-circle"}
                size={20}
                color={allowanceView.isFullAtBusiestPoint ? colors.warn : colors.success}
              />
              <View style={styles.allowanceText}>
                <Text style={[t.bodyStrong, { color: colors.foreground }]}>{allowanceView.heading}</Text>
                <Text style={[t.callout, numeric, { color: colors.mutedForeground }]}>{allowanceView.usage}</Text>
                <Text style={[t.caption, numeric, { color: allowance.testAccess ? colors.warn : colors.inkFaint }]}>{allowanceView.billing}</Text>
                {allowance.testAccess && (
                  <Text style={[t.caption, numeric, { color: colors.inkFaint }]}>Access ends {dates.format(allowance.testAccess.validUntil, { withTime: true })}.</Text>
                )}
              </View>
            </View>
          ) : null}
        </View>

        <Section title="Subject">
          <View style={styles.chipGrid}>
            {subjects.map((s) => (
              <TouchableOpacity
                key={s}
                accessibilityRole="button"
                accessibilityState={{ selected: !isCustomSubject && subject === s }}
                style={[styles.chip, { borderColor: !isCustomSubject && subject === s ? colors.primary : colors.border, backgroundColor: !isCustomSubject && subject === s ? colors.actionSoft : colors.muted, borderRadius: radius.lg, paddingHorizontal: space.sm }]}
                onPress={() => { setIsCustomSubject(false); setSubject(s); }}
                activeOpacity={0.7}
              >
                <Text style={[t.caption, { color: !isCustomSubject && subject === s ? colors.primary : colors.mutedForeground }]}>{s}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ selected: isCustomSubject }}
              style={[styles.chip, { borderColor: isCustomSubject ? colors.primary : colors.border, backgroundColor: isCustomSubject ? colors.actionSoft : colors.muted, borderRadius: radius.lg, paddingHorizontal: space.sm }]}
              onPress={() => setIsCustomSubject(true)}
              activeOpacity={0.7}
            >
              <Feather name="plus" size={12} color={isCustomSubject ? colors.primary : colors.mutedForeground} style={{ marginRight: space.xxs }} />
              <Text style={[t.caption, { color: isCustomSubject ? colors.primary : colors.mutedForeground }]}>{CUSTOM_SUBJECT_OPTION}</Text>
            </TouchableOpacity>
          </View>
          {isCustomSubject && (
            <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, marginTop: space.xxs }]}>
              <TextInput
                style={[styles.input, t.body, { color: colors.foreground }]}
                placeholder="e.g. Music Theory"
                placeholderTextColor={colors.mutedForeground}
                value={customSubject}
                onChangeText={setCustomSubject}
                autoFocus
              />
            </View>
          )}
        </Section>

        <Section title="Session Topic *">
          <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm }]}>
            <TextInput
              style={[styles.input, t.body, { color: colors.foreground }]}
              placeholder="e.g. Calculus: Introduction to Derivatives"
              placeholderTextColor={colors.mutedForeground}
              value={topic}
              onChangeText={setTopic}
            />
          </View>
        </Section>

        <Section title="Description">
          <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm }]}>
            <TextInput
              style={[styles.input, styles.descriptionInput, t.body, { color: colors.foreground }]}
              placeholder="What will students learn in this session?"
              placeholderTextColor={colors.mutedForeground}
              value={description}
              onChangeText={setDescription}
              multiline
              textAlignVertical="top"
            />
          </View>
        </Section>

        <View style={[styles.row, { flexDirection: isCompact ? "column" : "row", gap: space.sm }]}>
          <View style={{ flex: 1 }}>
            <Section title="Date *">
              {/*
                A Bikram Sambat calendar, not a Gregorian input.
                
                Nepal keeps its diary in Bikram Sambat, and a teacher looking at a Gregorian
                field has to convert their own date before they can type it — every time, with a
                wrong class date waiting at the end of any slip. The picker shows the Gregorian
                equivalent underneath, so nothing is hidden from anybody who wants it.
              */}
              <TouchableOpacity
                testID="session-date-btn"
                accessibilityRole="button"
                accessibilityLabel="Choose session date"
                onPress={() => setPickingDate(true)}
                activeOpacity={0.8}
                style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md }]}
              >
                <Feather name="calendar" size={16} color={colors.mutedForeground} style={{ marginRight: space.xs }} />
                <Text
                  style={[
                    styles.input,
                    t.body,
                    { color: date ? colors.foreground : colors.mutedForeground, paddingVertical: space.sm },
                  ]}
                >
                  {date ? dates.format(`${date}T00:00:00`, { withWeekday: true }) : "Choose a date"}
                </Text>
              </TouchableOpacity>
            </Section>
          </View>
          <View style={{ flex: 1 }}>
            <Section title="Time *">
              <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm }]}>
                <Feather name="clock" size={16} color={colors.mutedForeground} style={{ marginRight: space.xs }} />
                {Platform.OS === "web" ? (
                  React.createElement("input", {
                    type: "time",
                    value: time,
                    onChange: (e: any) => setTime(e.target.value),
                    style: {
                      ...t.body,
                      flex: 1,
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      color: colors.foreground,
                      width: "100%",
                      colorScheme: "light",
                    },
                  })
                ) : (
                  <TextInput
                    style={[styles.input, t.body, { color: colors.foreground }]}
                    placeholder="HH:MM"
                    placeholderTextColor={colors.mutedForeground}
                    value={time}
                    onChangeText={setTime}
                  />
                )}
              </View>
            </Section>
          </View>
        </View>

        <Section title="Duration (max 60 min)">
          <View style={styles.chipRow}>
            {DURATIONS.map((d) => (
              <TouchableOpacity
                key={d}
                accessibilityRole="button"
                accessibilityState={{ selected: duration === d }}
                style={[styles.pillChip, { borderColor: duration === d ? colors.primary : colors.border, backgroundColor: duration === d ? colors.primary : colors.muted, borderRadius: radius.lg, paddingHorizontal: space.md }]}
                onPress={() => setDuration(d)}
                activeOpacity={0.7}
              >
                <Text style={[t.callout, numeric, { color: duration === d ? colors.primaryForeground : colors.mutedForeground }]}>{d} min</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Section>

        <Section title="Max Students (max 20)">
          <View style={styles.chipRow}>
            {MAX_STUDENTS_OPTIONS.map((n) => (
              <TouchableOpacity
                key={n}
                accessibilityRole="button"
                accessibilityState={{ selected: maxStudents === n }}
                style={[styles.pillChip, { borderColor: maxStudents === n ? colors.primary : colors.border, backgroundColor: maxStudents === n ? colors.primary : colors.muted, borderRadius: radius.lg, paddingHorizontal: space.md }]}
                onPress={() => setMaxStudents(n)}
                activeOpacity={0.7}
              >
                <Text style={[t.callout, numeric, { color: maxStudents === n ? colors.primaryForeground : colors.mutedForeground }]}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Section>

        <Section title="Session Price (NPR)">
          <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm }]}>
            <Text style={[t.bodyStrong, { color: colors.mutedForeground, marginRight: space.xs }]}>NPR</Text>
            <TextInput
              style={[styles.input, t.body, numeric, { color: colors.foreground }]}
              placeholder="500"
              placeholderTextColor={colors.mutedForeground}
              value={price}
              onChangeText={setPrice}
              keyboardType="numeric"
            />
          </View>
        </Section>

        {/* Telling students a class exists. It does not book them in, and it does not let them
            in — they book and pay exactly as they would from Discover. Hidden entirely when
            the teacher has nobody to tell, rather than showing an empty box. */}
        {invitable.length > 0 && (
          <Section title="Tell your students">
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ expanded: showInvites }}
              style={[styles.inviteToggle, { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: space.sm, gap: space.xs }]}
              onPress={() => setShowInvites((v) => !v)}
              activeOpacity={0.8}
            >
              <Feather name="users" size={15} color={colors.mutedForeground} />
              <Text style={[styles.inviteToggleText, t.callout, { color: colors.foreground }]}>
                {invited.length > 0
                  ? `${invited.length} of ${invitable.length} will be notified`
                  : `Notify students who follow you (${invitable.length})`}
              </Text>
              <Feather name={showInvites ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
            </TouchableOpacity>

            {showInvites && (
              <View style={[styles.inviteList, { borderColor: colors.border, borderRadius: radius.md, marginTop: space.xs }]}>
                <View style={[styles.inviteActions, { paddingHorizontal: space.sm, paddingVertical: space.xs }]}>
                  <TouchableOpacity accessibilityRole="button" style={styles.smallAction} onPress={() => setInvited(invitable.map((s) => s.id))} activeOpacity={0.7}>
                    <Text style={[t.caption, { color: colors.primary }]}>Select all</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" style={styles.smallAction} onPress={() => setInvited([])} activeOpacity={0.7}>
                    <Text style={[t.caption, { color: colors.mutedForeground }]}>Clear</Text>
                  </TouchableOpacity>
                </View>

                {invitable.map((student) => {
                  const on = invited.includes(student.id);
                  return (
                    <TouchableOpacity
                      key={student.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      style={[styles.inviteRow, { borderTopColor: colors.border, gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.sm }]}
                      onPress={() =>
                        setInvited((prev) =>
                          prev.includes(student.id) ? prev.filter((id) => id !== student.id) : [...prev, student.id],
                        )
                      }
                      activeOpacity={0.7}
                    >
                      <View style={[styles.inviteCheck, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : "transparent", borderRadius: radius.xs }]}>
                        {on && <Feather name="check" size={12} color={colors.primaryForeground} />}
                      </View>
                      <View style={styles.inviteWho}>
                        <Text style={[t.callout, { color: colors.foreground }]}>{student.name}</Text>
                        <Text style={[t.caption, { color: colors.mutedForeground, marginTop: space.xxs }]}>
                          {student.pastStudent && student.follower
                            ? "Follows you · has taken a class"
                            : student.pastStudent
                              ? "Has taken a class with you"
                              : "Follows you"}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                <Text style={[t.caption, { color: colors.mutedForeground, paddingHorizontal: space.sm, paddingVertical: space.sm }]}>
                  They will get a notification with a link. They still book and pay for the class
                  in the usual way — this does not reserve a place for them.
                </Text>
              </View>
            )}
          </Section>
        )}

        <View style={[styles.summaryBox, { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: radius.md, padding: space.sm, gap: space.xs }]}>
          <Feather name="info" size={15} color={colors.mutedForeground} />
          <Text style={[styles.summaryText, t.caption, { color: colors.mutedForeground }]}>
            Students can book after this class is published. Your teaching-plan allowance is checked again when you create it.
          </Text>
        </View>

        {limitDetails ? (
          <View
            accessibilityLiveRegion="assertive"
            style={[
              styles.limitCard,
              {
                backgroundColor: colors.warnSoft,
                borderColor: colors.warn,
                borderRadius: radius.md,
                padding: space.md,
                gap: space.sm,
              },
            ]}
          >
            <View style={[styles.allowanceRow, { gap: space.sm }]}>
              <Feather name="lock" size={20} color={colors.warn} />
              <View style={styles.allowanceText}>
                <Text accessibilityRole="header" style={[t.title3, { color: colors.foreground }]}>This class does not fit your plan</Text>
                <Text style={[t.body, { color: colors.foreground }]}>{limitDetails.message}</Text>
                {limitDetails.freesAt && (
                  <Text style={[t.callout, numeric, { color: colors.warn }]}>Earliest date this class would fit: {dates.format(limitDetails.freesAt, { withTime: true })}.</Text>
                )}
              </View>
            </View>

            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.actionButton, { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: space.md }]}
              onPress={() => router.push(limitDetails.upgradeTo ? "/(teacher)/subscription" : "/(teacher)/sessions")}
              activeOpacity={0.85}
            >
              <Feather name={limitDetails.upgradeTo ? "arrow-up-circle" : "calendar"} size={20} color={colors.primaryForeground} />
              <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>
                {limitDetails.upgradeTo ? "View teaching-plan options" : "Review scheduled classes"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.actionButton, { borderColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: space.md }]}
              onPress={() => {
                setLimitDetails(null);
                setPickingDate(true);
              }}
              activeOpacity={0.75}
            >
              <Feather name="edit-2" size={18} color={colors.primary} />
              <Text style={[t.bodyStrong, { color: colors.primary }]}>Choose another date</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.actionButton, { borderColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: space.md }, saving && styles.disabled]}
              onPress={handleGoLive}
              disabled={saving}
              activeOpacity={0.75}
            >
              <Feather name="radio" size={20} color={colors.primary} />
              <Text style={[t.bodyStrong, { color: colors.primary }]}>Create & Go Live Now</Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.actionButton, { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: space.md }, saving && styles.disabled]}
              onPress={handleCreate}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Feather name="calendar" size={20} color={colors.primaryForeground} />
              <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>{saving ? "Saving..." : "Schedule for Later"}</Text>
            </TouchableOpacity>
          </>
        )}
        <NepaliDatePicker
        visible={pickingDate}
        value={date ? new Date(`${date}T00:00:00`) : null}
        // A class cannot be scheduled in the past, so those days cannot be chosen at all.
        minDate={new Date()}
        title="When is the class?"
        onCancel={() => setPickingDate(false)}
        onPick={(picked) => {
          const pad = (n: number) => String(n).padStart(2, "0");
          setDate(`${picked.getFullYear()}-${pad(picked.getMonth() + 1)}-${pad(picked.getDate())}`);
          setPickingDate(false);
        }}
      />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useColors();
  const { t, space } = useLayout();
  return (
    <View style={[styles.section, { gap: space.xs }]}>
      <Text style={[t.bodyStrong, { color: colors.foreground }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", gap: layoutSpace.lg },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, justifyContent: "center" },
  headerBalance: { width: HIT_SLOP_MIN },
  allowanceCard: { borderWidth: 1 },
  allowanceRow: { flexDirection: "row", alignItems: "flex-start" },
  allowanceText: { flex: 1, gap: layoutSpace.xxs },
  section: {},
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: layoutSpace.xs },
  chip: { flexDirection: "row", alignItems: "center", borderWidth: 1, minHeight: HIT_SLOP_MIN, paddingVertical: layoutSpace.xs },
  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, minHeight: HIT_SLOP_MIN },
  input: { flex: 1 },
  descriptionInput: { minHeight: layoutSpace.huge + layoutSpace.xl },
  row: {},
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: layoutSpace.xs },
  pillChip: { borderWidth: 1, minHeight: HIT_SLOP_MIN, justifyContent: "center", paddingVertical: layoutSpace.xs },
  inviteToggle: { flexDirection: "row", alignItems: "center", borderWidth: 1, minHeight: HIT_SLOP_MIN },
  inviteToggleText: { flex: 1 },
  inviteList: { borderWidth: 1, overflow: "hidden" },
  inviteActions: { flexDirection: "row", justifyContent: "space-between" },
  smallAction: { minHeight: HIT_SLOP_MIN, justifyContent: "center" },
  inviteRow: { flexDirection: "row", alignItems: "center", minHeight: HIT_SLOP_MIN, borderTopWidth: StyleSheet.hairlineWidth },
  inviteCheck: { width: layoutSpace.lg, height: layoutSpace.lg, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  inviteWho: { flex: 1 },
  summaryBox: { flexDirection: "row", alignItems: "flex-start", borderWidth: 1 },
  summaryText: { flex: 1 },
  limitCard: { borderWidth: 1 },
  actionButton: {
    minHeight: HIT_SLOP_MIN,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: layoutSpace.xs,
    borderWidth: 1,
    borderColor: "transparent",
    paddingVertical: layoutSpace.sm,
  },
  disabled: { opacity: 0.7 },
});
