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
import { useNotifications } from "@/context/NotificationContext";
import { apiGet, apiPost } from "@/utils/api";

interface Message {
  id: number;
  senderName: string;
  senderRole: string;
  body: string;
  createdAt: string;
}
interface ViewData {
  title: string;
  isTeacher: boolean;
  messages: Message[];
  pinned: Message[];
}
export default function ClassChatScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const batchId = Number(id);
  const colors = useColors();
  const { t, space } = useLayout();
  const { lastEvent } = useNotifications();
  const [view, setView] = useState<ViewData | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const load = useCallback(async () => {
    try {
      const next = await apiGet<ViewData>(`/class-groups/${batchId}/messages`);
      setView(next);
      setProblem("");
      const lastMessageId = next.messages.at(-1)?.id;
      if (lastMessageId) {
        try {
          await apiPost(`/class-groups/${batchId}/messages/read`, {
            lastMessageId,
          });
        } catch {
          // Reading the conversation succeeded. Keep it usable even if the small
          // acknowledgement request is interrupted; its badge remains until a retry.
        }
      }
    } catch (e) {
      setProblem(
        e instanceof Error ? e.message : "Could not load the conversation.",
      );
    }
  }, [batchId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (
      lastEvent?.kind === "class_message" &&
      Number(lastEvent.batchId) === batchId
    ) {
      void load();
    }
  }, [batchId, lastEvent, load]);
  const send = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await apiPost(`/class-groups/${batchId}/messages`, { body: draft });
      setDraft("");
      await load();
    } catch (e) {
      setProblem(
        e instanceof Error ? e.message : "Could not send that message.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <ClassGroupShell
      title="Class messages"
      eyebrow={view?.title ?? "Your class"}
    >
      {!view && !problem ? <ActivityIndicator color={colors.primary} /> : null}
      {problem ? (
        <ProgramNotice
          tone="stopped"
          title="Messages unavailable"
          body={problem}
        />
      ) : null}
      {view?.messages.length === 0 ? (
        <ProgramNotice
          title="The conversation starts here"
          body={
            view.isTeacher
              ? "Welcome students or share the first class update."
              : "Ask your teacher a class question here."
          }
        />
      ) : null}
      {view?.pinned.length ? (
        <View style={{ gap: space.sm }}>
          <Text style={[t.caption, { color: colors.primary }]}>
            PINNED BY YOUR TEACHER
          </Text>
          {view.pinned
            .filter(
              (pinned) =>
                !view.messages.some((message) => message.id === pinned.id),
            )
            .map((message) => (
              <ProgramNotice
                key={`pinned-${message.id}`}
                title={message.senderName}
                body={message.body}
              />
            ))}
        </View>
      ) : null}
      <View style={{ gap: space.sm }}>
        {view?.messages.map((message) => (
          <View
            key={message.id}
            style={{
              padding: space.md,
              borderRadius: 14,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              gap: space.xxs,
            }}
          >
            <Text style={[t.caption, { color: colors.primary }]}>
              {message.senderName} ·{" "}
              {message.senderRole === "teacher" ? "Teacher" : "Student"}
            </Text>
            <Text style={[t.body, { color: colors.foreground }]}>
              {message.body}
            </Text>
          </View>
        ))}
      </View>
      {view ? (
        <View style={{ gap: space.sm }}>
          <TextInput
            accessibilityLabel="Message"
            value={draft}
            onChangeText={setDraft}
            multiline
            placeholder="Write a class message"
            placeholderTextColor={colors.mutedForeground}
            style={[
              t.body,
              {
                minHeight: 96,
                padding: space.md,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.border,
                color: colors.foreground,
                backgroundColor: colors.card,
                textAlignVertical: "top",
              },
            ]}
          />
          <ProgramButton
            emphasis="primary"
            label={busy ? "Sending…" : "Send message"}
            disabled={busy || !draft.trim()}
            onPress={() => void send()}
          />
        </View>
      ) : null}
    </ClassGroupShell>
  );
}
