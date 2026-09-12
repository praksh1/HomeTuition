import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { ClassGroupShell } from "@/components/classes/ClassGroupShell";
import {
  ProgramButton,
  ProgramNotice,
} from "@/components/programs/ProgramPieces";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPost } from "@/utils/api";
interface Submission {
  id: number;
  note: string;
  studentName?: string;
  feedback?: string | null;
}
interface Task {
  id: number;
  title: string;
  instructions: string | null;
  status: string;
  submission?: Submission | null;
  submissions?: Submission[];
}
interface HomeworkView {
  title: string;
  isTeacher: boolean;
  tasks: Task[];
}
export default function ClassHomeworkScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const batchId = Number(id);
  const colors = useColors();
  const { t, space } = useLayout();
  const [view, setView] = useState<HomeworkView | null>(null);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setView(await apiGet<HomeworkView>(`/class-groups/${batchId}/homework`));
      setProblem("");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not load homework.");
    }
  }, [batchId]);
  useEffect(() => {
    void load();
  }, [load]);
  const create = async () => {
    setBusy(true);
    try {
      await apiPost(`/class-groups/${batchId}/homework`, {
        title,
        instructions,
      });
      setTitle("");
      setInstructions("");
      await load();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not set homework.");
    } finally {
      setBusy(false);
    }
  };
  const submit = async (taskId: number) => {
    const note = answers[taskId]?.trim();
    if (!note) return;
    setBusy(true);
    try {
      await apiPost(`/class-groups/${batchId}/homework/${taskId}/submit`, {
        note,
      });
      await load();
    } catch (e) {
      setProblem(
        e instanceof Error ? e.message : "Could not hand in homework.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <ClassGroupShell title="Homework" eyebrow={view?.title ?? "Your class"}>
      {!view && !problem ? <ActivityIndicator color={colors.primary} /> : null}
      {problem ? (
        <ProgramNotice
          tone="stopped"
          title="Homework unavailable"
          body={problem}
        />
      ) : null}
      {view?.isTeacher ? (
        <View
          style={{
            gap: space.sm,
            padding: space.md,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <Text style={[t.title3, { color: colors.foreground }]}>
            Set homework
          </Text>
          <TextInput
            accessibilityLabel="Homework title"
            value={title}
            onChangeText={setTitle}
            placeholder="Example: Algebra exercise 4"
            placeholderTextColor={colors.mutedForeground}
            style={[
              t.body,
              {
                minHeight: 48,
                padding: space.sm,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                color: colors.foreground,
              },
            ]}
          />
          <TextInput
            accessibilityLabel="Instructions"
            value={instructions}
            onChangeText={setInstructions}
            multiline
            placeholder="What should students complete?"
            placeholderTextColor={colors.mutedForeground}
            style={[
              t.body,
              {
                minHeight: 84,
                padding: space.sm,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                color: colors.foreground,
                textAlignVertical: "top",
              },
            ]}
          />
          <ProgramButton
            label={busy ? "Saving…" : "Set homework"}
            emphasis="primary"
            disabled={busy || !title.trim()}
            onPress={() => void create()}
          />
        </View>
      ) : null}
      {view?.tasks.length === 0 ? (
        <ProgramNotice
          title="No homework yet"
          body={
            view.isTeacher
              ? "Set a short, clear task when students have work to do."
              : "Your teacher has not set any homework."
          }
        />
      ) : null}
      <View style={{ gap: space.md }}>
        {view?.tasks.map((task) => (
          <View
            key={task.id}
            style={{
              gap: space.sm,
              padding: space.md,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            <Text style={[t.title3, { color: colors.foreground }]}>
              {task.title}
            </Text>
            {task.instructions ? (
              <Text style={[t.body, { color: colors.foreground }]}>
                {task.instructions}
              </Text>
            ) : null}
            {view.isTeacher ? (
              <Text style={[t.caption, { color: colors.mutedForeground }]}>
                {task.submissions?.length ?? 0} handed in
              </Text>
            ) : task.submission ? (
              <ProgramNotice
                title="Handed in"
                body={task.submission.note}
                tone="neutral"
              />
            ) : (
              <>
                <TextInput
                  accessibilityLabel={`Answer for ${task.title}`}
                  value={answers[task.id] ?? ""}
                  onChangeText={(note) =>
                    setAnswers((old) => ({ ...old, [task.id]: note }))
                  }
                  multiline
                  placeholder="Write your answer or a note for your teacher"
                  placeholderTextColor={colors.mutedForeground}
                  style={[
                    t.body,
                    {
                      minHeight: 84,
                      padding: space.sm,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 10,
                      color: colors.foreground,
                      textAlignVertical: "top",
                    },
                  ]}
                />
                <ProgramButton
                  label="Hand in"
                  emphasis="primary"
                  disabled={busy || !answers[task.id]?.trim()}
                  onPress={() => void submit(task.id)}
                />
              </>
            )}
          </View>
        ))}
      </View>
    </ClassGroupShell>
  );
}
