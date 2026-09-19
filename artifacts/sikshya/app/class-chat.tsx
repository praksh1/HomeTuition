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
import { ApiError, apiGet, apiPost } from "@/utils/api";
import { classConversationId } from "@/utils/conversationRoute";
import { clearDraft, getDraft, saveDraft } from "@/utils/drafts";
import { shouldSendMessageOnKey } from "@/utils/messageComposer";
import { messageDayLabel, messageTimeLabel, shouldShowDay } from "@/utils/messageTimeline";
import { notificationMatchesReadTarget } from "@/utils/notificationCenter";
import type { Attachment } from "@/utils/reactions";
import { uploadFile, type UploadableFile } from "@/utils/uploadFile";

interface Message {
  id: number;
  senderId: number;
  senderName: string;
  senderRole: string;
  body: string;
  createdAt: string;
  file?: Attachment | null;
}

interface ViewData {
  title: string;
  isTeacher: boolean;
  messages: Message[];
  pinned: Message[];
  hasEarlier?: boolean;
  beforeCursor?: number | null;
}

/**
 * The persistent room for one class.
 *
 * This behaves like a current conversation rather than a form followed by a stack of records:
 * the composer stays under the person's thumb, the newest message is where the screen settles,
 * and an interrupted draft stays on the device. Online dots, typing status and group "seen"
 * claims are absent because the server does not know those facts yet.
 */
