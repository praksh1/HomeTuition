import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
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

import { openAttachment } from "@/utils/openAttachment";
import { uploadFile, type UploadableFile } from "@/utils/uploadFile";
import { applyReaction, attachmentLabel, REACTIONS, type Attachment, type Reaction } from "@/utils/reactions";

interface ChatMessage {
  id: number;
  senderId: number;
  senderName: string;
  senderRole: string;
  body: string;
  pinnedAt: string | null;
  createdAt: string;
  mine: boolean;
  attachments?: Attachment[];
  reactions?: Reaction[];
  /** Sent back when a file was refused: the message went, the file did not. */
  attachmentProblem?: string | null;
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
  /** Chosen but not sent yet. */
  const [pending, setPending] = useState<UploadableFile | null>(null);
  /** Which bubble's long-press menu is open, if any. */
  const [picking, setPicking] = useState<number | null>(null);
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

  /**
   * Choose a file. Nothing is uploaded yet — it goes up when they press send.
   *
   * Uploading on pick puts bytes in the bucket for a message that is never sent, and on a
   * Nepali connection it means a long wait with no send pressed and nothing obviously
   * happening.
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
    // A photo of the day's working, with no caption, is the commonest thing anybody sends.
    if ((!body && !pending) || sending) return;
    setSending(true);
    setProblem(null);
    const outgoing = pending;
    setDraft("");
    setPending(null);
    try {
      let fileKey: string | undefined;
      if (outgoing) fileKey = await uploadFile(outgoing);
      const message = await apiPost<ChatMessage>(`/monthly/classes/${classId}/messages`, {
        body,
        ...(fileKey ? { fileKey, fileType: outgoing!.mimeType, fileName: outgoing!.name } : {}),
      });
      setView((prev) => (prev ? { ...prev, messages: [...prev.messages, message] } : prev));
      if (message.attachmentProblem) setProblem(message.attachmentProblem);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      // Everything back exactly as it was — half-clearing after a failed send is how somebody
      // loses a message they believed they had sent, and the upload is the step most likely
      // to fail here.
      setDraft(body);
      setPending(outgoing);
      setProblem(e instanceof ApiError ? e.message : "Could not send that.");
    } finally {
      setSending(false);
    }
  };

  /**
   * React, or take it back. Shown immediately and reconciled from the server afterwards: a tap
   * that waits for a round trip on a poor connection feels broken, and the server is the
   * authority on the count either way.
   */
  const react = async (messageId: number, emoji: string) => {
    setPicking(null);
    setView((prev) => prev && {
      ...prev,
      messages: prev.messages.map((m) =>
        m.id === messageId ? { ...m, reactions: applyReaction(m.reactions ?? [], emoji) } : m),
      pinned: prev.pinned.map((m) =>
        m.id === messageId ? { ...m, reactions: applyReaction(m.reactions ?? [], emoji) } : m),
    });
    try {
      await apiPost(`/monthly/classes/${classId}/messages/${messageId}/reaction`, { emoji });
    } catch {
      void load();
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
          <Bubble
            message={item}
            canPin={view?.canPin === true}
            onPin={() => { setPicking(null); void togglePin(item); }}
            open={picking === item.id}
            onLongPress={() => setPicking(picking === item.id ? null : item.id)}
            onReact={(emoji) => void react(item.id, emoji)}
            onOpenFile={async (key) => {
              const result = await openAttachment(key);
              if (!result.ok) setProblem(result.reason ?? "We could not open that file.");
            }}
          />
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
          {/* A file chosen and not yet sent, with a way to change your mind about it. */}
          {!!pending && (
            <View style={[styles.pendingRow, { backgroundColor: colors.muted, borderTopColor: colors.border }]}>
              <Feather
                name={pending.mimeType.startsWith("image/") ? "image" : "file-text"}
                size={14}
                color={colors.primary}
              />
              <Text style={[styles.fileName, { color: colors.foreground }]} numberOfLines={1}>{pending.name}</Text>
              <TouchableOpacity onPress={() => setPending(null)} activeOpacity={0.7} testID="class-remove-attachment">
                <Feather name="x" size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          )}

          <View style={[styles.composer, { borderTopColor: colors.border, paddingBottom: insets.bottom + 10 }]}>
            <TouchableOpacity
              testID="monthly-chat-attach"
              onPress={() => void pickFile()}
              disabled={sending}
              style={[styles.sendBtn, { backgroundColor: colors.input }]}
              activeOpacity={0.85}
            >
              <Feather name="paperclip" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
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
              disabled={sending || (draft.trim().length === 0 && !pending)}
              style={[
                styles.sendBtn,
                { backgroundColor: draft.trim().length === 0 && !pending ? colors.input : colors.primary },
              ]}
              activeOpacity={0.85}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Feather
                  name="send"
                  size={18}
                  color={draft.trim().length === 0 && !pending ? colors.mutedForeground : "#FFFFFF"}
                />
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
function Bubble({
  message, canPin, onPin, open, onLongPress, onReact, onOpenFile,
}: {
  message: ChatMessage;
  canPin: boolean;
  onPin: () => void;
  /** Whether this bubble's long-press menu is the open one. */
  open: boolean;
  onLongPress: () => void;
  onReact: (emoji: string) => void;
  onOpenFile: (key: string) => void;
}) {
  const colors = useColors();
  const mine = message.mine;
  const files = message.attachments ?? [];
  const reactions = message.reactions ?? [];
  return (
    /*
     * The bubble stays a direct child of a row. Wrapping it in a column with alignItems to line
     * the reactions up under it collapses it to its minimum content width — "hi" renders as an
     * "h" above an "i", which shipped once already. The reactions get their own row instead.
     */
    <View style={styles.messageBlock}>
      <View style={[styles.bubbleRow, mine ? styles.bubbleRight : styles.bubbleLeft]}>
        <TouchableOpacity
          testID={`pin-${message.id}`}
          activeOpacity={0.85}
          onLongPress={onLongPress}
          delayLongPress={250}
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
          {!!message.body && (
            <Text style={[styles.body, { color: mine ? "#FFFFFF" : colors.foreground }]}>{message.body}</Text>
          )}

          {files.map((f) => (
            <TouchableOpacity
              key={f.fileKey}
              onPress={() => onOpenFile(f.fileKey)}
              activeOpacity={0.75}
              testID={`class-file-${message.id}`}
              style={[
                styles.fileChip,
                {
                  backgroundColor: mine ? "rgba(255,255,255,0.16)" : colors.muted,
                  borderColor: mine ? "rgba(255,255,255,0.28)" : colors.border,
                  marginTop: message.body ? 8 : 0,
                },
              ]}
            >
              <Feather
                name={f.fileType.startsWith("image/") ? "image" : "file-text"}
                size={14}
                color={mine ? "#FFFFFF" : colors.primary}
              />
              <Text style={[styles.fileName, { color: mine ? "#FFFFFF" : colors.foreground }]} numberOfLines={1}>
                {attachmentLabel(f)}
              </Text>
              <Feather name="external-link" size={12} color={mine ? "#FFFFFFCC" : colors.mutedForeground} />
            </TouchableOpacity>
          ))}

          {message.pinnedAt && (
            <View style={styles.pinTag}>
              <Feather name="bookmark" size={11} color={mine ? "#FFFFFFCC" : colors.accent} />
              <Text style={[styles.pinTagText, { color: mine ? "#FFFFFFCC" : colors.accent }]}>Pinned</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {reactions.length > 0 && (
        <View style={[styles.reactionRow, mine ? styles.bubbleRight : styles.bubbleLeft]}>
          {reactions.map((r) => (
            <TouchableOpacity
              key={r.emoji}
              onPress={() => onReact(r.emoji)}
              activeOpacity={0.75}
              testID={`class-reaction-${message.id}-${r.emoji}`}
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

      {/*
        One menu, because a bubble has one long-press. Everybody gets the reactions; the teacher
        also gets Pin, which is what the long-press used to do on its own and must keep doing.
      */}
      {open && (
        <View style={[styles.reactionRow, mine ? styles.bubbleRight : styles.bubbleLeft]}>
          <View style={[styles.picker, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {REACTIONS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                onPress={() => onReact(emoji)}
                activeOpacity={0.7}
                testID={`class-pick-${message.id}-${emoji}`}
                style={styles.pickerItem}
              >
                <Text style={styles.pickerEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
            {canPin && (
              <TouchableOpacity
                onPress={onPin}
                activeOpacity={0.7}
                testID={`class-pin-${message.id}`}
                style={[styles.pickerItem, { flexDirection: "row", alignItems: "center", gap: 4 }]}
              >
                <Feather name="bookmark" size={14} color={colors.accent} />
                <Text style={[styles.pinTagText, { color: colors.accent }]}>
                  {message.pinnedAt ? "Unpin" : "Pin"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  messageBlock: { gap: 4 },
  fileChip: { flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  fileName: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  reactionRow: { flexDirection: "row", gap: 4, flexWrap: "wrap" },
  reactionChip: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 12, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  picker: { flexDirection: "row", alignItems: "center", gap: 2, borderRadius: 20, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 4 },
  pickerItem: { paddingHorizontal: 5, paddingVertical: 3 },
  pickerEmoji: { fontSize: 19 },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 9, borderTopWidth: 1 },
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
