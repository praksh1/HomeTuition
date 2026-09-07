import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useReducer, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { HIT_SLOP_MIN, radius as layoutRadius, readingWidth, space as layoutSpace } from "@/constants/layout";
import { useDates } from "@/context/DatePreferenceContext";
import { apiGet, apiPost, ApiError } from "@/utils/api";
import { openAttachment } from "@/utils/openAttachment";
import { uploadFile, type UploadableFile } from "@/utils/uploadFile";
import { submissionsLoadReducer } from "@/utils/monthlyJourneyState";

interface Submission {
  id: number;
  homeworkId: number;
  studentId: number;
  studentName?: string;
  fileKey: string;
  fileType: string;
  note: string | null;
  submittedAt: string;
  status: string;
  feedback: string | null;
  annotatedKey: string | null;
  returnedAt: string | null;
}

interface Homework {
  id: number;
  title: string;
  instructions: string | null;
  fileKey: string | null;
  fileType: string | null;
  dueAt: string | null;
  status: string;
  createdAt: string;
  handedIn?: number;
  marked?: number;
  submission?: Submission | null;
}

interface HomeworkView {
  homework: Homework[];
  asTeacher: boolean;
  canSubmit?: boolean;
}

/**
 * Homework, from whichever side you are on.
 *
 * One screen for both, because the thing itself is one thing — a teacher sets it, a student
 * does it, the teacher marks it — and two screens would mean two places for the words to drift
 * apart.
 */