export default function ClassChatScreen() {
  const params = useLocalSearchParams<{ id?: string; batchId?: string }>();
  const routeBatchId = classConversationId(params);
  const batchId = routeBatchId ?? 0;
  const draftKey = `class:${batchId}`;
  const colors = useColors();
  const dates = useDates();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { lastEvent, notifications, markTargetRead } = useNotifications();
  const { t, numeric, gutter, space, radius, isWide } = useLayout();
  const [view, setView] = useState<ViewData | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<UploadableFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [loadProblem, setLoadProblem] = useState(false);
  const [loadProblemMessage, setLoadProblemMessage] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const scrollAfterLayout = useRef(true);
  const scrollPass = useRef(0);
  const hasLoaded = useRef(false);
  const acknowledgedThrough = useRef<number | null>(null);

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
    void getDraft(draftKey).then((saved) => {
      if (!cancelled && saved) setDraft(saved);
    });
    return () => { cancelled = true; };
  }, [draftKey]);

  const acknowledge = useCallback(async (messages: Message[]) => {
    const lastMessageId = messages.at(-1)?.id;
    if (!lastMessageId || acknowledgedThrough.current === lastMessageId) return;
    try {
      await apiPost(`/class-groups/${batchId}/messages/read`, { lastMessageId });
      acknowledgedThrough.current = lastMessageId;
    } catch {
      // A lost acknowledgement leaves the badge until the next refresh; it must not take the
      // conversation away from the person who is already reading it.
    }
  }, [batchId]);

  const load = useCallback(async () => {
    if (routeBatchId == null) {
      setLoadProblemMessage("This class conversation link is incomplete. Return to Messages and open the class again.");
      setLoadProblem(true);
      setLoading(false);
      return;
    }
    try {
      const next = await apiGet<ViewData>(`/class-groups/${batchId}/messages`);
      if (!hasLoaded.current) scrollAfterLayout.current = true;
      setView(next);
      hasLoaded.current = true;
      setLoadProblem(false);
      setLoadProblemMessage("");
      void acknowledge(next.messages);
      void markTargetRead({ kind: "class_message", batchId });
    } catch (error) {
      setLoadProblem(true);
      setLoadProblemMessage(error instanceof ApiError && error.status === 403
        ? "This conversation is available only to the teacher and enrolled students."
        : error instanceof ApiError && error.status === 404
          ? "This class conversation is no longer available."
          : "Fadko could not load this conversation. Try again.");
    } finally {
      setLoading(false);
    }
  }, [acknowledge, batchId, markTargetRead, routeBatchId]);

  useEffect(() => {
    void load();
    // Live events provide the quick path; this slower pass catches a dropped socket without
    // making every mounted class screen talk to the server ten times a minute.
    const interval = setInterval(() => void load(), 8000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if ((lastEvent?.kind === "class_message" || lastEvent?.kind === "conversation_sync") && Number(lastEvent.batchId) === batchId) {
      scrollAfterLayout.current = true;
      void load();
    }
  }, [batchId, lastEvent, load]);

  useEffect(() => {
    const target = { kind: "class_message" as const, batchId };
    if (notifications.some((notification) => !notification.read && notificationMatchesReadTarget(notification, target))) {
      void markTargetRead(target);
    }
  }, [batchId, markTargetRead, notifications]);

  const messages = useMemo(() => view?.messages ?? [], [view?.messages]);
  const timeline = useMemo(() => messages.map((message) => ({ ...message, read: false })), [messages]);
  const pinned = useMemo(
    () => (view?.pinned ?? []).filter((item) => !messages.some((message) => message.id === item.id)),
    [messages, view?.pinned],
  );

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
    if ((!body && !pending) || sending) return;
    const outgoing = pending;
    setSending(true);
    setProblem(null);
    setDraft("");
    setPending(null);
    try {
      const fileKey = outgoing ? await uploadFile(outgoing) : undefined;
      const sent = await apiPost<Message>(`/class-groups/${batchId}/messages`, {
        body,
        ...(fileKey ? { fileKey, fileType: outgoing!.mimeType, fileName: outgoing!.name } : {}),
      });
      await clearDraft(draftKey);
      scrollAfterLayout.current = true;
      setView((current) => current ? { ...current, messages: [...current.messages, sent] } : current);
    } catch (error) {
      setDraft(body);
      setPending(outgoing);
      void saveDraft(draftKey, body);
      setProblem(error instanceof Error && error.message ? error.message : "That message did not send. Try again.");
    } finally {
      setSending(false);
    }
  };

  const loadEarlier = async () => {
    if (!view?.hasEarlier || !view.beforeCursor || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const earlier = await apiGet<ViewData>(`/class-groups/${batchId}/messages?before=${view.beforeCursor}`);
      setView((current) => current ? {
        ...current,
        messages: [...earlier.messages, ...current.messages.filter((message) => !earlier.messages.some((old) => old.id === message.id))],
        hasEarlier: earlier.hasEarlier,
        beforeCursor: earlier.beforeCursor,
      } : current);
      setLoadProblem(false);
    } catch {
      setProblem("Earlier messages could not be loaded. Try again.");
    } finally {
      setLoadingEarlier(false);
    }
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const mine = item.senderId === user?.userId;
    const showDay = shouldShowDay(timeline, index);
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
        <View style={[styles.bubbleRow, mine ? styles.mine : styles.theirs]}>
          <View
            style={[
              styles.bubble,
              { maxWidth: isWide ? "70%" : "86%", borderRadius: radius.lg },
              mine
                ? { backgroundColor: colors.primary }
                : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
            ]}
            testID={`class-message-${item.id}`}
          >
            {!mine ? (
              <View style={styles.senderRow}>
                <Text style={[t.caption, { color: colors.primary }]}>{item.senderName}</Text>
                {item.senderRole === "teacher" ? (
                  <View style={[styles.teacherBadge, { borderRadius: radius.pill, backgroundColor: colors.actionSoft }]}>
                    <Text style={[t.overline, { color: colors.primary }]}>TEACHER</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {item.body ? <Text style={[t.body, { color: mine ? colors.primaryForeground : colors.foreground }]}>{item.body}</Text> : null}
            {item.file ? (
              <View style={{ marginTop: item.body ? space.xs : 0 }}>
                <MessageAttachment file={item.file} mine={mine} onProblem={setProblem} />
              </View>
            ) : null}
          </View>
        </View>
        <View style={[styles.metaRow, mine ? styles.mine : styles.theirs]}>
          <Text style={[t.caption, numeric, { color: colors.inkFaint }]}>
            {mine ? (view?.isTeacher ? "You · Teacher · " : "You · ") : ""}{messageTimeLabel(item.createdAt)}
          </Text>
        </View>
      </View>
    );
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
            style={[styles.headerAction, { minWidth: HIT_SLOP_MIN, minHeight: HIT_SLOP_MIN, borderRadius: radius.pill, borderColor: colors.border }]}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel="Back to class"
            testID="class-chat-back"
          >
            <Feather name="arrow-left" size={20} color={colors.primary} />
          </TouchableOpacity>
          <View style={[styles.classAvatar, { borderRadius: radius.pill, backgroundColor: colors.actionSoft }]}>
            <Feather name="users" size={18} color={colors.primary} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]} numberOfLines={1}>{view?.title ?? "Class conversation"}</Text>
            <Text style={[t.caption, { color: colors.inkFaint }]}>Everyone enrolled in this class</Text>
          </View>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(message) => String(message.id)}
        renderItem={renderMessage}
        style={styles.list}
        contentContainerStyle={{ width: "100%", maxWidth: marketplaceColumnMax, alignSelf: "center", flexGrow: 1, paddingHorizontal: gutter, paddingTop: space.md, paddingBottom: space.xl, gap: space.xs }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => {
          if (!scrollAfterLayout.current) return;
          settleAtNewest();
        }}
        onLayout={() => { if (scrollAfterLayout.current) settleAtNewest(); }}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        ListHeaderComponent={(
          <>
            {loadProblem && messages.length > 0 ? (
              <TouchableOpacity onPress={() => void load()} style={[styles.connectionNote, { borderRadius: radius.sm, backgroundColor: colors.warnSoft }]} testID="class-chat-retry-inline">
                <Feather name="refresh-cw" size={15} color={colors.warn} />
                <Text style={[t.caption, { color: colors.warn }]}>New messages may be delayed. Tap to retry.</Text>
              </TouchableOpacity>
            ) : null}
            {pinned.map((item) => (
              <View key={`pinned-${item.id}`} style={[styles.pinned, { borderRadius: radius.md, borderColor: colors.border, backgroundColor: colors.actionSoft }]}>
                <View style={styles.pinnedTitle}>
                  <Feather name="bookmark" size={15} color={colors.primary} />
                  <Text style={[t.caption, { color: colors.primary }]}>Pinned by your teacher</Text>
                </View>
                <Text style={[t.bodyStrong, { color: colors.foreground }]}>{item.body || "Shared a file"}</Text>
                {item.file ? <MessageAttachment file={item.file} mine={false} onProblem={setProblem} /> : null}
              </View>
            ))}
            {view?.hasEarlier ? (
              <TouchableOpacity
                onPress={() => void loadEarlier()}
                disabled={loadingEarlier}
                style={[styles.loadEarlier, { minHeight: HIT_SLOP_MIN, borderRadius: radius.pill, borderColor: colors.border, backgroundColor: colors.card }]}
                accessibilityRole="button"
                accessibilityState={{ disabled: loadingEarlier }}
                aria-disabled={loadingEarlier}
                testID="class-chat-load-earlier"
              >
                {loadingEarlier ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="arrow-up" size={15} color={colors.primary} />}
                <Text style={[t.caption, { color: colors.primary }]}>{loadingEarlier ? "Loading…" : "Load earlier messages"}</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
        ListEmptyComponent={(
          <View style={styles.empty}>
            {loading ? (
              <><ActivityIndicator color={colors.primary} /><Text style={[t.callout, { color: colors.mutedForeground }]}>Loading conversation…</Text></>
            ) : loadProblem ? (
              <>
                <View style={[styles.emptyIcon, { borderRadius: radius.pill, backgroundColor: colors.warnSoft }]}><Feather name="alert-circle" size={22} color={colors.warn} /></View>
                <Text style={[t.title3, { color: colors.foreground }]}>Conversation unavailable</Text>
                <Text style={[t.callout, styles.center, { color: colors.mutedForeground }]}>{loadProblemMessage || "Fadko could not load this conversation. Try again."}</Text>
                <TouchableOpacity onPress={() => { setLoading(true); void load(); }} style={[styles.retry, { minHeight: HIT_SLOP_MIN, borderRadius: radius.sm, backgroundColor: colors.primary }]} testID="class-chat-retry">
                  <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Try again</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={[styles.emptyIcon, { borderRadius: radius.pill, backgroundColor: colors.actionSoft }]}><Feather name="message-circle" size={24} color={colors.primary} /></View>
                <Text style={[t.title3, { color: colors.foreground }]}>The conversation starts here</Text>
                <Text style={[t.callout, styles.center, { color: colors.mutedForeground }]}>{view?.isTeacher ? "Welcome the class or share the first update." : "Ask your teacher a question or help a classmate."}</Text>
              </>
            )}
          </View>
        )}
      />

      {problem ? (
        <View style={[styles.noticeShell, { borderTopColor: colors.border, backgroundColor: colors.destructiveSoft }]}>
          <View style={[styles.notice, { maxWidth: marketplaceColumnMax, paddingHorizontal: gutter }]}>
            <Feather name="alert-circle" size={17} color={colors.destructive} />
            <Text style={[t.caption, styles.noticeText, { color: colors.destructive }]}>{problem}</Text>
            <TouchableOpacity onPress={() => setProblem(null)} style={styles.noticeAction} accessibilityLabel="Dismiss message problem"><Feather name="x" size={18} color={colors.destructive} /></TouchableOpacity>
          </View>
        </View>
      ) : null}

      {pending ? (
        <View style={[styles.noticeShell, { borderTopColor: colors.border, backgroundColor: colors.muted }]}>
          <View style={[styles.notice, { maxWidth: marketplaceColumnMax, paddingHorizontal: gutter }]}>
            <Feather name={pending.mimeType.startsWith("image/") ? "image" : "file-text"} size={17} color={colors.primary} />
            <Text style={[t.caption, styles.noticeText, { color: colors.foreground }]} numberOfLines={1}>{pending.name}</Text>
            <TouchableOpacity onPress={() => setPending(null)} style={styles.noticeAction} accessibilityLabel="Remove attachment"><Feather name="x" size={18} color={colors.mutedForeground} /></TouchableOpacity>
          </View>
        </View>
      ) : null}

      {view ? (
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
              testID="class-chat-attach"
            >
              <Feather name="paperclip" size={19} color={colors.primary} />
            </TouchableOpacity>
            <TextInput
              value={draft}
              onChangeText={(text) => { setDraft(text); void saveDraft(draftKey, text); }}
              placeholder="Message your class…"
              placeholderTextColor={colors.inkFaint}
              style={[t.body, styles.input, { minHeight: HIT_SLOP_MIN, maxHeight: 112, borderRadius: radius.lg, borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
              multiline
              onKeyPress={(event) => {
                const native = event.nativeEvent as typeof event.nativeEvent & { shiftKey?: boolean; isComposing?: boolean };
                if (!shouldSendMessageOnKey(Platform.OS, native.key, native.shiftKey, native.isComposing)) return;
                event.preventDefault();
                void send();
              }}
              accessibilityLabel="Class message"
              testID="class-chat-input"
            />
            <TouchableOpacity
              style={[styles.composeAction, { minWidth: HIT_SLOP_MIN, minHeight: HIT_SLOP_MIN, borderRadius: radius.pill, backgroundColor: draft.trim() || pending ? colors.primary : colors.muted }]}
              onPress={() => void send()}
              disabled={(!draft.trim() && !pending) || sending}
              accessibilityRole="button"
              accessibilityLabel="Send class message"
              accessibilityState={{ disabled: (!draft.trim() && !pending) || sending }}
              aria-disabled={(!draft.trim() && !pending) || sending}
              testID="class-chat-send"
            >
              {sending ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="send" size={18} color={draft.trim() || pending ? colors.primaryForeground : colors.inkFaint} />}
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { borderBottomWidth: StyleSheet.hairlineWidth },
  headerInner: { width: "100%", alignSelf: "center", minHeight: 66, flexDirection: "row", alignItems: "center", gap: 10 },
  headerAction: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  classAvatar: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, minWidth: 0 },
  list: { flex: 1 },
  connectionNote: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 12, marginBottom: 12 },
  pinned: { borderWidth: 1, gap: 8, padding: 14, marginBottom: 12 },
  pinnedTitle: { flexDirection: "row", alignItems: "center", gap: 7 },
  loadEarlier: { alignSelf: "center", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, paddingHorizontal: 16, marginBottom: 12 },
  messageBlock: { gap: 4 },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 8 },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth },
  bubbleRow: { flexDirection: "row" },
  mine: { justifyContent: "flex-end" },
  theirs: { justifyContent: "flex-start" },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, gap: 5 },
  senderRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  teacherBadge: { paddingHorizontal: 7, paddingVertical: 2 },
  metaRow: { flexDirection: "row", paddingHorizontal: 4 },
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
