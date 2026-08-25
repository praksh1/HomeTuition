import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost, apiPatch, ApiError } from "@/utils/api";

interface ChatMessage {
  id: number;
  senderId: number;
  senderName: string;
  senderRole: string;
  body: string;
  pinnedAt: string | null;
  createdAt: string;
  mine: boolean;
}

interface ChatView {
  messages: ChatMessage[];
  pinned: ChatMessage[];
  earlier: number;
  readOnly: boolean;
  canPin: boolean;
  known: boolean;
}

/**
 * The one conversation a monthly class has.
 *
 * Not thirty conversations, one per class-day — see the note on the table. What that means here
 * is that this screen is reached from the class rather than from a lesson, and that a pinned
 * message has to be shown above the thread rather than in it: a month of talk is longer than
 * one screen, and the exam date would be gone by Thursday.
 */
export default function MonthlyChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const classId = Number(id);

  const [view, setView] = useState<ChatView | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const load = useCallback(async () => {
    if (!Number.isInteger(classId)) return;
    try {
      setView(await apiGet<ChatView>(`/monthly/classes/${classId}/messages`));
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not load the conversation.");
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Catch up every few seconds, asking only for what is new.
   *
   * `after` is the id of the newest message already on screen, so a phone on a poor connection
   * is not re-downloading a month of conversation to find out that nothing has happened.
   */
  useEffect(() => {
    if (!Number.isInteger(classId)) return;
    const timer = setInterval(() => {
      void (async () => {
        const newest = view?.messages[view.messages.length - 1]?.id;
        if (newest === undefined) return;
        try {
          const update = await apiGet<ChatView>(`/monthly/classes/${classId}/messages?after=${newest}`);
          if (update.messages.length > 0) {
            setView((prev) =>
              prev ? { ...prev, messages: [...prev.messages, ...update.messages], pinned: update.pinned } : prev,
            );
          } else if (update.pinned.length !== (view?.pinned.length ?? 0)) {
            setView((prev) => (prev ? { ...prev, pinned: update.pinned } : prev));
          }
        } catch {
          // A failed catch-up is not worth an error on screen; the next one will do.
        }
      })();
    }, 5000);
    return () => clearInterval(timer);
  }, [classId, view]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setProblem(null);
    try {
      const message = await apiPost<ChatMessage>(`/monthly/classes/${classId}/messages`, { body });
      setDraft("");
      setView((prev) => (prev ? { ...prev, messages: [...prev.messages, message] } : prev));
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Could not send that.");
    } finally {
      setSending(false);
    }
  };

  const togglePin = async (message: ChatMessage) => {
    try {
      await apiPatch(`/monthly/messages/${message.id}/pin`, { pinned: message.pinnedAt === null });
      await load();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Could not pin that.");
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Class chat</Text>
        <View style={styles.backBtn} />
      </View>

      {(view?.pinned.length ?? 0) > 0 && (
        <View style={[styles.pinnedBar, { backgroundColor: colors.accent + "10", borderBottomColor: colors.border }]}>
          {view!.pinned.map((message) => (
            <View key={message.id} style={styles.pinnedRow}>
              <Feather name="bookmark" size={15} color={colors.accent} />
              <Text style={[styles.pinnedText, { color: colors.foreground }]} numberOfLines={3}>
                {message.body}
              </Text>
              {view!.canPin && (
                <TouchableOpacity
                  testID={`unpin-${message.id}`}
                  onPress={() => void togglePin(message)}
                  hitSlop={10}
                >
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      <FlatList
        ref={listRef}
        data={view?.messages ?? []}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={[styles.list, { paddingBottom: 16 }]}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListHeaderComponent={
          (view?.earlier ?? 0) > 0 ? (
            <Text style={[styles.earlier, { color: colors.mutedForeground }]}>
              {view!.earlier} earlier {view!.earlier === 1 ? "message" : "messages"}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <Text style={[styles.earlier, { color: colors.mutedForeground }]}>
            Nothing has been said yet.
          </Text>
        }
        renderItem={({ item }) => (
          <Bubble message={item} canPin={view?.canPin === true} onPin={() => void togglePin(item)} />
        )}
      />

      {problem && (
        <Text style={[styles.problem, { color: colors.destructive, borderTopColor: colors.border }]}>{problem}</Text>
      )}

      {view?.readOnly ? (
        <View style={[styles.readOnly, { borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
          <Feather name="lock" size={15} color={colors.mutedForeground} />
          <Text style={[styles.readOnlyText, { color: colors.mutedForeground }]}>
            Your month has ended. You can read this, but not post.
          </Text>
        </View>
      ) : (
        <KeyboardAwareScrollViewCompat>
          <View style={[styles.composer, { borderTopColor: colors.border, paddingBottom: insets.bottom + 10 }]}>
            <TextInput
              testID="monthly-chat-input"
              value={draft}
              onChangeText={setDraft}
              placeholder="Message the class"
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            />
            <TouchableOpacity
              testID="monthly-chat-send"
              onPress={() => void send()}
              disabled={sending || draft.trim().length === 0}
              style={[
                styles.sendBtn,
                { backgroundColor: draft.trim().length === 0 ? colors.input : colors.primary },
              ]}
              activeOpacity={0.85}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Feather name="send" size={18} color={draft.trim().length === 0 ? colors.mutedForeground : "#FFFFFF"} />
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAwareScrollViewCompat>
      )}
    </View>
  );
}

/**
 * `mine` comes from the server and is not second-guessed here.
 *
 * Comparing the sender against the signed-in account id looked obvious and was wrong twice
 * over: the account id is not the same type as the sender id, and a second opinion about whose
 * message this is can disagree with the first.
 */
function Bubble({ message, canPin, onPin }: { message: ChatMessage; canPin: boolean; onPin: () => void }) {
  const colors = useColors();
  const mine = message.mine;
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRight : styles.bubbleLeft]}>
      <TouchableOpacity
        testID={`pin-${message.id}`}
        activeOpacity={canPin ? 0.7 : 1}
        onLongPress={canPin ? onPin : undefined}
        style={[
          styles.bubble,
          mine
            ? { backgroundColor: colors.primary }
            : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
        ]}
      >
        {!mine && (
          <Text style={[styles.sender, { color: message.senderRole === "teacher" ? colors.primary : colors.mutedForeground }]}>
            {message.senderName}
            {message.senderRole === "teacher" ? " · teacher" : ""}
          </Text>
        )}
        <Text style={[styles.body, { color: mine ? "#FFFFFF" : colors.foreground }]}>{message.body}</Text>
        {message.pinnedAt && (
          <View style={styles.pinTag}>
            <Feather name="bookmark" size={11} color={mine ? "#FFFFFFCC" : colors.accent} />
            <Text style={[styles.pinTagText, { color: mine ? "#FFFFFFCC" : colors.accent }]}>Pinned</Text>
          </View>
        )}
      </TouchableOpacity>
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
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  pinnedBar: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  pinnedRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  pinnedText: { flex: 1, fontSize: 13.5, fontFamily: "Inter_500Medium", lineHeight: 19 },
  list: { padding: 14, gap: 8 },
  earlier: { fontSize: 12.5, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 12 },
  bubbleRow: { flexDirection: "row" },
  bubbleLeft: { justifyContent: "flex-start" },
  bubbleRight: { justifyContent: "flex-end" },
  bubble: { maxWidth: "82%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  sender: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 3 },
  body: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21 },
  pinTag: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5 },
  pinTagText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  problem: { fontSize: 13, fontFamily: "Inter_400Regular", padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  readOnly: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  readOnlyText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