export default function MonthlyHomeworkScreen() {
  const colors = useColors();
  const { t, gutter, space } = useLayout();
  const insets = useSafeAreaInsets();
  const { formatBoth } = useDates();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const classId = Number(id);

  const [view, setView] = useState<HomeworkView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [setting, setSetting] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isInteger(classId)) {
      setProblem("This class link is not valid.");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      setView(await apiGet<HomeworkView>(`/monthly/classes/${classId}/homework`));
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not load the homework.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [classId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + space.sm, paddingHorizontal: gutter, borderBottomColor: colors.border }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[t.title3, { color: colors.foreground }]}>Homework</Text>
        {view?.asTeacher ? (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={setting ? "Close new homework form" : "Set new homework"} testID="homework-new" onPress={() => setSetting((v) => !v)} style={styles.backBtn}>
            <Feather name={setting ? "x" : "plus"} size={22} color={colors.primary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingHorizontal: gutter, paddingBottom: insets.bottom + space.xxxl }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {problem && (
          <View style={[styles.notice, { backgroundColor: colors.destructiveSoft, borderColor: colors.destructive }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <View style={styles.noticeCopy}>
              <Text style={[t.bodyStrong, { color: colors.destructive }]}>Homework did not load</Text>
              <Text style={[t.callout, { color: colors.foreground }]}>{problem}</Text>
              {!view && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Try loading homework again" onPress={() => void load()} style={styles.retryBtn}>
                <Text style={[t.bodyStrong, { color: colors.primary }]}>Try again</Text>
              </TouchableOpacity>}
            </View>
          </View>
        )}

        {setting && view?.asTeacher && (
          <SetHomework
            classId={classId}
            onDone={async () => {
              setSetting(false);
              await load();
            }}
          />
        )}

        {view && view.homework.length === 0 && !setting && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[t.callout, { color: colors.mutedForeground }]}>
              {view?.asTeacher
                ? "You have not set any homework yet. Tap + to set some."
                : "Your teacher has not set any homework yet."}
            </Text>
          </View>
        )}

        {view?.homework.map((homework) => (
          <HomeworkCard
            key={homework.id}
            homework={homework}
            asTeacher={view.asTeacher}
            canSubmit={view.canSubmit === true}
            formatBoth={formatBoth}
            onChanged={load}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/* -------------------------------------------------------------- setting it */

function SetHomework({ classId, onDone }: { classId: number; onDone: () => Promise<void> }) {
  const colors = useColors();
  const { t } = useLayout();
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [file, setFile] = useState<UploadableFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) {
      setProblem("Homework needs a title.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      let fileKey: string | undefined;
      let fileType: string | undefined;
      if (file) {
        fileKey = await uploadFile(file);
        fileType = file.mimeType;
      }
      await apiPost(`/monthly/classes/${classId}/homework`, {
        title: title.trim(),
        instructions: instructions.trim() || undefined,
        fileKey,
        fileType,
      });
      setTitle("");
      setInstructions("");
      setFile(null);
      await onDone();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not set that homework.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[t.title3, { color: colors.foreground }]}>Set homework</Text>

      <TextInput
        testID="homework-title"
        value={title}
        onChangeText={setTitle}
        placeholder="Algebra sheet 3"
        placeholderTextColor={colors.mutedForeground}
        style={[t.body, styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
      />
      <TextInput
        testID="homework-instructions"
        value={instructions}
        onChangeText={setInstructions}
        placeholder="What to do — for example, questions 1 to 10 on page 62"
        placeholderTextColor={colors.mutedForeground}
        multiline
        style={[
          styles.input,
          styles.multiline,
          t.body,
          { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
        ]}
      />

      {/* The sheet is optional on purpose: a teacher working from a textbook has nothing to attach. */}
      <FilePickerRow file={file} onPick={setFile} label="Attach a question sheet (optional)" testID="homework-file" />

      {problem && <Text style={[t.caption, styles.problemText, { color: colors.destructive }]}>{problem}</Text>}

      <TouchableOpacity
        testID="homework-set"
        onPress={() => void submit()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Set homework"
        accessibilityState={{ disabled: busy }}
        style={[styles.primaryBtn, { backgroundColor: busy ? colors.muted : colors.primary }]}
        activeOpacity={0.85}
      >
        {busy ? <ActivityIndicator color={colors.mutedForeground} /> : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Set homework</Text>}
      </TouchableOpacity>
    </View>
  );
}

/* ------------------------------------------------------------- one homework */

function HomeworkCard({
  homework,
  asTeacher,
  canSubmit,
  formatBoth,
  onChanged,
}: {
  homework: Homework;
  asTeacher: boolean;
  canSubmit: boolean;
  formatBoth: (v: string | number | Date) => string;
  onChanged: () => Promise<void>;
}) {
  const colors = useColors();
  const { t, numeric } = useLayout();
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={[t.title3, { color: colors.foreground }]}>{homework.title}</Text>
          <Text style={[t.caption, { color: colors.mutedForeground }]}>
            Set {formatBoth(homework.createdAt)}
            {homework.status === "closed" ? " · closed" : ""}
          </Text>
        </View>
        {asTeacher && (
          <View style={[styles.countPill, { backgroundColor: colors.actionSoft }]}>
            <Text style={[t.caption, numeric, { color: colors.primary }]}>
              {homework.handedIn === undefined || homework.marked === undefined
                ? "Submission totals unavailable"
                : `${homework.handedIn} handed in · ${homework.marked} marked`}
            </Text>
          </View>
        )}
      </View>

      {homework.instructions && (
        <Text style={[t.body, styles.instructions, { color: colors.foreground }]}>{homework.instructions}</Text>
      )}

      {homework.fileKey && <OpenFileButton fileKey={homework.fileKey} label="Open the question sheet" />}

      {asTeacher ? (
        <>
          <TouchableOpacity
            testID={`homework-open-${homework.id}`}
            onPress={() => setOpen((v) => !v)}
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={open ? `Hide submissions for ${homework.title}` : `Show submissions for ${homework.title}`}
            accessibilityState={{ expanded: open }}
          >
            <Text style={[t.callout, { color: colors.foreground }]}>
              {open ? "Hide what came in" : "See what came in"}
            </Text>
          </TouchableOpacity>
          {open && <Submissions homeworkId={homework.id} formatBoth={formatBoth} onChanged={onChanged} />}
        </>
      ) : (
        <StudentSide homework={homework} canSubmit={canSubmit} formatBoth={formatBoth} onChanged={onChanged} />
      )}
    </View>
  );
}

/* --------------------------------------------------------- the student side */

function StudentSide({
  homework,
  canSubmit,
  formatBoth,
  onChanged,
}: {
  homework: Homework;
  canSubmit: boolean;
  formatBoth: (v: string | number | Date) => string;
  onChanged: () => Promise<void>;
}) {
  const colors = useColors();
  const { t } = useLayout();
  const [file, setFile] = useState<UploadableFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submission = homework.submission ?? null;

  const hand = async () => {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const fileKey = await uploadFile(file);
      await apiPost(`/monthly/homework/${homework.id}/submit`, { fileKey, fileType: file.mimeType });
      setFile(null);
      await onChanged();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not hand that in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      {submission && (
        <View style={[styles.subBox, { borderColor: colors.border }]}>
          <Text style={[t.callout, styles.subLine, { color: colors.foreground }]}>
            You handed this in on {formatBoth(submission.submittedAt)}.
          </Text>
          <OpenFileButton fileKey={submission.fileKey} label="Open what you handed in" />

          {submission.status === "returned" ? (
            <View style={[styles.marked, { backgroundColor: colors.actionSoft, borderColor: colors.primary }]}>
              <Text style={[t.caption, styles.markedTitle, { color: colors.primary }]}>Marked</Text>
              {submission.feedback && (
                <Text style={[t.callout, styles.subLine, { color: colors.foreground }]}>{submission.feedback}</Text>
              )}
              {submission.annotatedKey && (
                <OpenFileButton fileKey={submission.annotatedKey} label="Open your marked copy" />
              )}
            </View>
          ) : (
            <Text style={[t.caption, styles.subHint, { color: colors.mutedForeground }]}>Waiting to be marked.</Text>
          )}
        </View>
      )}

      {homework.status === "closed" ? (
        <Text style={[t.caption, styles.subHint, { color: colors.mutedForeground }]}>
          This homework is closed, so it can no longer be handed in.
        </Text>
      ) : canSubmit ? (
        <>
          <FilePickerRow
            file={file}
            onPick={setFile}
            label={submission ? "Hand in a different file" : "Attach your work"}
            testID={`homework-pick-${homework.id}`}
          />
          {/*
            Said plainly, because it surprises people.

            Handing in again replaces what was there, and takes the marking with it. A student
            who has already been marked and uploads a clearer photo should know that before they
            do it, not afterwards.
          */}
          {submission && (
            <Text style={[t.caption, styles.subHint, { color: colors.mutedForeground }]}>
              This replaces what you handed in before
              {submission.status === "returned" ? ", and your marking will be cleared" : ""}.
            </Text>
          )}
          {problem && <Text style={[t.caption, styles.problemText, { color: colors.destructive }]}>{problem}</Text>}
          {file && (
            <TouchableOpacity
              testID={`homework-submit-${homework.id}`}
              onPress={() => void hand()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Hand in ${homework.title}`}
              accessibilityState={{ disabled: busy }}
              style={[styles.primaryBtn, { backgroundColor: busy ? colors.muted : colors.primary }]}
              activeOpacity={0.85}
            >
              {busy ? <ActivityIndicator color={colors.mutedForeground} /> : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Hand it in</Text>}
            </TouchableOpacity>
          )}
        </>
      ) : (
        <Text style={[t.caption, styles.subHint, { color: colors.mutedForeground }]}>
          Your month has ended, so you can read this but not hand work in.
        </Text>
      )}
    </View>
  );
}

/* --------------------------------------------------------- the teacher side */

function Submissions({
  homeworkId,
  formatBoth,
  onChanged,
}: {
  homeworkId: number;
  formatBoth: (v: string | number | Date) => string;
  onChanged: () => Promise<void>;
}) {
  const colors = useColors();
  const { t, space } = useLayout();
  const [{ rows, problem }, dispatch] = useReducer(submissionsLoadReducer<Submission>, {
    rows: null,
    problem: null,
  });

  const load = useCallback(async () => {
    try {
      const found = await apiGet<{ submissions: Submission[] }>(`/monthly/homework/${homeworkId}/submissions`);
      dispatch({ type: "loaded", rows: found.submissions ?? [] });
    } catch (e) {
      dispatch({ type: "failed", problem: e instanceof Error ? e.message : "Could not load what came in." });
    }
  }, [homeworkId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (problem) return <View style={styles.inlineProblem}><Text style={[t.caption, styles.problemText, { color: colors.destructive }]}>{problem}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Try loading submissions again" onPress={() => void load()} style={styles.retryBtn}><Text style={[t.bodyStrong, { color: colors.primary }]}>Try again</Text></TouchableOpacity></View>;
  if (!rows) return <ActivityIndicator color={colors.primary} style={{ marginTop: space.sm }} />;
  if (rows.length === 0) {
    return <Text style={[t.caption, styles.subHint, { color: colors.mutedForeground }]}>Nobody has handed anything in yet.</Text>;
  }

  return (
    <View>
      {rows.map((row) => (
        <MarkOne
          key={row.id}
          submission={row}
          formatBoth={formatBoth}
          onMarked={async () => {
            await load();
            await onChanged();
          }}
        />
      ))}
    </View>
  );
}

function MarkOne({
  submission,
  formatBoth,
  onMarked,
}: {
  submission: Submission;
  formatBoth: (v: string | number | Date) => string;
  onMarked: () => Promise<void>;
}) {
  const colors = useColors();
  const { t } = useLayout();
  const [feedback, setFeedback] = useState(submission.feedback ?? "");
  const [file, setFile] = useState<UploadableFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setProblem(null);
    try {
      let annotatedKey: string | undefined;
      let annotatedType: string | undefined;
      if (file) {
        annotatedKey = await uploadFile(file);
        annotatedType = file.mimeType;
      }
      await apiPost(`/monthly/submissions/${submission.id}/return`, {
        feedback: feedback.trim() || undefined,
        annotatedKey,
        annotatedType,
      });
      setFile(null);
      await onMarked();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not hand that back.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.subBox, { borderColor: colors.border }]}>
      <Text style={[t.bodyStrong, { color: colors.foreground }]}>{submission.studentName || "A student"}</Text>
      <Text style={[t.caption, styles.subHint, { color: colors.mutedForeground }]}>
        Handed in {formatBoth(submission.submittedAt)}
        {submission.status === "returned" ? " · marked" : ""}
      </Text>
      {submission.note && <Text style={[t.callout, styles.subLine, { color: colors.foreground }]}>“{submission.note}”</Text>}

      <OpenFileButton fileKey={submission.fileKey} label="Open their work" />

      <TextInput
        testID={`mark-feedback-${submission.id}`}
        value={feedback}
        onChangeText={setFeedback}
        placeholder="What you want to say to this student"
        placeholderTextColor={colors.mutedForeground}
        multiline
        style={[
          styles.input,
          styles.multiline,
          t.body,
          { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
        ]}
      />
      <FilePickerRow file={file} onPick={setFile} label="Attach a marked-up copy (optional)" testID={`mark-file-${submission.id}`} />

      {problem && <Text style={[t.caption, styles.problemText, { color: colors.destructive }]}>{problem}</Text>}

      <TouchableOpacity
        testID={`mark-return-${submission.id}`}
        onPress={() => void send()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Return marked work to ${submission.studentName || "student"}`}
        accessibilityState={{ disabled: busy }}
        style={[styles.primaryBtn, { backgroundColor: busy ? colors.muted : colors.primary }]}
        activeOpacity={0.85}
      >
        {busy ? <ActivityIndicator color={colors.mutedForeground} /> : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Hand it back</Text>}
      </TouchableOpacity>
    </View>
  );
}

/* -------------------------------------------------------------- shared bits */

function FilePickerRow({
  file,
  onPick,
  label,
  testID,
}: {
  file: UploadableFile | null;
  onPick: (f: UploadableFile | null) => void;
  label: string;
  testID?: string;
}) {
  const colors = useColors();
  const { t } = useLayout();

  const choose = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/*", "application/pdf"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    onPick({
      uri: asset.uri,
      name: asset.name ?? "work",
      mimeType: asset.mimeType ?? "application/octet-stream",
      size: asset.size ?? 1,
    });
  };

  return (
    <TouchableOpacity
      testID={testID}
      onPress={() => void choose()}
      style={[styles.pickRow, { borderColor: colors.border }]}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={file ? `Choose a different file. Selected ${file.name}` : label}
    >
      <Feather name={file ? "check-circle" : "paperclip"} size={16} color={file ? colors.primary : colors.mutedForeground} />
      <Text style={[t.callout, styles.pickText, { color: file ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>
        {file ? file.name : label}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * Opens a stored file.
 *
 * The link is asked for at the moment it is needed and dies in ten minutes, so there is nothing
 * to leak by leaving this screen open. The bytes never pass through the app.
 */
function OpenFileButton({ fileKey, label }: { fileKey: string; label: string }) {
  const colors = useColors();
  const { t } = useLayout();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setProblem(null);
    // See utils/openAttachment.ts: the tab has to be claimed inside the tap, before the link
    // is fetched, or Safari refuses to open it and nothing at all happens.
    const result = await openAttachment(fileKey);
    if (!result.ok) setProblem(result.reason ?? "Could not open that file.");
    setBusy(false);
  };

  return (
    <View>
      <TouchableOpacity
        onPress={() => void open()}
        disabled={busy}
        style={[styles.fileBtn, { borderColor: colors.primary }]}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Feather name="download" size={15} color={colors.primary} />
        )}
        <Text style={[t.callout, { color: colors.primary }]}>{label}</Text>
      </TouchableOpacity>
      {problem && <Text style={[t.caption, styles.problemText, { color: colors.destructive }]}>{problem}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: layoutSpace.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center" },
  scroll: { paddingTop: layoutSpace.md, width: "100%", maxWidth: readingWidth, alignSelf: "center" },
  card: { borderRadius: layoutRadius.md, borderWidth: StyleSheet.hairlineWidth, padding: layoutSpace.md, marginBottom: layoutSpace.md },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: layoutSpace.xs },
  cardWhen: { marginTop: layoutSpace.xxs },
  countPill: { borderRadius: layoutRadius.pill, paddingHorizontal: layoutSpace.sm, paddingVertical: layoutSpace.xxs },
  instructions: { marginTop: layoutSpace.sm },
  input: {
    borderRadius: layoutRadius.xs,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: layoutSpace.sm,
    paddingVertical: layoutSpace.sm,
    marginTop: layoutSpace.xs,
    minHeight: HIT_SLOP_MIN,
  },
  multiline: { minHeight: layoutSpace.huge + layoutSpace.xxl, textAlignVertical: "top" },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: layoutSpace.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: layoutRadius.xs,
    borderStyle: "dashed",
    paddingHorizontal: layoutSpace.sm,
    paddingVertical: layoutSpace.sm,
    marginTop: layoutSpace.xs,
    minHeight: HIT_SLOP_MIN,
  },
  pickText: { flex: 1 },
  primaryBtn: { borderRadius: layoutRadius.sm, minHeight: HIT_SLOP_MIN, paddingHorizontal: layoutSpace.md, justifyContent: "center", alignItems: "center", marginTop: layoutSpace.sm },
  secondaryBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: layoutRadius.sm,
    minHeight: HIT_SLOP_MIN,
    justifyContent: "center",
    alignItems: "center",
    marginTop: layoutSpace.sm,
  },
  subBox: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: layoutSpace.md, marginTop: layoutSpace.md },
  subLine: { marginTop: layoutSpace.xxs },
  subHint: { marginTop: layoutSpace.xs },
  marked: { borderRadius: layoutRadius.sm, borderWidth: StyleSheet.hairlineWidth, padding: layoutSpace.sm, marginTop: layoutSpace.xs },
  markedTitle: { marginBottom: layoutSpace.xxs },
  fileBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: layoutSpace.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: layoutRadius.sm,
    paddingHorizontal: layoutSpace.sm,
    minHeight: HIT_SLOP_MIN,
    marginTop: layoutSpace.xs,
    alignSelf: "flex-start",
  },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: layoutSpace.xs,
    padding: layoutSpace.sm,
    borderRadius: layoutRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: layoutSpace.md,
  },
  noticeCopy: { flex: 1, gap: layoutSpace.xxs },
  retryBtn: { minHeight: HIT_SLOP_MIN, justifyContent: "center", alignSelf: "flex-start" },
  inlineProblem: { marginTop: layoutSpace.xs },
  problemText: { marginTop: layoutSpace.xs },
});
