import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Text, TextInput, View } from "react-native";
import { ClassGroupShell } from "@/components/classes/ClassGroupShell";
import { NativeTimePicker } from "@/components/classes/NativeTimePicker";
import { HIT_SLOP_MIN } from "@/constants/layout";
import {
  HomeworkFileButton,
  HomeworkFilePicker,
} from "@/components/classes/HomeworkFileControls";
import { ProgramButton, ProgramNotice } from "@/components/programs/ProgramPieces";
import NepaliDatePicker from "@/components/NepaliDatePicker";
import { useDates } from "@/context/DatePreferenceContext";
import { useNotifications } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPost } from "@/utils/api";
import { homeworkDeadlineIso, homeworkDeadlineParts } from "@/utils/classHomework";
import { batchDateValue } from "@/utils/programBatches";
import { uploadFile, type UploadableFile } from "@/utils/uploadFile";

interface StoredFile {
  fileKey: string;
  fileName?: string | null;
}
interface Submission {
  id: number;
  note: string;
  studentName?: string;
  feedback?: string | null;
  status: string;
  submittedAt: string;
  file?: StoredFile | null;
  markedFile?: StoredFile | null;
}
interface Task {
  id: number;
  title: string;
  instructions: string | null;
  dueAt: string | null;
  status: string;
  questionFile?: StoredFile | null;
  submission?: Submission | null;
  submissions?: Submission[];
}
interface HomeworkView {
  title: string;
  isTeacher: boolean;
  tasks: Task[];
}

function fieldStyle(
  colors: { border: string; foreground: string },
  space: { sm: number },
) {
  return {
    minHeight: 48,
    padding: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.foreground,
  } as const;
}

