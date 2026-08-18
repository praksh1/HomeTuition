import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { apiGet, apiPost } from "@/utils/api";
import { clearDraft, getDraft, saveDraft } from "@/utils/drafts";

interface Message {
  id: number;
  senderId: number;
  receiverId: number;
  body: string;
  read: boolean;
  createdAt: string;
}

export default function ConversationScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  // A half-written message survives navigating away; without this it was simply lost.
  useEffect(() => {
    let cancelled = false;
    getDraft(String(id)).then((saved) => {
      if (!cancelled && saved) setDraft(saved);
    });
    return () => { cancelled = true; };
  }, [id]);
  const listRef = useRef<FlatList<Message>>(null);

  const load = useCallback(async () => {
    try {
      const thread = await apiGet<Message[]>(`/messages/${id}`);
      setMessages(thread);
    } catch (_e) {}
  }, [id]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    try {
      const sent = await apiPost<Message>(`/messages/${id}`, { body });
      await clearDraft(String(id)); // it is a sent message now, not a draft
      setMessages((prev) => [...prev, sent]);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (_e) {
      setDraft(body);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} testID="conversation-back-btn">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
          {name ?? "Conversation"}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          const mine = item.senderId === user?.userId;
          return (
            <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
              <View
                style={[
                  styles.bubble,
                  mine
                    ? { backgroundColor: colors.primary }
                    : { backgroundColor: colors.muted, borderColor: colors.border, borderWidth: 1 },
                ]}
              >
                <Text style={[styles.bubbleText, { color: mine ? "#fff" : colors.foreground }]}>{item.body}</Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="message-circle" size={28} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Say hello to start the conversation.
            </Text>
          </View>
        }
      />

      <View style={[styles.inputRow, { borderTopColor: colors.border, paddingBottom: insets.bottom + 10, backgroundColor: colors.card }]}>
        <TextInput
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            // Persist as they type so the Drafts folder reflects reality even if the app
            // is closed mid-sentence.
            void saveDraft(String(id), t);
          }}
          placeholder="Type a message..."
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.foreground, backgroundColor: colors.muted }]}
          multiline
          testID="conversation-input"
        />
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: draft.trim() ? colors.primary : colors.muted }]}
          onPress={send}
          disabled={!draft.trim() || sending}
          activeOpacity={0.8}
          testID="conversation-send-btn"
        >
          <Feather name="send" size={18} color={draft.trim() ? "#fff" : colors.mutedForeground} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontFamily: "Inter_600SemiBold", marginHorizontal: 8 },
  listContent: { padding: 16, gap: 8, flexGrow: 1 },
  bubbleRow: { flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleRowTheirs: { justifyContent: "flex-start" },
  bubble: { maxWidth: "78%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  empty: { alignItems: "center", justifyContent: "center", gap: 10, paddingTop: 80 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1 },
  input: { flex: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
});
