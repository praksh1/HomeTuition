import { Feather } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { elevation, HIT_SLOP_MIN, radius, space } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPost } from "@/utils/api";
import { useAuth } from "@/context/AuthContext";

type Topic = {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  question: string;
};

const TOPICS: readonly Topic[] = [
  { label: "Payments", icon: "credit-card", question: "I need help with a class payment or refund." },
  { label: "Classes", icon: "calendar", question: "I cannot join my class or lesson." },
  { label: "Messages", icon: "message-circle", question: "I need help with class or direct messages." },
  { label: "Homework", icon: "edit-3", question: "I need help with homework or feedback." },
  { label: "Account", icon: "user", question: "I need help with my account or profile." },
  { label: "Safety", icon: "shield", question: "I need to report a safety concern." },
];

type Bubble = { id: string; from: "assistant" | "user"; text: string; source?: string; article?: string };
type SavedMessage = { id: number; role: "assistant" | "user"; body: string; source: string };
type Conversation = { id: number; ticketId: number | null };
type SuggestedReply = { label: string; question: string };

const WELCOME: Bubble = {
  id: "welcome",
  from: "assistant",
  text: "Hi — I can search Fadko’s reviewed answers. If I’m not sure, you can send your question to a person.",
};

/**
 * The Profile support panel. Reviewed answers work without an AI key; unanswered questions
 * offer a durable human handoff rather than a fabricated promise or a dead-end chatbot.
 */
