import { Feather } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
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

type Topic = {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  reason: "Payment Issue" | "Technical Failure" | "Inappropriate Behavior" | "Other";
};

const TOPICS: readonly Topic[] = [
  { label: "Payments", icon: "credit-card", reason: "Payment Issue" },
  { label: "Classes", icon: "calendar", reason: "Technical Failure" },
  { label: "Messages", icon: "message-circle", reason: "Technical Failure" },
  { label: "Homework", icon: "edit-3", reason: "Technical Failure" },
  { label: "Account", icon: "user", reason: "Other" },
  { label: "Safety", icon: "shield", reason: "Inappropriate Behavior" },
];

type Bubble = { id: string; from: "assistant" | "user"; text: string };

const WELCOME: Bubble = {
  id: "welcome",
  from: "assistant",
  text: "Hi — I’m Fadko Support. Ask about classes, payments, homework, messages, or your account.",
};

/**
 * Premium support entry point shared by teacher and student tabs.
 *
 * It is deliberately useful while AI is disabled: topic shortcuts go to the existing secure
 * support form, and typed questions are kept on-device until the user chooses a human request.
 * This avoids a fake chatbot that implies an answer was checked when no provider is running.
 */
export default function SupportAssistantLauncher() {
  const pathname = usePathname();
  const colors = useColors();
  const { t, isExpanded } = useLayout();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState("");
  const [bubbles, setBubbles] = useState<Bubble[]>([WELCOME]);

  const bottom = Math.max(insets.bottom, Platform.OS === "web" ? space.sm : space.xs) + (isExpanded ? 92 : 88);
  const panelWidth = Math.min(width - space.md * 2, isExpanded ? 440 : 520);
  const panelTitle = useMemo(() => (bubbles.length > 1 ? "Continue with Fadko Support" : "Fadko Support"), [bubbles.length]);

  // The full Support tab already owns the form. Showing another launcher on it would feel like
  // a duplicate control and would make browser Back harder to understand.
  if (pathname === "/support") return null;

  const openRequest = (topic?: Topic) => {
    setVisible(false);
    if (topic) {
      router.push({ pathname: "/support", params: { reason: topic.reason } });
    } else {
      router.push("/support");
    }
  };

  const sendDraft = () => {
    const text = draft.trim();
    if (!text) return;
    setBubbles((current) => [
      ...current,
      { id: `user-${Date.now()}`, from: "user", text },
      {
        id: `assistant-${Date.now()}`,
        from: "assistant",
        text: "I can help you get this to the right place. Open a support request and the team will see your question with the correct category.",
      },
    ]);
    setDraft("");
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
        <View style={[styles.launcherDot, { backgroundColor: colors.online, borderColor: colors.primary }]} />
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
                <Text style={[t.title3, { color: colors.foreground }]}>{panelTitle}</Text>
                <View style={styles.statusLine}>
                  <View style={[styles.statusDot, { backgroundColor: colors.online }]} />
                  <Text style={[t.caption, { color: colors.mutedForeground }]}>Quick answers · human help when needed</Text>
                </View>
              </View>
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
              style={styles.transcript}
              contentContainerStyle={styles.transcriptContent}
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
                </View>
              ))}

              <Text style={[t.caption, styles.sectionLabel, { color: colors.mutedForeground }]}>Choose a topic</Text>
              <View style={styles.topicGrid}>
                {TOPICS.map((topic) => (
                  <Pressable
                    key={topic.label}
                    accessibilityRole="button"
                    testID={`support-topic-${topic.label.toLowerCase()}`}
                    onPress={() => openRequest(topic)}
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
              </View>
            </ScrollView>

            <View style={[styles.composer, { borderColor: colors.border, backgroundColor: colors.muted }]}>
              <TextInput
                testID="support-assistant-input"
                value={draft}
                onChangeText={setDraft}
                placeholder="Ask a question…"
                placeholderTextColor={colors.mutedForeground}
                multiline
                maxLength={1200}
                returnKeyType="send"
                onSubmitEditing={sendDraft}
                style={[t.body, styles.input, { color: colors.foreground }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send support question"
                testID="support-assistant-send"
                disabled={!draft.trim()}
                onPress={sendDraft}
                style={({ pressed }) => [
                  styles.send,
                  { backgroundColor: draft.trim() ? colors.primary : colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="arrow-up" size={18} color={draft.trim() ? colors.primaryForeground : colors.mutedForeground} />
              </Pressable>
            </View>

            <View style={styles.panelFooter}>
              <Pressable
                accessibilityRole="button"
                testID="support-assistant-open-request"
                onPress={() => openRequest()}
                style={({ pressed }) => [styles.footerAction, pressed && styles.pressed]}
              >
                <Feather name="edit-2" size={15} color={colors.primary} />
                <Text style={[t.caption, { color: colors.primary, fontWeight: "700" }]}>Open a support request</Text>
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
  statusDot: { width: 6, height: 6, borderRadius: radius.pill },
  close: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  transcript: { flexGrow: 0 },
  transcriptContent: { paddingHorizontal: space.md, paddingBottom: space.sm, gap: space.sm },
  bubble: { maxWidth: "88%", borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.sm, paddingVertical: space.sm },
  sectionLabel: { marginTop: space.xs, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  topicGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  topic: { minHeight: HIT_SLOP_MIN, minWidth: "31%", flexGrow: 1, flexBasis: "30%", borderWidth: 1, borderRadius: radius.md, alignItems: "center", justifyContent: "center", gap: space.xxs, paddingHorizontal: space.xs, paddingVertical: space.xs },
  topicIcon: { width: 28, height: 28, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  composer: { marginHorizontal: space.md, marginBottom: space.sm, borderWidth: 1, borderRadius: radius.md, flexDirection: "row", alignItems: "flex-end", padding: space.xs, gap: space.xs },
  input: { flex: 1, minHeight: 40, maxHeight: 90, paddingHorizontal: space.xs, paddingVertical: space.xs },
  send: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  panelFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm },
  footerAction: { minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.xxs, justifyContent: "center", paddingHorizontal: space.xs },
  pressed: { opacity: 0.72 },
});
