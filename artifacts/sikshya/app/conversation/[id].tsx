import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import MessageAttachment from "@/components/MessageAttachment";
import { HIT_SLOP_MIN, marketplaceColumnMax } from "@/constants/layout";
import { ATTACHMENT_PICKER_TYPES } from "@/utils/attachmentTypes";
import { useAuth } from "@/context/AuthContext";
import { useDates } from "@/context/DatePreferenceContext";
import { useNotifications } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPost } from "@/utils/api";
import { clearDraft, getDraft, saveDraft } from "@/utils/drafts";
import { shouldSendMessageOnKey } from "@/utils/messageComposer";
import { notificationMatchesReadTarget } from "@/utils/notificationCenter";
import {
  latestOwnMessageId,
  messageDayLabel,
  messageTimeLabel,
  shouldShowDay,
} from "@/utils/messageTimeline";
import {
  applyReaction,
  attachmentLabel,
  REACTIONS,
  type Attachment,
  type Reaction,
} from "@/utils/reactions";
import { uploadFile, type UploadableFile } from "@/utils/uploadFile";

interface Message {
  id: number;
  senderId: number;
  receiverId: number;
  body: string;
  read: boolean;
  createdAt: string;
  attachments?: Attachment[];
  reactions?: Reaction[];
  /** Sent back when a file was refused. The words still went. */
  attachmentProblem?: string | null;
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export default function ConversationScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const colors = useColors();
  const dates = useDates();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { notifications, lastEvent, markTargetRead } = useNotifications();
  const { t, numeric, gutter, space, radius, isWide } = useLayout();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadProblem, setLoadProblem] = useState(false);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<UploadableFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [access, setAccess] = useState<{ canSend: boolean; blockedByYou: boolean; reason: string | null } | null>(null);
  const [blocking, setBlocking] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);
  const scrollAfterLayout = useRef(true);
  const scrollPass = useRef(0);
  const hasLoaded = useRef(false);
  const displayName = name?.trim() || "Conversation";

  const settleAtNewest = useCallback(() => {
    const pass = ++scrollPass.current;
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    setTimeout(() => {
      if (scrollPass.current !== pass) return;
      listRef.current?.scrollToEnd({ animated: false });
      scrollAfterLayout.current = false;
    }, 120);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getDraft(String(id)).then((saved) => {
      if (!cancelled && saved) setDraft(saved);
    });
    return () => { cancelled = true; };
  }, [id]);

  const load = useCallback(async () => {
    void apiGet<NonNullable<typeof access>>(`/messages/${id}/access`).then(setAccess).catch(() => {});
    try {
      const next = await apiGet<Message[]>(`/messages/${id}`);
      if (!hasLoaded.current) scrollAfterLayout.current = true;
      setMessages(next);
      hasLoaded.current = true;
      setLoadProblem(false);
      void markTargetRead({ kind: "direct_message", conversationWith: id });
    } catch {
      setLoadProblem(true);
    } finally {
      setLoading(false);
    }
  }, [id, markTargetRead]);

  useEffect(() => {
    void load();
    // The user socket supplies the instant path. This is only a missed-event safety net; four
    // seconds kept every background conversation route needlessly busy.
    const interval = setInterval(() => void load(), 8000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (
      (lastEvent?.kind === "message" || lastEvent?.kind === "conversation_sync") &&
      Number(lastEvent.fromUserId) === Number(id)
    ) {
      scrollAfterLayout.current = true;
      void load();
    }
  }, [id, lastEvent, load]);

  useEffect(() => {
    const target = { kind: "direct_message" as const, conversationWith: id };
    if (notifications.some((notification) => !notification.read && notificationMatchesReadTarget(notification, target))) {
      void markTargetRead(target);
    }
  }, [id, markTargetRead, notifications]);

  const latestMine = useMemo(() => latestOwnMessageId(messages, user?.userId), [messages, user?.userId]);

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: [...ATTACHMENT_PICKER_TYPES],
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
    if ((!body && !pending) || sending || access?.canSend === false) return;

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
      await clearDraft(String(id));
      scrollAfterLayout.current = true;
      setMessages((previous) => [...previous, sent]);
      if (sent.attachmentProblem) setProblem(sent.attachmentProblem);
    } catch (error) {
      setDraft(body);
      setPending(outgoing);
      setProblem(error instanceof Error && error.message ? error.message : "That did not send. Try again.");
    } finally {
      setSending(false);
    }
  };

  const react = async (messageId: number, emoji: string) => {
    if (access?.canSend === false) return;
    setPicking(null);
    setMessages((previous) => previous.map((message) => (
      message.id === messageId
        ? { ...message, reactions: applyReaction(message.reactions ?? [], emoji) }
        : message
    )));
    try {
      await apiPost(`/messages/${messageId}/reaction`, { emoji });
    } catch {
      void load();
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <View style={[styles.header, { paddingTop: insets.top, borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        <View style={[styles.headerInner, { maxWidth: marketplaceColumnMax, paddingHorizontal: gutter }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.72}
            style={[styles.headerAction, { minWidth: HIT_SLOP_MIN, minHeight: HIT_SLOP_MIN, borderRadius: radius.pill, borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Back to messages"
            testID="conversation-back-btn"
          >
            <Feather name="arrow-left" size={20} color={colors.primary} />
          </TouchableOpacity>
          <View style={[styles.headerAvatar, { borderRadius: radius.pill, backgroundColor: colors.actionSoft }]}>
            <Text style={[t.caption, { color: colors.primary }]}>{initials(displayName)}</Text>
          </View>
          <View style={styles.headerCopy}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]} numberOfLines={1}>{displayName}</Text>
            <Text style={[t.caption, { color: colors.inkFaint }]}>Fadko conversation</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Safety & help" onPress={() => setSafetyOpen(value => !value)} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
            <Feather name="shield" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {safetyOpen ? <View style={{ padding: space.md, gap: space.sm, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>Safety & help</Text>
        <Text style={[t.callout, { color: colors.mutedForeground }]}>Blocking stops new private messages in both directions. Existing messages are kept as evidence. It does not remove anyone from a paid class.</Text>
        <TouchableOpacity disabled={blocking || !access} accessibilityRole="button" onPress={async () => {
          if (!access || blocking) return;
          setBlocking(true);
          try { setAccess(await apiPost(`/messages/${id}/block`, { blocked: !access.blockedByYou })); }
          catch { setProblem("Could not change blocking. Please try again."); }
          finally { setBlocking(false); }
        }} style={{ minHeight: 44, justifyContent: "center" }}>
          <Text style={[t.bodyStrong, { color: colors.destructive }]}>{blocking ? "Saving…" : access?.blockedByYou ? "Unblock this person" : "Block this person"}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" onPress={() => router.push({ pathname: "/support", params: { reason: "Inappropriate Behavior", reportedUserId: id } })} style={{ minHeight: 44, justifyContent: "center" }}>
          <Text style={[t.bodyStrong, { color: colors.primary }]}>Report this conversation</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" onPress={() => setSafetyOpen(false)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={[t.callout, { color: colors.primary }]}>Close safety options</Text></TouchableOpacity>
      </View> : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(message) => String(message.id)}
        style={styles.list}
        contentContainerStyle={{
          width: "100%",
          maxWidth: marketplaceColumnMax,
          alignSelf: "center",
          flexGrow: 1,
          paddingHorizontal: gutter,
          paddingTop: space.md,
          paddingBottom: space.xl,
          gap: space.xs,
        }}
        onContentSizeChange={() => {
          if (!scrollAfterLayout.current) return;
          settleAtNewest();
        }}
        onLayout={() => { if (scrollAfterLayout.current) settleAtNewest(); }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={loadProblem && messages.length > 0 ? (
          <TouchableOpacity
            onPress={() => void load()}
            style={[styles.connectionNote, { borderRadius: radius.sm, backgroundColor: colors.warnSoft }]}
            accessibilityRole="button"
          >
            <Feather name="refresh-cw" size={15} color={colors.warn} />
            <Text style={[t.caption, { color: colors.warn }]}>New messages may be delayed. Tap to retry.</Text>
          </TouchableOpacity>
        ) : null}
        renderItem={({ item, index }) => {
          const mine = item.senderId === user?.userId;
          const files = item.attachments ?? [];
          const reactions = item.reactions ?? [];
          const showDay = shouldShowDay(messages, index);
          const latestOwn = mine && latestMine === item.id;
          return (
            <View style={[styles.messageBlock, showDay && index > 0 && { marginTop: space.md }]}>
              {showDay ? (
                <View style={styles.dayRow}>
                  <View style={[styles.dayLine, { backgroundColor: colors.border }]} />
                  <Text style={[t.caption, numeric, { color: colors.inkFaint }]}>
                    {messageDayLabel(item.createdAt, Date.now(), (date) => dates.format(date, { style: "short" }))}
                  </Text>
                  <View style={[styles.dayLine, { backgroundColor: colors.border }]} />
                </View>
              ) : null}

              <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
                <TouchableOpacity
                  activeOpacity={0.86}
                  onLongPress={() => setPicking(picking === item.id ? null : item.id)}
                  delayLongPress={250}
                  accessibilityRole="button"
                  accessibilityLabel={`${mine ? "You" : displayName}: ${item.body || (files[0] ? attachmentLabel(files[0]) : "attachment")}. Long press to react.`}
                  testID={`message-bubble-${item.id}`}
                  style={[
                    styles.bubble,
                    { maxWidth: isWide ? "70%" : "84%", borderRadius: radius.lg },
                    mine
                      ? { backgroundColor: colors.primary }
                      : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
                  ]}
                >
                  {item.body ? <Text style={[t.body, { color: mine ? colors.primaryForeground : colors.foreground }]}>{item.body}</Text> : null}
                  {files.map((file) => (
                    <View key={file.fileKey} style={{ marginTop: item.body ? space.xs : 0 }}>
                      <MessageAttachment file={file} mine={mine} onProblem={setProblem} />
                    </View>
                  ))}
                </TouchableOpacity>
              </View>

              <View style={[styles.metaRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
                <Text style={[t.caption, numeric, { color: colors.inkFaint }]}>{messageTimeLabel(item.createdAt)}</Text>
                {latestOwn ? (
                  <Text style={[t.caption, { color: item.read ? colors.success : colors.inkFaint }]}>{item.read ? "Seen" : "Sent"}</Text>
                ) : null}
              </View>

              {reactions.length > 0 ? (
                <View style={[styles.reactionRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
                  {reactions.map((reaction) => (
                    <TouchableOpacity
                      key={reaction.emoji}
                      onPress={() => void react(item.id, reaction.emoji)}
                      activeOpacity={0.75}
                      testID={`reaction-${item.id}-${reaction.emoji}`}
                      style={[
                        styles.reactionChip,
                        {
                          minHeight: HIT_SLOP_MIN,
                          borderRadius: radius.pill,
                          backgroundColor: reaction.mine ? colors.actionSoft : colors.card,
                          borderColor: reaction.mine ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text style={t.body}>{reaction.emoji}</Text>
                      {reaction.count > 1 ? <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>{reaction.count}</Text> : null}
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              {picking === item.id ? (
                <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
                  <View style={[styles.picker, { borderRadius: radius.pill, borderColor: colors.border, backgroundColor: colors.card }]} testID={`reaction-picker-${item.id}`}>
                    {REACTIONS.map((emoji) => (
                      <TouchableOpacity
                        key={emoji}
                        onPress={() => void react(item.id, emoji)}
                        activeOpacity={0.7}
                        testID={`pick-reaction-${item.id}-${emoji}`}
                        style={styles.pickerItem}
                        accessibilityLabel={`React ${emoji}`}
                      >
                        <Text style={t.title3}>{emoji}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading ? (
              <>
                <ActivityIndicator color={colors.primary} />
                <Text style={[t.callout, { color: colors.mutedForeground }]}>Loading conversation…</Text>
              </>
            ) : loadProblem ? (
              <>
                <View style={[styles.emptyIcon, { borderRadius: radius.pill, backgroundColor: colors.warnSoft }]}>
                  <Feather name="wifi-off" size={22} color={colors.warn} />
                </View>
                <Text style={[t.title3, { color: colors.foreground }]}>Conversation unavailable</Text>
                <Text style={[t.callout, styles.center, { color: colors.mutedForeground }]}>Check your connection and try again.</Text>
                <TouchableOpacity onPress={() => { setLoading(true); void load(); }} style={[styles.retry, { minHeight: HIT_SLOP_MIN, borderRadius: radius.sm, backgroundColor: colors.primary }]}>
                  <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Try again</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={[styles.emptyIcon, { borderRadius: radius.pill, backgroundColor: colors.actionSoft }]}>
                  <Feather name="message-circle" size={24} color={colors.primary} />
                </View>
                <Text style={[t.title3, { color: colors.foreground }]}>Start the conversation</Text>
                <Text style={[t.callout, styles.center, { color: colors.mutedForeground }]}>Write a message below. Your unfinished words stay saved on this device.</Text>
              </>
            )}
          </View>
        }
      />

      {problem ? (
        <View style={[styles.noticeShell, { borderTopColor: colors.border, backgroundColor: colors.destructiveSoft }]}>
          <View style={[styles.notice, { maxWidth: marketplaceColumnMax, paddingHorizontal: gutter }]}>
            <Feather name="alert-circle" size={17} color={colors.destructive} />
            <Text style={[t.caption, styles.noticeText, { color: colors.destructive }]}>{problem}</Text>
            <TouchableOpacity onPress={() => setProblem(null)} style={styles.noticeAction} accessibilityLabel="Dismiss message problem" testID="dismiss-problem">
              <Feather name="x" size={18} color={colors.destructive} />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {pending ? (
        <View style={[styles.noticeShell, { borderTopColor: colors.border, backgroundColor: colors.muted }]}>
          <View style={[styles.notice, { maxWidth: marketplaceColumnMax, paddingHorizontal: gutter }]}>
            <Feather name={pending.mimeType.startsWith("image/") ? "image" : "file-text"} size={17} color={colors.primary} />
            <Text style={[t.caption, styles.noticeText, { color: colors.foreground }]} numberOfLines={1}>{pending.name}</Text>
            <TouchableOpacity onPress={() => setPending(null)} style={styles.noticeAction} accessibilityLabel="Remove attachment" testID="remove-attachment">
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {access?.canSend === false ? <View style={{ padding: space.md, backgroundColor: colors.surfaceSunk }}><Text accessibilityLiveRegion="polite" style={[t.callout, { color: colors.mutedForeground }]}>{access.reason}</Text></View> :
      <View style={[styles.composerShell, { paddingBottom: insets.bottom + space.xs, borderTopColor: colors.border, backgroundColor: colors.card }]}>
        <View style={[styles.composer, { maxWidth: marketplaceColumnMax, paddingHorizontal: gutter }]}>
          <TouchableOpacity
            style={[styles.composeAction, { minWidth: HIT_SLOP_MIN, minHeight: HIT_SLOP_MIN, borderRadius: radius.pill, backgroundColor: colors.muted }]}
            onPress={() => void pickFile()}
            disabled={sending}
            accessibilityRole="button"
            accessibilityLabel="Attach a photo, PDF, Word or Excel file"
            accessibilityState={{ disabled: sending }}
            aria-disabled={sending}
            activeOpacity={0.78}
            testID="conversation-attach-btn"
          >
            <Feather name="paperclip" size={19} color={colors.primary} />
          </TouchableOpacity>
          <TextInput
            value={draft}
            onChangeText={(text) => { setDraft(text); void saveDraft(String(id), text); }}
            placeholder="Write a message…"
            placeholderTextColor={colors.inkFaint}
            style={[t.body, styles.input, { minHeight: HIT_SLOP_MIN, maxHeight: 112, borderRadius: radius.lg, borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
            multiline
            onKeyPress={(event) => {
              const native = event.nativeEvent as typeof event.nativeEvent & { shiftKey?: boolean; isComposing?: boolean };
              if (!shouldSendMessageOnKey(Platform.OS, native.key, native.shiftKey, native.isComposing)) return;
              event.preventDefault();
              void send();
            }}
            accessibilityLabel="Message"
            testID="conversation-input"
          />
          <TouchableOpacity
            style={[
              styles.composeAction,
              {
                minWidth: HIT_SLOP_MIN,
                minHeight: HIT_SLOP_MIN,
                borderRadius: radius.pill,
                backgroundColor: draft.trim() || pending ? colors.primary : colors.muted,
              },
            ]}
            onPress={() => void send()}
            disabled={(!draft.trim() && !pending) || sending}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: (!draft.trim() && !pending) || sending }}
            aria-disabled={(!draft.trim() && !pending) || sending}
            activeOpacity={0.78}
            testID="conversation-send-btn"
          >
            {sending
              ? <ActivityIndicator size="small" color={colors.primaryForeground} />
              : <Feather name="send" size={18} color={draft.trim() || pending ? colors.primaryForeground : colors.inkFaint} />}
          </TouchableOpacity>
        </View>
      </View>
      }
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { borderBottomWidth: StyleSheet.hairlineWidth },
  headerInner: { width: "100%", alignSelf: "center", minHeight: 66, flexDirection: "row", alignItems: "center", gap: 10 },
  headerAction: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  headerAvatar: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, minWidth: 0 },
  list: { flex: 1 },
  connectionNote: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 12, marginBottom: 12 },
  messageBlock: { gap: 4 },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 8 },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth },
  bubbleRow: { flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleRowTheirs: { justifyContent: "flex-start" },
  bubble: { paddingHorizontal: 14, paddingVertical: 10 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 4 },
  reactionRow: { flexDirection: "row", gap: 4, flexWrap: "wrap" },
  reactionChip: { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, paddingHorizontal: 10 },
  picker: { flexDirection: "row", overflow: "hidden", borderWidth: 1, marginTop: 4, paddingHorizontal: 3 },
  pickerItem: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, minHeight: 280, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyIcon: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" },
  retry: { alignSelf: "stretch", alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  noticeShell: { borderTopWidth: StyleSheet.hairlineWidth },
  notice: { width: "100%", alignSelf: "center", minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9 },
  noticeText: { flex: 1 },
  noticeAction: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  composerShell: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  composer: { width: "100%", alignSelf: "center", flexDirection: "row", alignItems: "flex-end", gap: 8 },
  composeAction: { alignItems: "center", justifyContent: "center" },
  input: { flex: 1, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
});
