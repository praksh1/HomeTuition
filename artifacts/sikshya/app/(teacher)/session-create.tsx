import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
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
import { useColors } from "@/hooks/useColors";
import { useNotifications } from "@/context/NotificationContext";
import { scheduleSessionReminder } from "@/utils/notifications";
import type { Teacher } from "@/context/AuthContext";

const FALLBACK_SUBJECTS = ["Mathematics", "Science", "English", "Nepali", "Computer Science", "History", "Geography", "Economics"];
const CUSTOM_SUBJECT_OPTION = "Create your own";
const DURATIONS = [30, 45, 60];
const MAX_STUDENTS_OPTIONS = [5, 10, 15, 20];

export default function SessionCreate() {
  const { user } = useAuth();
  const colors = useColors();
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
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const { refresh: refreshNotifs, preferences } = useNotifications();

  React.useEffect(() => {
    (async () => {
      try {
        const res = await apiGet<{ subjects: string[] }>("/sessions/subjects");
        if (res.subjects?.length) setSubjects(res.subjects);
      } catch {}
    })();
  }, []);

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
      if (Platform.OS === "web") window.alert("Error\n\nFailed to create session. Please check your inputs and try again.");
      else Alert.alert("Error", "Failed to create session. Please check your inputs and try again.");
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
        if (Platform.OS === "web") window.alert("Error\n\nFailed to start the live session. Please try again.");
        else Alert.alert("Error", "Failed to start the live session. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 120 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="x" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>New Session</Text>
          <View style={{ width: 38 }} />
        </View>

        <Section title="Subject">
          <View style={styles.chipGrid}>
            {subjects.map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.chip, { borderColor: !isCustomSubject && subject === s ? colors.primary : colors.border, backgroundColor: !isCustomSubject && subject === s ? colors.primary + "12" : colors.muted }]}
                onPress={() => { setIsCustomSubject(false); setSubject(s); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, { color: !isCustomSubject && subject === s ? colors.primary : colors.mutedForeground }]}>{s}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.chip, { flexDirection: "row", alignItems: "center", borderColor: isCustomSubject ? colors.primary : colors.border, backgroundColor: isCustomSubject ? colors.primary + "12" : colors.muted }]}
              onPress={() => setIsCustomSubject(true)}
              activeOpacity={0.7}
            >
              <Feather name="plus" size={12} color={isCustomSubject ? colors.primary : colors.mutedForeground} style={{ marginRight: 4 }} />
              <Text style={[styles.chipText, { color: isCustomSubject ? colors.primary : colors.mutedForeground }]}>{CUSTOM_SUBJECT_OPTION}</Text>
            </TouchableOpacity>
          </View>
          {isCustomSubject && (
            <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border, marginTop: 4 }]}>
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
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
          <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              placeholder="e.g. Calculus: Introduction to Derivatives"
              placeholderTextColor={colors.mutedForeground}
              value={topic}
              onChangeText={setTopic}
            />
          </View>
        </Section>

        <Section title="Description">
          <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <TextInput
              style={[styles.input, { color: colors.foreground, minHeight: 70 }]}
              placeholder="What will students learn in this session?"
              placeholderTextColor={colors.mutedForeground}
              value={description}
              onChangeText={setDescription}
              multiline
              textAlignVertical="top"
            />
          </View>
        </Section>

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Section title="Date *">
              <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Feather name="calendar" size={16} color={colors.mutedForeground} style={{ marginRight: 8 }} />
                {Platform.OS === "web" ? (
                  React.createElement("input", {
                    type: "date",
                    value: date,
                    onChange: (e: any) => setDate(e.target.value),
                    style: {
                      flex: 1,
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      fontSize: 15,
                      fontFamily: "Inter_400Regular",
                      color: colors.foreground,
                      width: "100%",
                      colorScheme: colors.background === "#0A0A0A" || colors.background === "#000000" ? "dark" : "light",
                    },
                  })
                ) : (
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.mutedForeground}
                    value={date}
                    onChangeText={setDate}
                  />
                )}
              </View>
            </Section>
          </View>
          <View style={{ flex: 1 }}>
            <Section title="Time *">
              <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Feather name="clock" size={16} color={colors.mutedForeground} style={{ marginRight: 8 }} />
                {Platform.OS === "web" ? (
                  React.createElement("input", {
                    type: "time",
                    value: time,
                    onChange: (e: any) => setTime(e.target.value),
                    style: {
                      flex: 1,
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      fontSize: 15,
                      fontFamily: "Inter_400Regular",
                      color: colors.foreground,
                      width: "100%",
                      colorScheme: colors.background === "#0A0A0A" || colors.background === "#000000" ? "dark" : "light",
                    },
                  })
                ) : (
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
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
                style={[styles.pillChip, { borderColor: duration === d ? colors.primary : colors.border, backgroundColor: duration === d ? colors.primary : colors.muted }]}
                onPress={() => setDuration(d)}
                activeOpacity={0.7}
              >
                <Text style={[styles.pillText, { color: duration === d ? "#fff" : colors.mutedForeground }]}>{d} min</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Section>

        <Section title="Max Students (max 20)">
          <View style={styles.chipRow}>
            {MAX_STUDENTS_OPTIONS.map((n) => (
              <TouchableOpacity
                key={n}
                style={[styles.pillChip, { borderColor: maxStudents === n ? colors.primary : colors.border, backgroundColor: maxStudents === n ? colors.primary : colors.muted }]}
                onPress={() => setMaxStudents(n)}
                activeOpacity={0.7}
              >
                <Text style={[styles.pillText, { color: maxStudents === n ? "#fff" : colors.mutedForeground }]}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Section>

        <Section title="Session Price (NPR)">
          <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Text style={[styles.currency, { color: colors.mutedForeground }]}>NPR</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              placeholder="500"
              placeholderTextColor={colors.mutedForeground}
              value={price}
              onChangeText={setPrice}
              keyboardType="numeric"
            />
          </View>
        </Section>

        <View style={[styles.summaryBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Feather name="info" size={15} color={colors.mutedForeground} />
          <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>
            Sikshya records all sessions. Copyrights belong to the platform. Student payments are processed securely via eSewa/Khalti.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.goLiveBtn, { backgroundColor: colors.success }, saving && { opacity: 0.7 }]}
          onPress={handleGoLive}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Feather name="radio" size={20} color="#fff" />
          <Text style={styles.createBtnText}>Create & Go Live Now</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.createBtn, { backgroundColor: colors.primary }, saving && { opacity: 0.7 }]}
          onPress={handleCreate}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Feather name="calendar" size={20} color="#fff" />
          <Text style={styles.createBtnText}>{saving ? "Saving..." : "Schedule for Later"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 20 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { width: 38, height: 38, justifyContent: "center" },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  section: { gap: 10 },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 13 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  currency: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginRight: 8 },
  row: { flexDirection: "row", gap: 12 },
  chipRow: { flexDirection: "row", gap: 10 },
  pillChip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 9 },
  pillText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  summaryBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 14, borderWidth: 1, padding: 14 },
  summaryText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  goLiveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 16, paddingVertical: 17 },
  createBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 16, paddingVertical: 17 },
  createBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