export default function SupportAssistantLauncher({ openOnMount = false }: { openOnMount?: boolean }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const colors = useColors();
  const { t, isExpanded } = useLayout();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [visible, setVisible] = useState(openOnMount);
  const [draft, setDraft] = useState("");
  const [bubbles, setBubbles] = useState<Bubble[]>([WELCOME]);
  const [suggestedReplies, setSuggestedReplies] = useState<readonly SuggestedReply[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [ticketId, setTicketId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendingToHuman, setSendingToHuman] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<Record<string, boolean>>({});
  const transcript = useRef<ScrollView>(null);
  const skipHistoryLoad = useRef(false);

  useEffect(() => { if (openOnMount) setVisible(true); }, [openOnMount]);
  useEffect(() => {
    skipHistoryLoad.current = false;
    setConversationId(null);
    setTicketId(null);
    setBubbles([WELCOME]);
    setSuggestedReplies([]);
  }, [user?.id]);

  const loadLatest = useCallback(async () => {
    try {
      const result = await apiGet<{ conversations: Conversation[] }>("/support/assistant/conversations");
      const latest = result.conversations?.[0];
      if (!latest) return;
      const detail = await apiGet<{ messages: SavedMessage[]; suggestedReplies?: SuggestedReply[] }>(`/support/assistant/conversations/${latest.id}`);
      if (skipHistoryLoad.current) return;
      setConversationId(latest.id);
      setTicketId(latest.ticketId);
      setSuggestedReplies(detail.suggestedReplies ?? []);
      setBubbles(detail.messages.map((message) => ({
        id: String(message.id), from: message.role, text: message.body, source: message.source,
      })));
    } catch { /* The assistant remains available for a fresh question. */ }
  }, []);
  useEffect(() => {
    if (visible && conversationId === null && !skipHistoryLoad.current) void loadLatest();
  }, [visible, conversationId, loadLatest]);

  const bottom = Math.max(insets.bottom, Platform.OS === "web" ? space.sm : space.xs) + (isExpanded ? 92 : 88);
  const panelWidth = Math.min(width - space.md * 2, isExpanded ? 440 : 520);
  const hasConversation = bubbles.some((bubble) => bubble.id !== WELCOME.id);

  // The full Support tab already owns the form. Showing another launcher on it would feel like
  // a duplicate control and would make browser Back harder to understand.
  if (pathname === "/support") return null;

  const openRequest = () => {
    setVisible(false);
    router.push("/support");
  };

  const startFresh = () => {
    skipHistoryLoad.current = true;
    setConversationId(null);
    setTicketId(null);
    setBubbles([WELCOME]);
    setSuggestedReplies([]);
    setDraft("");
    setError("");
  };

  const sendQuestion = async (value: string) => {
    const text = value.trim();
    if (!text || busy || ticketId) return;
    skipHistoryLoad.current = true;
    setError("");
    setBusy(true);
    setDraft("");
    try {
      const result = await apiPost<{ conversationId: number; question: SavedMessage; reply: SavedMessage; article: { title: string } | null; suggestedReplies?: SuggestedReply[] }>(
        "/support/assistant/messages", { message: text, conversationId }, { timeoutMs: 12_000 },
      );
      setConversationId(result.conversationId);
      setSuggestedReplies(result.suggestedReplies ?? []);
      setBubbles((current) => [...current.filter((bubble) => bubble.id !== WELCOME.id),
        { id: String(result.question.id), from: "user", text: result.question.body },
        { id: String(result.reply.id), from: "assistant", text: result.reply.body,
          source: result.reply.source, article: result.article?.title },
      ]);
    } catch (cause) {
      setDraft(text);
      setError(cause instanceof Error ? cause.message : "Your question was not sent. Try again.");
    } finally { setBusy(false); }
  };

  const rateAnswer = async (id: string, helpful: boolean) => {
    if (!/^\d+$/.test(id) || id in feedback) return;
    try {
      await apiPost(`/support/assistant/messages/${id}/feedback`, { helpful });
      setFeedback((current) => ({ ...current, [id]: helpful }));
    } catch { setError("Could not save your feedback. You can try again."); }
  };

  const handoff = async () => {
    if (!conversationId) { openRequest(); return; }
    if (sendingToHuman || ticketId) return;
    setSendingToHuman(true);
    setError("");
    try {
      const result = await apiPost<{ ticketId: number; ref: string }>(
        `/support/assistant/conversations/${conversationId}/request`, {},
      );
      setTicketId(result.ticketId);
      setBubbles((current) => [...current, { id: `request-${result.ticketId}`, from: "assistant",
        text: `Sent to Fadko Support as ${result.ref}. You can follow it in My requests.` }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send this request."); }
    finally { setSendingToHuman(false); }
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Fadko Support"
        testID="support-assistant-launcher"
        hitSlop={8}
        onPress={() => setVisible(true)}
        style={({ pressed }) => [
          styles.launcher,
          {
            right: isExpanded ? space.xl : space.md,
            bottom,
            backgroundColor: colors.primary,
            borderColor: colors.card,
            ...elevation.sheet,
          },
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.launcherRing, { borderColor: colors.brand + "90" }]} />
        <Feather name="life-buoy" size={21} color={colors.primaryForeground} />
        <View style={[styles.launcherDot, { backgroundColor: colors.brand, borderColor: colors.primary }]} />
      </Pressable>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            accessibilityLabel="Close support"
            style={[styles.scrim, { backgroundColor: colors.scrim }]}
            onPress={() => setVisible(false)}
          />
          <View
            testID="support-assistant-panel"
            style={[
              styles.panel,
              {
                width: panelWidth,
                maxHeight: "86%",
                right: isExpanded ? space.xl : space.md,
                bottom: Math.max(insets.bottom, space.sm) + (isExpanded ? 86 : space.md),
                backgroundColor: colors.card,
                borderColor: colors.border,
                ...elevation.modal,
              },
            ]}
          >
            <View style={styles.panelHeader}>
              <View style={[styles.supportMark, { backgroundColor: colors.primary }]}>
                <Feather name="life-buoy" size={20} color={colors.primaryForeground} />
                <View style={[styles.markDot, { backgroundColor: colors.brand }]} />
              </View>
              <View style={styles.headerCopy}>
                <Text style={[t.title3, { color: colors.foreground }]}>Fadko Support</Text>
                <View style={styles.statusLine}>
                  <Text style={[t.caption, { color: colors.mutedForeground }]}>Reviewed answers</Text>
                </View>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Start a new support conversation"
                onPress={startFresh} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
                <Feather name="edit" size={18} color={colors.primary} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close Fadko Support"
                testID="support-assistant-close"
                hitSlop={10}
                onPress={() => setVisible(false)}
                style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              >
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <ScrollView
              ref={transcript}
              style={styles.transcript}
              contentContainerStyle={styles.transcriptContent}
              onContentSizeChange={() => transcript.current?.scrollToEnd({ animated: true })}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {bubbles.map((bubble) => (
                <View
                  key={bubble.id}
                  style={[
                    styles.bubble,
                    bubble.from === "user"
                      ? { alignSelf: "flex-end", backgroundColor: colors.primary }
                      : { alignSelf: "flex-start", backgroundColor: colors.muted, borderColor: colors.border },
                  ]}
                >
                  <Text style={[t.body, { color: bubble.from === "user" ? colors.primaryForeground : colors.foreground }]}>
                    {bubble.text}
                  </Text>
                  {bubble.article && <Text style={[t.caption, { color: colors.mutedForeground }]}>From Fadko Help: {bubble.article}</Text>}
                  {bubble.source === "ai" && <Text style={[t.caption, { color: colors.mutedForeground }]}>AI-assisted answer · verify important details</Text>}
                  {(bubble.source === "faq" || bubble.source === "ai") && <View style={styles.feedbackRow}>
                    <Text style={[t.caption, { color: colors.mutedForeground }]}>{bubble.id in feedback ? "Thanks for the feedback" : "Helpful?"}</Text>
                    {!(bubble.id in feedback) && <>
                      <Pressable accessibilityRole="button" accessibilityLabel="This answer helped" onPress={() => void rateAnswer(bubble.id, true)} hitSlop={8}>
                        <Feather name="thumbs-up" size={16} color={colors.primary} />
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel="This answer did not help" onPress={() => void rateAnswer(bubble.id, false)} hitSlop={8}>
                        <Feather name="thumbs-down" size={16} color={colors.primary} />
                      </Pressable>
                    </>}
                  </View>}
                </View>
              ))}
              {suggestedReplies.length > 0 && !ticketId && <View style={styles.replyChoices}>
                {suggestedReplies.map((choice) => <Pressable
                  key={choice.question}
                  accessibilityRole="button"
                  accessibilityLabel={choice.label}
                  disabled={busy}
                  testID="support-suggested-reply"
                  onPress={() => void sendQuestion(choice.question)}
                  style={({ pressed }) => [styles.replyChoice,
                    { backgroundColor: colors.card, borderColor: colors.primary },
                    pressed && { backgroundColor: colors.actionSoft }]}
                >
                  <Text style={[t.caption, { color: colors.primary, fontWeight: "600" }]}>{choice.label}</Text>
                  <Feather name="arrow-up-right" size={14} color={colors.primary} />
                </Pressable>)}
              </View>}
              {busy && <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Fadko Support is answering" />}
              {!!error && <Text accessibilityRole="alert" style={[t.caption, { color: colors.destructive }]}>{error}</Text>}

              {!hasConversation && <><Text style={[t.caption, styles.sectionLabel, { color: colors.mutedForeground }]}>Choose a topic</Text>
              <View style={styles.topicGrid}>
                {TOPICS.map((topic) => (
                  <Pressable
                    key={topic.label}
                    accessibilityRole="button"
                    disabled={busy || !!ticketId}
                    testID={`support-topic-${topic.label.toLowerCase()}`}
                    onPress={() => void sendQuestion(topic.question)}
                    style={({ pressed }) => [
                      styles.topic,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      pressed && { backgroundColor: colors.actionSoft, borderColor: colors.primary },
                    ]}
                  >
                    <View style={[styles.topicIcon, { backgroundColor: colors.actionSoft }]}>
                      <Feather name={topic.icon} size={16} color={colors.primary} />
                    </View>
                    <Text style={[t.caption, { color: colors.foreground, fontWeight: "600" }]}>{topic.label}</Text>
                  </Pressable>
                ))}
              </View></>}
            </ScrollView>

            <View style={[styles.composer, { borderColor: colors.border, backgroundColor: colors.muted }]}>
              <TextInput
                testID="support-assistant-input"
                value={draft}
                onChangeText={setDraft}
                placeholder={ticketId ? "Request sent — start a new chat to ask more" : "Ask a question…"}
                placeholderTextColor={colors.mutedForeground}
                multiline
                maxLength={1200}
                editable={!busy && !ticketId}
                returnKeyType="send"
                submitBehavior="submit"
                onSubmitEditing={() => void sendQuestion(draft)}
                style={[t.body, styles.input, { color: colors.foreground }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send support question"
                testID="support-assistant-send"
                disabled={!draft.trim() || busy || !!ticketId}
                onPress={() => void sendQuestion(draft)}
                style={({ pressed }) => [
                  styles.send,
                  { backgroundColor: draft.trim() && !busy ? colors.primary : colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="arrow-up" size={18} color={draft.trim() && !busy ? colors.primaryForeground : colors.mutedForeground} />
              </Pressable>
            </View>

            <Text style={[t.caption, styles.privacyNote, { color: colors.mutedForeground }]}>Do not share passwords, codes or payment numbers. Fadko never needs them here.</Text>

            <View style={styles.panelFooter}>
              <Pressable
                accessibilityRole="button"
                testID="support-assistant-open-request"
                onPress={() => void handoff()}
                style={({ pressed }) => [styles.footerAction, pressed && styles.pressed]}
              >
                <Feather name="edit-2" size={15} color={colors.primary} />
                <Text style={[t.caption, { color: colors.primary, fontWeight: "700" }]}>{ticketId ? "Sent to a person" : sendingToHuman ? "Sending…" : "Ask a person"}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                testID="support-assistant-my-requests"
                onPress={() => { setVisible(false); router.push("/requests"); }}
                style={({ pressed }) => [styles.footerAction, pressed && styles.pressed]}
              >
                <Text style={[t.caption, { color: colors.mutedForeground }]}>My requests</Text>
                <Feather name="arrow-up-right" size={14} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  launcher: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
  },
  launcherRing: { position: "absolute", width: 44, height: 44, borderRadius: radius.pill, borderWidth: 1 },
  launcherDot: { position: "absolute", top: 2, right: 1, width: 11, height: 11, borderRadius: radius.pill, borderWidth: 2 },
  modalRoot: { flex: 1, justifyContent: "flex-end", alignItems: "flex-end" },
  scrim: { ...StyleSheet.absoluteFillObject },
  panel: { position: "absolute", borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  panelHeader: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md, borderBottomWidth: 1, borderBottomColor: "transparent" },
  supportMark: { width: 42, height: 42, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  markDot: { position: "absolute", right: 4, top: 4, width: 7, height: 7, borderRadius: radius.pill },
  headerCopy: { flex: 1, gap: 2 },
  statusLine: { flexDirection: "row", alignItems: "center", gap: space.xxs },
  close: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  transcript: { flexGrow: 0 },
  transcriptContent: { paddingHorizontal: space.md, paddingBottom: space.sm, gap: space.sm },
  bubble: { maxWidth: "88%", borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.sm, paddingVertical: space.sm },
  feedbackRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs },
  replyChoices: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  replyChoice: { minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.xxs,
    borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: space.xs },
  sectionLabel: { marginTop: space.xs, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  topicGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  topic: { minHeight: HIT_SLOP_MIN, minWidth: "31%", flexGrow: 1, flexBasis: "30%", borderWidth: 1, borderRadius: radius.md, alignItems: "center", justifyContent: "center", gap: space.xxs, paddingHorizontal: space.xs, paddingVertical: space.xs },
  topicIcon: { width: 28, height: 28, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  composer: { marginHorizontal: space.md, marginBottom: space.sm, borderWidth: 1, borderRadius: radius.md, flexDirection: "row", alignItems: "flex-end", padding: space.xs, gap: space.xs },
  input: { flex: 1, minHeight: 40, maxHeight: 90, paddingHorizontal: space.xs, paddingVertical: space.xs },
  send: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  privacyNote: { paddingHorizontal: space.md, paddingBottom: space.xs },
  panelFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm },
  footerAction: { minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.xxs, justifyContent: "center", paddingHorizontal: space.xs },
  pressed: { opacity: 0.72 },
});
