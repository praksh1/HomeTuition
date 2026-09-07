import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { HIT_SLOP_MIN, radius as layoutRadius, readingWidth, space as layoutSpace } from "@/constants/layout";
import { apiGet, apiPost, apiPatch, ApiError } from "@/utils/api";

import MessageAttachment from "@/components/MessageAttachment";
import { uploadFile, type UploadableFile } from "@/utils/uploadFile";
import { applyReaction, REACTIONS, type Attachment, type Reaction } from "@/utils/reactions";
import { mergeMonthlyChatCatchUp, monthlyChatCatchUpPath } from "@/utils/monthlyJourneyState";

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
  const { t, gutter, space } = useLayout();
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
    if (!Number.isInteger(classId)) {
      setProblem("This class link is not valid.");
      setLoading(false);
      return;
    }
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
        try {
          const update = await apiGet<ChatView>(monthlyChatCatchUpPath(classId, newest));
          setView((prev) => (prev ? mergeMonthlyChatCatchUp(prev, update) : prev));
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

  if (!view) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + space.sm, paddingHorizontal: gutter, borderBottomColor: colors.border }]}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[t.title3, { color: colors.foreground }]}>Class chat</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={[styles.loadError, { paddingHorizontal: gutter }]}>
          <Feather name="alert-circle" size={24} color={colors.destructive} />
          <Text style={[t.title3, { color: colors.foreground }]}>Conversation unavailable</Text>
          <Text style={[t.callout, styles.loadErrorText, { color: colors.mutedForeground }]}>{problem ?? "Could not load the conversation."}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Try loading the conversation again" onPress={() => { setLoading(true); void load(); }} style={[styles.retryBtn, { borderColor: colors.primary }]}>
            <Text style={[t.bodyStrong, { color: colors.primary }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + space.sm, paddingHorizontal: gutter, borderBottomColor: colors.border }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[t.title3, { color: colors.foreground }]}>Class chat</Text>
        <View style={styles.backBtn} />
      </View>

      {(view?.pinned.length ?? 0) > 0 && (
        <View style={[styles.pinnedBar, { backgroundColor: colors.warnSoft, borderBottomColor: colors.border, paddingHorizontal: gutter }]}>
          {view!.pinned.map((message) => (
            <View key={message.id} style={styles.pinnedRow}>
              <Feather name="bookmark" size={15} color={colors.warn} />
              <Text style={[t.callout, styles.pinnedText, { color: colors.foreground }]} numberOfLines={3}>
                {message.body}
              </Text>
              {view!.canPin && (
                <TouchableOpacity
                  testID={`unpin-${message.id}`}
                  onPress={() => void togglePin(message)}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Remove pinned message"
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
        data={view.messages}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={[styles.list, { paddingHorizontal: gutter, paddingBottom: space.md }]}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListHeaderComponent={
          view.earlier > 0 ? (
            <Text style={[t.caption, styles.earlier, { color: colors.mutedForeground }]}>
              {view.earlier} earlier {view.earlier === 1 ? "message" : "messages"}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <Text style={[t.callout, styles.earlier, { color: colors.mutedForeground }]}>
            Nothing has been said yet.
          </Text>
        }
        renderItem={({ item }) => (
          <Bubble
            message={item}
            canPin={view.canPin === true}
            onPin={() => { setPicking(null); void togglePin(item); }}
            open={picking === item.id}
            onLongPress={() => setPicking(picking === item.id ? null : item.id)}
            onReact={(emoji) => void react(item.id, emoji)}
            onProblem={setProblem}
          />
        )}
      />

      {problem && (
        <Text style={[t.caption, styles.problem, { color: colors.destructive, borderTopColor: colors.border }]}>{problem}</Text>
      )}

      {view.readOnly ? (
        <View style={[styles.readOnly, { borderTopColor: colors.border, paddingBottom: insets.bottom + layoutSpace.sm }]}>
          <Feather name="lock" size={15} color={colors.mutedForeground} />
          <Text style={[t.caption, styles.readOnlyText, { color: colors.mutedForeground }]}>
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
              <Text style={[t.caption, styles.fileName, { color: colors.foreground }]} numberOfLines={1}>{pending.name}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove attachment ${pending.name}`} style={styles.iconBtn} onPress={() => setPending(null)} activeOpacity={0.7} testID="class-remove-attachment">
                <Feather name="x" size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          )}

          <View style={[styles.composer, { borderTopColor: colors.border, paddingBottom: insets.bottom + layoutSpace.sm }]}>
            <TouchableOpacity
              testID="monthly-chat-attach"
              onPress={() => void pickFile()}
              disabled={sending}
              style={[styles.sendBtn, { backgroundColor: colors.input }]}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Attach an image or PDF"
              accessibilityState={{ disabled: sending }}
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
              accessibilityLabel="Message the class"
              style={[t.body, styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
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
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: sending || (draft.trim().length === 0 && !pending) }}
            >
              {sending ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Feather
                  name="send"
                  size={18}
                  color={draft.trim().length === 0 && !pending ? colors.mutedForeground : colors.primaryForeground}
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
  message, canPin, onPin, open, onLongPress, onReact, onProblem,
}: {
  message: ChatMessage;
  canPin: boolean;
  onPin: () => void;
  /** Whether this bubble's long-press menu is the open one. */
  open: boolean;
  onLongPress: () => void;
  onReact: (emoji: string) => void;
  /** A file that would not open — said in the screen's own words, above the composer. */
  onProblem: (reason: string) => void;
}) {
  const colors = useColors();
  const { t } = useLayout();
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
          accessibilityRole="button"
          accessibilityLabel={`Message from ${mine ? "you" : message.senderName}. Long press for reactions${canPin ? " or pinning" : ""}.`}
          style={[
            styles.bubble,
            mine
              ? { backgroundColor: colors.primary }
              : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
          ]}
        >
          {!mine && (
            <Text style={[t.caption, styles.sender, { color: message.senderRole === "teacher" ? colors.primary : colors.mutedForeground }]}>
              {message.senderName}
              {message.senderRole === "teacher" ? " · teacher" : ""}
            </Text>
          )}
          {!!message.body && (
            <Text style={[t.body, { color: mine ? colors.primaryForeground : colors.foreground }]}>{message.body}</Text>
          )}

          {files.map((f) => (
            <View key={f.fileKey} style={{ marginTop: message.body ? layoutSpace.xs : 0 }}>
              <MessageAttachment file={f} mine={mine} onProblem={onProblem} />
            </View>
          ))}

          {message.pinnedAt && (
            <View style={styles.pinTag}>
              <Feather name="bookmark" size={11} color={mine ? colors.onInverseMuted : colors.warn} />
              <Text style={[t.overline, { color: mine ? colors.onInverseMuted : colors.warn }]}>Pinned</Text>
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
              accessibilityRole="button"
              accessibilityLabel={`${r.mine ? "Remove your" : "Add"} ${r.emoji} reaction. ${r.count} total.`}
              style={[
                styles.reactionChip,
                {
                  backgroundColor: r.mine ? colors.actionSoft : colors.muted,
                  borderColor: r.mine ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={t.caption}>{r.emoji}</Text>
              {r.count > 1 && (
                <Text style={[t.overline, { color: colors.mutedForeground }]}>{r.count}</Text>
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
                accessibilityRole="button"
                accessibilityLabel={`React ${emoji}`}
              >
                <Text style={t.title2}>{emoji}</Text>
              </TouchableOpacity>
            ))}
            {canPin && (
              <TouchableOpacity
                onPress={onPin}
                activeOpacity={0.7}
                testID={`class-pin-${message.id}`}
                style={[styles.pickerItem, { flexDirection: "row", alignItems: "center", gap: layoutSpace.xxs }]}
                accessibilityRole="button"
                accessibilityLabel={message.pinnedAt ? "Unpin message" : "Pin message"}
              >
                <Feather name="bookmark" size={14} color={colors.warn} />
                <Text style={[t.overline, { color: colors.warn }]}>
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
  messageBlock: { gap: layoutSpace.xxs },
  fileName: { flex: 1 },
  reactionRow: { flexDirection: "row", gap: layoutSpace.xxs, flexWrap: "wrap" },
  reactionChip: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: layoutSpace.xxs, borderRadius: layoutRadius.sm, borderWidth: 1, minWidth: HIT_SLOP_MIN, minHeight: HIT_SLOP_MIN, paddingHorizontal: layoutSpace.xs },
  picker: { flexDirection: "row", alignItems: "center", gap: layoutSpace.xxs, borderRadius: layoutRadius.lg, borderWidth: 1, paddingHorizontal: layoutSpace.xs, paddingVertical: layoutSpace.xxs },
  pickerItem: { minWidth: HIT_SLOP_MIN, minHeight: HIT_SLOP_MIN, paddingHorizontal: layoutSpace.xxs, alignItems: "center", justifyContent: "center" },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: layoutSpace.xs, paddingHorizontal: layoutSpace.md, paddingVertical: layoutSpace.xs, borderTopWidth: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: layoutSpace.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center" },
  iconBtn: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center" },
  pinnedBar: { paddingVertical: layoutSpace.xs, borderBottomWidth: StyleSheet.hairlineWidth, gap: layoutSpace.xs },
  pinnedRow: { flexDirection: "row", alignItems: "flex-start", gap: layoutSpace.xs },
  pinnedText: { flex: 1 },
  list: { gap: layoutSpace.xs, width: "100%", maxWidth: readingWidth, alignSelf: "center" },
  earlier: { textAlign: "center", paddingVertical: layoutSpace.sm },
  bubbleRow: { flexDirection: "row" },
  bubbleLeft: { justifyContent: "flex-start" },
  bubbleRight: { justifyContent: "flex-end" },
  bubble: { maxWidth: "82%", minHeight: HIT_SLOP_MIN, borderRadius: layoutRadius.md, paddingHorizontal: layoutSpace.sm, paddingVertical: layoutSpace.xs, justifyContent: "center" },
  sender: { marginBottom: layoutSpace.xxs },
  pinTag: { flexDirection: "row", alignItems: "center", gap: layoutSpace.xxs, marginTop: layoutSpace.xxs },
  problem: { padding: layoutSpace.sm, borderTopWidth: StyleSheet.hairlineWidth },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: layoutSpace.xs,
    paddingHorizontal: layoutSpace.sm,
    paddingTop: layoutSpace.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: HIT_SLOP_MIN,
    maxHeight: layoutSpace.huge + layoutSpace.huge + layoutSpace.xl,
    borderRadius: layoutRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: layoutSpace.md,
    paddingVertical: layoutSpace.sm,
  },
  sendBtn: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, borderRadius: layoutRadius.pill, alignItems: "center", justifyContent: "center" },
  readOnly: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: layoutSpace.xs,
    paddingTop: layoutSpace.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  readOnlyText: { flexShrink: 1 },
  loadError: { flex: 1, alignItems: "center", justifyContent: "center", gap: layoutSpace.sm, width: "100%", maxWidth: readingWidth, alignSelf: "center" },
  loadErrorText: { textAlign: "center" },
  retryBtn: { minHeight: HIT_SLOP_MIN, borderWidth: 1, borderRadius: layoutRadius.sm, paddingHorizontal: layoutSpace.md, alignItems: "center", justifyContent: "center" },
});
