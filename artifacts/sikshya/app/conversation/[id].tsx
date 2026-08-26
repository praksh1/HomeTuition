import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { openAttachment } from "@/utils/openAttachment";
import { uploadFile, type UploadableFile } from "@/utils/uploadFile";

interface Attachment {
  fileKey: string;
  fileType: string;
  fileName: string | null;
}

interface Reaction {
  emoji: string;
  count: number;
  /** Whether this reader is one of the people counted, so the chip can show as pressed. */
  mine: boolean;
}

interface Message {
  id: number;
  senderId: number;
  receiverId: number;
  body: string;
  read: boolean;
  createdAt: string;
  attachments?: Attachment[];
  reactions?: Reaction[];
  /** Sent back when a file was refused. The message went; the file did not. */
  attachmentProblem?: string | null;
}

/**
 * Six, and no more.
 *
 * A long grid of every emoji is a search problem on a phone. These are the ones a lesson
 * actually needs: understood, thank you, well done, and the three that carry a feeling.
 */
const REACTIONS = ["\u{1F44D}", "\u2764\uFE0F", "\u{1F602}", "\u{1F389}", "\u{1F62E}", "\u{1F64F}"];

export default function ConversationScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  /** Chosen but not sent yet. It goes up when they press send, not when they pick it. */
  const [pending, setPending] = useState<UploadableFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** Which bubble's reaction picker is open, if any. */
  const [picking, setPicking] = useState<number | null>(null);

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

  /**
   * Choose a file. Nothing is uploaded yet.
   *
   * Uploading on pick would put bytes in the bucket for a message that is never sent — and on
   * a Nepali connection it would also mean a wait with no send button pressed and nothing
   * obviously happening. It goes up when they mean it.
   */
  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/*", "application/pdf"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setProblem(null);
    setPending({
      uri: asset.uri,
      name: asset.name ?? "file",
      mimeType: asset.mimeType ?? "application/octet-stream",
      size: asset.size ?? 1,
    });
  };

  const send = async () => {
    const body = draft.trim();
    // A photo with no caption is a message. Requiring words to send one would mean typing
    // something in order to send a picture, which nobody does.
    if ((!body && !pending) || sending) return;

    setSending(true);
    setProblem(null);
    const outgoing = pending;
    setDraft("");
    setPending(null);

    try {
      let fileKey: string | undefined;
      if (outgoing) fileKey = await uploadFile(outgoing);

      const sent = await apiPost<Message>(`/messages/${id}`, {
        body,
        ...(fileKey ? { fileKey, fileType: outgoing!.mimeType, fileName: outgoing!.name } : {}),
      });
      await clearDraft(String(id)); // it is a sent message now, not a draft
      setMessages((prev) => [...prev, sent]);
      /*
       * The message went and the file did not — the server says so rather than failing the
       * whole send, because losing the words as well is the worse outcome.
       */
      if (sent.attachmentProblem) setProblem(sent.attachmentProblem);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (err) {
      /*
       * Put it all back exactly as it was. Half-clearing after a failed send is how somebody
       * loses a message they thought they had sent — and the upload is the step most likely
       * to fail here, so the file has to come back too.
       */
      setDraft(body);
      setPending(outgoing);
      setProblem(err instanceof Error && err.message ? err.message : "That did not send. Try again.");
    } finally {
      setSending(false);
    }
  };

  /**
   * React, or take it back.
   *
   * Shown immediately and reconciled from the server afterwards: a tap that waits for a round
   * trip on a poor connection feels broken, and the server is the authority on the count
   * either way.
   */
  const react = async (messageId: number, emoji: string) => {
    setPicking(null);
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const current = m.reactions ?? [];
        const already = current.find((r) => r.emoji === emoji && r.mine);
        // Whatever this person had before goes, whether they are replacing it or removing it.
        const withoutMine = current
          .map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false } : r))
          .filter((r) => r.count > 0);
        if (already) return { ...m, reactions: withoutMine };
        const existing = withoutMine.find((r) => r.emoji === emoji);
        return {
          ...m,
          reactions: existing
            ? withoutMine.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r))
            : [...withoutMine, { emoji, count: 1, mine: true }],
        };
      }),
    );
    try {
      await apiPost(`/messages/${messageId}/reaction`, { emoji });
    } catch (_e) {
      // The guess was wrong, so go and get the truth rather than leaving it showing.
      void load();
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
          const files = item.attachments ?? [];
          const reactions = item.reactions ?? [];
          return (
            <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
              <View style={{ maxWidth: "78%", alignItems: mine ? "flex-end" : "flex-start" }}>
                {/*
                  Long-press to react, which is the gesture these apps have taught everybody.
                  A permanently visible row of six emoji under every bubble would be louder
                  than the conversation.
                */}
                <TouchableOpacity
                  activeOpacity={0.85}
                  onLongPress={() => setPicking(picking === item.id ? null : item.id)}
                  delayLongPress={250}
                  testID={`message-bubble-${item.id}`}
                  style={[
                    styles.bubble,
                    mine
                      ? { backgroundColor: colors.primary }
                      : { backgroundColor: colors.muted, borderColor: colors.border, borderWidth: 1 },
                  ]}
                >
                  {!!item.body && (
                    <Text style={[styles.bubbleText, { color: mine ? "#fff" : colors.foreground }]}>{item.body}</Text>
                  )}

                  {files.map((f) => (
                    <TouchableOpacity
                      key={f.fileKey}
                      onPress={async () => {
                        const result = await openAttachment(f.fileKey);
                        if (!result.ok) setProblem(result.reason ?? "We could not open that file.");
                      }}
                      activeOpacity={0.75}
                      testID={`message-file-${item.id}`}
                      style={[
                        styles.fileChip,
                        {
                          backgroundColor: mine ? "rgba(255,255,255,0.16)" : colors.card,
                          borderColor: mine ? "rgba(255,255,255,0.28)" : colors.border,
                          marginTop: item.body ? 8 : 0,
                        },
                      ]}
                    >
                      <Feather
                        name={f.fileType.startsWith("image/") ? "image" : "file-text"}
                        size={14}
                        color={mine ? "#fff" : colors.primary}
                      />
                      <Text
                        style={[styles.fileName, { color: mine ? "#fff" : colors.foreground }]}
                        numberOfLines={1}
                      >
                        {/* The key is a UUID, so without the sender's own name this reads as
                            "a file" and cannot be asked about. */}
                        {f.fileName ?? (f.fileType.startsWith("image/") ? "Photo" : "File")}
                      </Text>
                      <Feather name="external-link" size={12} color={mine ? "#fff" : colors.mutedForeground} />
                    </TouchableOpacity>
                  ))}
                </TouchableOpacity>

                {reactions.length > 0 && (
                  <View style={[styles.reactionRow, mine ? { justifyContent: "flex-end" } : null]}>
                    {reactions.map((r) => (
                      <TouchableOpacity
                        key={r.emoji}
                        onPress={() => void react(item.id, r.emoji)}
                        activeOpacity={0.75}
                        testID={`reaction-${item.id}-${r.emoji}`}
                        style={[
                          styles.reactionChip,
                          {
                            backgroundColor: r.mine ? colors.primary + "1F" : colors.muted,
                            borderColor: r.mine ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                        {r.count > 1 && (
                          <Text style={[styles.reactionCount, { color: colors.mutedForeground }]}>{r.count}</Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {picking === item.id && (
                  <View
                    style={[styles.picker, { backgroundColor: colors.card, borderColor: colors.border }]}
                    testID={`reaction-picker-${item.id}`}
                  >
                    {REACTIONS.map((emoji) => (
                      <TouchableOpacity
                        key={emoji}
                        onPress={() => void react(item.id, emoji)}
                        activeOpacity={0.7}
                        testID={`pick-reaction-${item.id}-${emoji}`}
                        style={styles.pickerItem}
                      >
                        <Text style={styles.pickerEmoji}>{emoji}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
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

      {/*
        The one line that says something went wrong — a file refused, a send that failed, a
        file that would not open. Above the compose row, where the person is already looking.
      */}
      {!!problem && (
        <View style={[styles.problem, { backgroundColor: colors.destructive + "14", borderTopColor: colors.border }]}>
          <Feather name="alert-circle" size={13} color={colors.destructive} />
          <Text style={[styles.problemText, { color: colors.destructive }]}>{problem}</Text>
          <TouchableOpacity onPress={() => setProblem(null)} activeOpacity={0.7} testID="dismiss-problem">
            <Feather name="x" size={13} color={colors.destructive} />
          </TouchableOpacity>
        </View>
      )}

      {/* A file chosen and not yet sent, with a way to change your mind about it. */}
      {!!pending && (
        <View style={[styles.pendingRow, { backgroundColor: colors.muted, borderTopColor: colors.border }]}>
          <Feather
            name={pending.mimeType.startsWith("image/") ? "image" : "file-text"}
            size={14}
            color={colors.primary}
          />
          <Text style={[styles.pendingName, { color: colors.foreground }]} numberOfLines={1}>
            {pending.name}
          </Text>
          <TouchableOpacity onPress={() => setPending(null)} activeOpacity={0.7} testID="remove-attachment">
            <Feather name="x" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.inputRow, { borderTopColor: colors.border, paddingBottom: insets.bottom + 10, backgroundColor: colors.card }]}>
        <TouchableOpacity
          style={[styles.attachBtn, { backgroundColor: colors.muted }]}
          onPress={() => void pickFile()}
          disabled={sending}
          activeOpacity={0.8}
          testID="conversation-attach-btn"
        >
          <Feather name="paperclip" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
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
        {/* Sendable when there are words *or* a file — see `send`. */}
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: draft.trim() || pending ? colors.primary : colors.muted }]}
          onPress={send}
          disabled={(!draft.trim() && !pending) || sending}
          activeOpacity={0.8}
          testID="conversation-send-btn"
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Feather name="send" size={18} color={draft.trim() || pending ? "#fff" : colors.mutedForeground} />
          )}
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
  attachBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
  fileChip: { flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  fileName: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  reactionRow: { flexDirection: "row", gap: 4, marginTop: 4, flexWrap: "wrap" },
  reactionChip: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 12, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  picker: { flexDirection: "row", gap: 2, marginTop: 6, borderRadius: 20, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 4 },
  pickerItem: { paddingHorizontal: 5, paddingVertical: 3 },
  pickerEmoji: { fontSize: 19 },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 9, borderTopWidth: 1 },
  pendingName: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  problem: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 9, borderTopWidth: 1 },
  problemText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
});