export default function ClassHomeworkScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const batchId = Number(id);
  const colors = useColors();
  const dates = useDates();
  const { lastEvent } = useNotifications();
  const { t, space, radius } = useLayout();
  const [view, setView] = useState<HomeworkView | null>(null);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [questionFile, setQuestionFile] = useState<UploadableFile | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("18:00");
  const [pickingDate, setPickingDate] = useState(false);
  const [pickingTime, setPickingTime] = useState(false);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const createInFlight = useRef(false);
  const nepalToday = batchDateValue(homeworkDeadlineParts(new Date().toISOString())?.date ?? "") ?? new Date();
  const suggestedDeadline = batchDateValue(homeworkDeadlineParts(new Date(Date.now() + 86_400_000).toISOString())?.date ?? "") ?? nepalToday;
  const load = useCallback(async () => {
    try {
      setView(await apiGet<HomeworkView>(`/class-groups/${batchId}/homework`));
      setProblem("");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not load homework.");
    }
  }, [batchId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (
      lastEvent?.kind.startsWith("class_homework_") &&
      Number(lastEvent.batchId) === batchId
    ) {
      void load();
    }
  }, [batchId, lastEvent, load]);

  const create = async () => {
    if (createInFlight.current) return;
    const dueAt = dueDate ? homeworkDeadlineIso(dueDate, dueTime) : null;
    if (dueDate && !dueAt) {
      setProblem("Choose both a valid deadline date and time.");
      return;
    }
    createInFlight.current = true;
    setBusy(true);
    setProblem("");
    try {
      const fileKey = questionFile ? await uploadFile(questionFile) : undefined;
      await apiPost(`/class-groups/${batchId}/homework`, {
        title,
        instructions,
        dueAt,
        fileKey,
        fileName: questionFile?.name,
      });
      setTitle("");
      setInstructions("");
      setQuestionFile(null);
      setDueDate("");
      setDueTime("18:00");
      await load();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not set homework.");
    } finally {
      createInFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <ClassGroupShell title="Homework" eyebrow={view?.title ?? "Your class"}>
      {!view && !problem ? <ActivityIndicator color={colors.primary} /> : null}
      {problem ? <ProgramNotice tone="stopped" title="Homework unavailable" body={problem} /> : null}
      {view?.isTeacher ? (
        <View style={{ gap: space.sm, padding: space.md, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
          <Text style={[t.title3, { color: colors.foreground }]}>Set homework</Text>
          <Text style={[t.caption, { color: colors.mutedForeground }]}>Students can answer in writing, attach a photo, or upload a PDF.</Text>
          <TextInput
            accessibilityLabel="Homework title"
            value={title}
            onChangeText={setTitle}
            placeholder="Example: Algebra exercise 4"
            placeholderTextColor={colors.mutedForeground}
            style={[t.body, fieldStyle(colors, space)]}
          />
          <TextInput
            accessibilityLabel="Instructions"
            value={instructions}
            onChangeText={setInstructions}
            multiline
            placeholder="Example: Complete questions 1–8 and show your working."
            placeholderTextColor={colors.mutedForeground}
            style={[t.body, fieldStyle(colors, space), { minHeight: 84, textAlignVertical: "top" }]}
          />
          <View style={{ gap: space.xs }}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>Deadline (optional)</Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>Choose a Nepali calendar date and Nepal time. Students may still hand in late work.</Text>
            <ProgramButton
              label={dueDate && batchDateValue(dueDate) ? `Date: ${dates.formatBoth(batchDateValue(dueDate)!)}` : "Choose a deadline date"}
              icon="calendar"
              disabled={busy}
              onPress={() => setPickingDate(true)}
            />
            {dueDate ? Platform.OS === "web" ? (
              <View style={{ gap: space.xs }}>
                <Text style={[t.bodyStrong, { color: colors.foreground }]}>Deadline time · Nepal</Text>
                {React.createElement("input", {
                  type: "time",
                  value: dueTime,
                  disabled: busy,
                  "aria-label": "Homework deadline time in Nepal",
                  "data-testid": "class-homework-due-time",
                  onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDueTime(event.target.value),
                  style: {
                    minHeight: HIT_SLOP_MIN,
                    width: "100%",
                    boxSizing: "border-box",
                    color: colors.foreground,
                    background: colors.card,
                    border: `1px solid ${colors.border}`,
                    borderRadius: radius.sm,
                    padding: space.sm,
                    fontSize: t.body.fontSize,
                    fontFamily: t.body.fontFamily,
                  },
                })}
              </View>
            ) : (
              <ProgramButton label={`Time: ${dueTime} Nepal time`} icon="clock" disabled={busy} onPress={() => setPickingTime(true)} />
            ) : null}
            {dueDate ? <ProgramButton label="Remove deadline" emphasis="quiet" disabled={busy} onPress={() => setDueDate("")} /> : null}
          </View>
          <HomeworkFilePicker file={questionFile} onPick={setQuestionFile} label="Choose a question sheet (optional)" testID="class-homework-question-file" />
          <ProgramButton label={busy ? "Uploading and saving…" : "Set homework"} emphasis="primary" disabled={busy || !title.trim()} onPress={() => void create()} />
        </View>
      ) : null}
      {view?.tasks.length === 0 ? (
        <ProgramNotice title="No homework yet" body={view.isTeacher ? "Set a short, clear task when students have work to do." : "Your teacher has not set any homework."} />
      ) : null}
      {view?.tasks.map((task) => (
        <HomeworkTask key={task.id} batchId={batchId} task={task} isTeacher={view.isTeacher} onChanged={load} />
      ))}
      <NepaliDatePicker
        visible={pickingDate}
        value={batchDateValue(dueDate) ?? suggestedDeadline}
        minDate={nepalToday}
        title="Choose homework deadline"
        onCancel={() => setPickingDate(false)}
        onPick={(date) => {
          const pad = (value: number) => String(value).padStart(2, "0");
          setDueDate(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
          setPickingDate(false);
        }}
      />
      <NativeTimePicker
        visible={pickingTime}
        value={dueTime}
        title="Choose homework deadline time"
        onCancel={() => setPickingTime(false)}
        onPick={(time) => { setDueTime(time); setPickingTime(false); }}
      />
    </ClassGroupShell>
  );
}

function HomeworkTask({ batchId, task, isTeacher, onChanged }: { batchId: number; task: Task; isTeacher: boolean; onChanged: () => Promise<void> }) {
  const colors = useColors();
  const dates = useDates();
  const { t, space } = useLayout();
  const due = task.dueAt ? homeworkDeadlineParts(task.dueAt) : null;
  const dueLabel = due && batchDateValue(due.date)
    ? `${dates.formatBoth(batchDateValue(due.date)!)} · ${due.time} Nepal time`
    : null;
  const overdue = Boolean(task.dueAt && Date.parse(task.dueAt) < Date.now());
  return (
    <View style={{ gap: space.sm, padding: space.md, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
      <Text style={[t.title3, { color: colors.foreground }]}>{task.title}</Text>
      {task.instructions ? <Text style={[t.body, { color: colors.foreground }]}>{task.instructions}</Text> : null}
      {dueLabel ? <Text style={[t.bodyStrong, { color: overdue ? colors.destructive : colors.primary }]}>Due {dueLabel}</Text> : <Text style={[t.caption, { color: colors.mutedForeground }]}>No deadline</Text>}
      {!isTeacher && overdue && !task.submission ? <Text style={[t.caption, { color: colors.mutedForeground }]}>The deadline has passed, but you can still hand in your work.</Text> : null}
      {task.questionFile ? <HomeworkFileButton fileKey={task.questionFile.fileKey} label="Open question sheet" /> : null}
      {isTeacher ? (
        <View style={{ gap: space.sm }}>
          <Text style={[t.caption, { color: colors.mutedForeground }]}>{task.submissions?.length ?? 0} handed in</Text>
          {task.submissions?.length ? task.submissions.map((submission) => (
            <TeacherSubmission key={submission.id} batchId={batchId} homeworkId={task.id} submission={submission} onChanged={onChanged} />
          )) : <Text style={[t.caption, { color: colors.mutedForeground }]}>Nobody has handed this in yet.</Text>}
        </View>
      ) : (
        <StudentSubmission batchId={batchId} task={task} onChanged={onChanged} />
      )}
    </View>
  );
}

function StudentSubmission({ batchId, task, onChanged }: { batchId: number; task: Task; onChanged: () => Promise<void> }) {
  const colors = useColors();
  const { t, space } = useLayout();
  const [note, setNote] = useState(task.submission?.note ?? "");
  const [file, setFile] = useState<UploadableFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const handIn = async () => {
    setBusy(true);
    setProblem("");
    try {
      const fileKey = file ? await uploadFile(file) : undefined;
      await apiPost(`/class-groups/${batchId}/homework/${task.id}/submit`, { note, fileKey, fileName: file?.name });
      setFile(null);
      await onChanged();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not hand in your work.");
    } finally { setBusy(false); }
  };
  const submission = task.submission;
  return (
    <View style={{ gap: space.sm }}>
      {submission ? (
        <ProgramNotice title={submission.status === "returned" ? "Feedback returned" : "Handed in"} body={submission.status === "returned" ? (submission.feedback || "Your teacher attached a marked copy.") : "Your teacher can now review your work."} tone={submission.status === "returned" ? "live" : "neutral"} />
      ) : null}
      {submission?.file ? <HomeworkFileButton fileKey={submission.file.fileKey} label="Open what you handed in" /> : null}
      {submission?.markedFile ? <HomeworkFileButton fileKey={submission.markedFile.fileKey} label="Open marked copy" /> : null}
      <TextInput
        accessibilityLabel={`Answer for ${task.title}`}
        value={note}
        onChangeText={setNote}
        multiline
        placeholder="Write your answer or a note for your teacher"
        placeholderTextColor={colors.mutedForeground}
        style={[t.body, fieldStyle(colors, space), { minHeight: 84, textAlignVertical: "top" }]}
      />
      <HomeworkFilePicker file={file} onPick={setFile} label={submission ? "Choose a replacement photo or PDF" : "Choose a photo or PDF (optional)"} testID={`class-homework-file-${task.id}`} />
      {submission ? <Text style={[t.caption, { color: colors.mutedForeground }]}>Handing in again replaces your earlier answer and clears earlier feedback.</Text> : null}
      {problem ? <Text style={[t.caption, { color: colors.destructive }]}>{problem}</Text> : null}
      <ProgramButton label={busy ? "Uploading…" : submission ? "Hand in again" : "Hand in"} emphasis="primary" disabled={busy || (!note.trim() && !file)} onPress={() => void handIn()} />
    </View>
  );
}

function TeacherSubmission({ batchId, homeworkId, submission, onChanged }: { batchId: number; homeworkId: number; submission: Submission; onChanged: () => Promise<void> }) {
  const colors = useColors();
  const { t, space } = useLayout();
  const [feedback, setFeedback] = useState(submission.feedback ?? "");
  const [file, setFile] = useState<UploadableFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const send = async () => {
    setBusy(true);
    setProblem("");
    try {
      const fileKey = file ? await uploadFile(file) : undefined;
      await apiPost(`/class-groups/${batchId}/homework/${homeworkId}/submissions/${submission.id}/feedback`, { feedback, fileKey, fileName: file?.name });
      setFile(null);
      await onChanged();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not return feedback.");
    } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: space.sm, padding: space.sm, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
      <Text style={[t.bodyStrong, { color: colors.foreground }]}>{submission.studentName || "Student"}</Text>
      {submission.note ? <Text style={[t.body, { color: colors.foreground }]}>“{submission.note}”</Text> : null}
      {submission.file ? <HomeworkFileButton fileKey={submission.file.fileKey} label="Open submitted work" /> : null}
      <TextInput
        accessibilityLabel={`Feedback for ${submission.studentName || "student"}`}
        value={feedback}
        onChangeText={setFeedback}
        multiline
        placeholder="Write clear, encouraging feedback"
        placeholderTextColor={colors.mutedForeground}
        style={[t.body, fieldStyle(colors, space), { minHeight: 76, textAlignVertical: "top" }]}
      />
      <HomeworkFilePicker file={file} onPick={setFile} label="Choose a marked copy (optional)" />
      {submission.status === "returned" ? <Text style={[t.caption, { color: colors.primary }]}>Feedback already returned. Sending again updates it.</Text> : null}
      {problem ? <Text style={[t.caption, { color: colors.destructive }]}>{problem}</Text> : null}
      <ProgramButton label={busy ? "Returning…" : "Return feedback"} emphasis="secondary" disabled={busy || (!feedback.trim() && !file)} onPress={() => void send()} />
    </View>
  );
}
