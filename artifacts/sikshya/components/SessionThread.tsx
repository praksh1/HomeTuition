import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/utils/api";
import { useNotifications } from "@/context/NotificationContext";

/**
 * The message thread that belongs to one class.
 *
 * The owner asked for "a Session Group Messaging link on this page for session-specific chat
 * (used for late notices and refund evidence)", and both of those uses rule out the chat that
 * already exists inside a lesson: that one lives in the classroom hub's memory, so it is gone
 * when the room empties, and it can only be reached by joining the call — which is no use to a
 * teacher who is running late and has not arrived, or to a student arguing about a lesson that
 * finished three weeks ago.
 *
 * So this is a written-down thread, shared by the teacher and everybody who paid, readable and
 * writable from the class's own page by both roles.
 */

export interface ThreadMessage {
  id: number;
  senderId: number;
  senderName: string;
  senderRole: string;
  body: string;
  createdAt: string;
  mine: boolean;
}

interface Props {
  sessionId: number | string;
  /** Shown above the thread, so a student knows who else can read what they write. */
  audienceHint?: string;
}

export default function SessionThread({ sessionId, audienceHint }: Props) {
  const colors = useColors();
  const { lastEvent } = useNotifications();
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The newest id we hold, so a refresh asks only for what it has not seen. */
  const newestId = useRef(0);

  const merge = useCallback((incoming: ThreadMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      // Keyed by id rather than appended, because the same message can arrive twice — once
      // from the reply to sending it, once from the catch-up that a live event triggers.
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const message of incoming) byId.set(message.id, message);
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });
    newestId.current = Math.max(newestId.current, ...incoming.map((m) => m.id));
  }, []);

  const load = useCallback(async (sinceLast: boolean) => {
    try {
      const query = sinceLast && newestId.current > 0 ? `?after=${newestId.current}` : "";
      const res = await apiGet<{ messages: ThreadMessage[] }>(`/sessions/${sessionId}/messages${query}`);
      merge(res.messages ?? []);
      setError(null);
    } catch {
      // An empty thread and a thread we could not read look identical on screen otherwise, and
      // "nobody said anything" is the wrong thing to show somebody looking for what was said.
      setError("Messages could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [sessionId, merge]);

  useEffect(() => { void load(false); }, [load]);

  /**
   * A message sent by somebody else arrives on the channel the app already holds open, so a
   * page that is open updates without polling. The event carries only a preview, so the thread
   * asks for what it has not seen rather than trusting it.
   */
  useEffect(() => {
    if (lastEvent?.kind !== "session_message") return;
    if (String(lastEvent.sessionId) !== String(sessionId)) return;
    void load(true);
  }, [lastEvent, sessionId, load]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const sent = await apiPost<ThreadMessage>(`/sessions/${sessionId}/messages`, { body });
      merge([sent]);
      setDraft("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {audienceHint ? (
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>{audienceHint}</Text>
      ) : null}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      ) : messages.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          No messages about this class yet.
        </Text>
      ) : (
        <View style={styles.thread} testID="session-thread">
          {messages.map((message) => (
            <View
              key={message.id}
              style={[
                styles.bubble,
                {
                  backgroundColor: message.mine ? colors.primary + "12" : colors.muted,
                  borderColor: message.mine ? colors.primary + "30" : colors.border,
                },
              ]}
            >
              <View style={styles.bubbleHead}>
                <Text style={[styles.sender, { color: colors.foreground }]}>
                  {message.mine ? "You" : message.senderName}
                </Text>
                {message.senderRole === "teacher" && (
                  <View style={[styles.badge, { backgroundColor: colors.primary + "18" }]}>
                    <Text style={[styles.badgeText, { color: colors.primary }]}>Teacher</Text>
                  </View>
                )}
                <Text style={[styles.time, { color: colors.mutedForeground }]}>
                  {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </Text>
              </View>
              <Text style={[styles.body, { color: colors.foreground }]}>{message.body}</Text>
            </View>
          ))}
        </View>
      )}

      {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

      <View style={styles.composer}>
        <TextInput
          testID="session-thread-input"
          style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          placeholder="Message everyone in this class"
          placeholderTextColor={colors.mutedForeground}
          value={draft}
          onChangeText={setDraft}
          multiline
          maxLength={2000}
          textAlignVertical="top"
        />
        <TouchableOpacity
          testID="session-thread-send"
          onPress={() => void send()}
          disabled={!draft.trim() || sending}
          activeOpacity={0.85}
          style={[
            styles.sendBtn,
            { backgroundColor: draft.trim() && !sending ? colors.primary : colors.muted },
          ]}
        >
          <Feather name="send" size={16} color={draft.trim() && !sending ? "#fff" : colors.mutedForeground} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 10, lineHeight: 18 },
  loading: { marginVertical: 16 },
  empty: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12 },
  thread: { gap: 8, marginBottom: 12 },
  bubble: { borderRadius: 12, borderWidth: 1, padding: 10 },
  bubbleHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  sender: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  badge: { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  time: { fontSize: 11, fontFamily: "Inter_400Regular", marginLeft: "auto" },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  error: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 10, minHeight: 44, maxHeight: 120, fontSize: 14, fontFamily: "Inter_400Regular" },
  sendBtn: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
