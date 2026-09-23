import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import type { ChatMessage } from "@/hooks/useClassroomSocket";
import type { FloatingReaction } from "@/hooks/useClassroomSocket";
import { CLASS_REACTIONS, REACTION_COOLDOWN_MS } from "@/utils/classroomReactions";
import { ClassroomReactions } from "./ClassroomReactions";

interface ClassroomChatDrawerProps {
  open: boolean;
  messages: ChatMessage[];
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
  placeholder: string;
  emptyText: string;
  onReaction?: (emoji: string) => void;
  reactions?: FloatingReaction[];
  connected?: boolean;
}

interface GroupedMessage extends ChatMessage {
  startsGroup: boolean;
  endsGroup: boolean;
}

function groupMessages(messages: ChatMessage[]): GroupedMessage[] {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const next = messages[index + 1];
    const sameAsPrevious = Boolean(
      previous && previous.senderName === message.senderName && previous.isMe === message.isMe,
    );
    const sameAsNext = Boolean(
      next && next.senderName === message.senderName && next.isMe === message.isMe,
    );
    return { ...message, startsGroup: !sameAsPrevious, endsGroup: !sameAsNext };
  });
}

/**
 * The one class-conversation surface used by both classroom roles.
 *
 * A laptop gets a calm right drawer, while a phone gets a near-full-height bottom sheet. The
 * message list deliberately groups consecutive messages from the same person instead of wrapping
 * every sentence in its own heavy card. The composer stays fixed and the list only follows new
 * messages when the reader is already near the end, so reading older class history is not yanked
 * away by a new reply.
 */
export function ClassroomChatDrawer({
  open,
  messages,
  value,
  onChangeText,
  onSend,
  onClose,
  placeholder,
  emptyText,
  onReaction,
  reactions = [],
  connected = true,
}: ClassroomChatDrawerProps) {
  const colors = useColors();
  const { t, numeric, isCompact, space, radius, elevation } = useLayout();
  const scrollRef = useRef<ScrollView>(null);
  const nearEndRef = useRef(true);
  const previousCountRef = useRef(messages.length);
  const [newBelow, setNewBelow] = useState(0);
  const [reactionPicker, setReactionPicker] = useState(false);
  const [reactionCooling, setReactionCooling] = useState(false);
  useEffect(() => {
    if (!reactionCooling) return;
    const timer = setTimeout(() => setReactionCooling(false), REACTION_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [reactionCooling]);
  const grouped = useMemo(() => groupMessages(messages), [messages]);

  const scrollToLatest = useCallback((animated = true) => {
    nearEndRef.current = true;
    setNewBelow(0);
    scrollRef.current?.scrollToEnd({ animated });
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => scrollToLatest(false), 0);
    return () => clearTimeout(timer);
  }, [open, scrollToLatest]);

  useEffect(() => {
    const added = Math.max(0, messages.length - previousCountRef.current);
    previousCountRef.current = messages.length;
    if (!open || added === 0) return;
    if (nearEndRef.current || messages[messages.length - 1]?.isMe) {
      const timer = setTimeout(() => scrollToLatest(true), 0);
      return () => clearTimeout(timer);
    }
    setNewBelow((count) => count + added);
  }, [messages, open, scrollToLatest]);

  const submit = useCallback(() => {
    if (!value.trim() || !connected) return;
    onSend();
    setTimeout(() => scrollToLatest(true), 0);
  }, [onSend, scrollToLatest, value, connected]);

  const panel = (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[
        styles.panel,
        elevation.modal,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderTopLeftRadius: radius.lg,
          borderBottomLeftRadius: isCompact ? 0 : radius.lg,
          borderTopRightRadius: isCompact ? radius.lg : 0,
        },
      ]}
      testID="classroom-chat-drawer"
    >
      {isCompact ? (
        <View style={[styles.handleWrap, { minHeight: space.lg }]}>
          <View style={{ width: 42, height: 4, borderRadius: radius.pill, backgroundColor: colors.border }} />
        </View>
      ) : null}

      <View
        style={[
          styles.header,
          {
            minHeight: HIT_SLOP_MIN + space.sm,
            gap: space.sm,
            paddingLeft: space.md,
            paddingRight: space.xs,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={[styles.headerIcon, { borderRadius: radius.pill, backgroundColor: colors.actionSoft }]}>
          <Feather name="message-circle" size={18} color={colors.primary} />
        </View>
        <View style={styles.grow}>
          <Text style={[t.title3, { color: colors.foreground }]}>In-class messages</Text>
          <Text style={[t.caption, { color: connected ? colors.mutedForeground : colors.warn }]}>{connected ? "Everyone in this class · Live" : "Reconnecting · your draft is saved here"}</Text>
        </View>
        <TouchableOpacity
          testID="classroom-chat-close"
          accessibilityRole="button"
          accessibilityLabel="Close class messages"
          onPress={onClose}
          activeOpacity={0.72}
          style={[styles.iconButton, { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, borderRadius: radius.pill }]}
        >
          <Feather name="x" size={21} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <View style={styles.messageArea}>
        <ScrollView
          testID="classroom-chat-scroll"
          ref={scrollRef}
          style={styles.grow}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: space.md, paddingVertical: space.lg }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => { if (nearEndRef.current) scrollToLatest(false); }}
          scrollEventThrottle={80}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
            nearEndRef.current = distance < 96;
            if (nearEndRef.current && newBelow > 0) setNewBelow(0);
          }}
        >
          {grouped.length === 0 ? (
            <View style={[styles.empty, { gap: space.sm }]}>
              <View style={[styles.emptyIcon, { borderRadius: radius.pill, backgroundColor: colors.muted }]}>
                <Feather name="message-circle" size={22} color={colors.mutedForeground} />
              </View>
              <Text style={[t.bodyStrong, { color: colors.foreground }]}>No messages yet</Text>
              <Text style={[t.callout, { maxWidth: 280, color: colors.mutedForeground, textAlign: "center" }]}>
                {emptyText}
              </Text>
            </View>
          ) : null}

          {grouped.map((message) => (
            <View
              key={message.id}
              style={[
                styles.messageRow,
                message.isMe && styles.messageRowMe,
                { marginTop: message.startsGroup ? space.md : space.xxs },
              ]}
            >
              {message.startsGroup ? (
                <View style={[styles.senderLine, message.isMe && styles.senderLineMe, { gap: space.xs, marginBottom: space.xxs }]}>
                  <Text style={[t.overline, { color: message.isMe ? colors.primary : colors.mutedForeground }]}>
                    {message.isMe ? "You" : message.senderName}
                  </Text>
                </View>
              ) : null}
              <View
                style={[
                  styles.messageBody,
                  {
                    paddingHorizontal: space.sm,
                    paddingVertical: space.xs,
                    borderRadius: radius.md,
                    backgroundColor: message.isMe ? colors.actionSoft : colors.surfaceSunk,
                  },
                  message.isMe && { borderBottomRightRadius: message.endsGroup ? space.xxs : radius.md },
                  !message.isMe && { borderBottomLeftRadius: message.endsGroup ? space.xxs : radius.md },
                ]}
              >
                <Text selectable style={[t.body, { color: colors.foreground }]}>{message.text}</Text>
              </View>
              {message.endsGroup ? (
                <Text
                  style={[
                    t.overline,
                    numeric,
                    { marginTop: space.xxs, color: colors.inkFaint, textAlign: message.isMe ? "right" : "left" },
                  ]}
                >
                  {message.time}
                </Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
        <ClassroomReactions reactions={reactions} />

        {newBelow > 0 ? (
          <TouchableOpacity
            testID="classroom-chat-new-messages"
            accessibilityRole="button"
            accessibilityLabel={`${newBelow} new ${newBelow === 1 ? "message" : "messages"}. Jump to latest.`}
            onPress={() => scrollToLatest(true)}
            activeOpacity={0.82}
            style={[
              styles.newMessages,
              elevation.sheet,
              {
                gap: space.xs,
                bottom: space.sm,
                paddingHorizontal: space.sm,
                borderRadius: radius.pill,
                backgroundColor: colors.primary,
              },
            ]}
          >
            <Feather name="arrow-down" size={15} color={colors.primaryForeground} />
            <Text style={[t.caption, { color: colors.primaryForeground }]}>{newBelow} new</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {reactionPicker && onReaction ? (
        <View testID="classroom-reaction-picker" style={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xs, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text style={[t.overline, { color: colors.inkFaint }]}>React to the class</Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.xs }}>
            {CLASS_REACTIONS.map(({ emoji, label }) => <TouchableOpacity key={emoji}
              accessibilityRole="button" accessibilityLabel={`React: ${label}`}
              disabled={!connected || reactionCooling} aria-disabled={!connected || reactionCooling}
              onPress={() => { onReaction(emoji); setReactionCooling(true); }}
              style={{ minWidth: HIT_SLOP_MIN, minHeight: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.actionSoft, opacity: reactionCooling ? 0.55 : 1 }}>
              <Text style={t.title2}>{emoji}</Text>
            </TouchableOpacity>)}
          </View>
          <Text style={[t.caption, { color: colors.mutedForeground }]}>A quick reaction appears for everyone, then fades.</Text>
        </View>
      ) : null}

      <View
        style={[
          styles.composer,
          {
            gap: space.xs,
            paddingHorizontal: space.md,
            paddingTop: space.sm,
            paddingBottom: isCompact ? space.md : space.sm,
            borderTopColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      >
        <View
          style={[
            styles.inputShell,
            {
              minHeight: HIT_SLOP_MIN,
              paddingLeft: space.md,
              borderRadius: radius.lg,
              borderColor: colors.border,
              backgroundColor: colors.surfaceSunk,
            },
          ]}
        >
          {onReaction ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Class reactions"
            testID="classroom-reactions-toggle" accessibilityState={{ expanded: reactionPicker }}
            onPress={() => setReactionPicker((open) => !open)}
            style={[styles.iconButton, { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN }]}>
            <Feather name={reactionPicker ? "x" : "smile"} size={21} color={reactionPicker ? colors.primary : colors.inkFaint} />
          </TouchableOpacity> : null}
          <TextInput
            testID="chat-input"
            accessibilityLabel={placeholder}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.inkFaint}
            multiline
            blurOnSubmit={false}
            onKeyPress={(event) => {
              const keyboardEvent = event as unknown as {
                preventDefault?: () => void;
                nativeEvent: { key?: string; shiftKey?: boolean; isComposing?: boolean };
              };
              if (
                Platform.OS === "web" &&
                keyboardEvent.nativeEvent.key === "Enter" &&
                !keyboardEvent.nativeEvent.isComposing &&
                !keyboardEvent.nativeEvent.shiftKey
              ) {
                keyboardEvent.preventDefault?.();
                submit();
              }
            }}
            style={[t.body, styles.input, { color: colors.foreground }]}
          />
          <TouchableOpacity
            testID="chat-send"
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={!value.trim() || !connected}
            onPress={submit}
            activeOpacity={0.8}
            style={[
              styles.send,
              {
                width: HIT_SLOP_MIN,
                height: HIT_SLOP_MIN,
                borderRadius: radius.pill,
                backgroundColor: value.trim() ? colors.primary : "transparent",
              },
            ]}
          >
            <Feather name="arrow-up" size={19} color={value.trim() ? colors.primaryForeground : colors.inkFaint} />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );

  if (!open) return null;

  if (!isCompact && Platform.OS === "web") {
    return (
      <View
        pointerEvents="auto"
        style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 388, maxWidth: "38vw", zIndex: 240 } as object}
      >
        {panel}
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        testID="classroom-chat-scrim"
        accessibilityLabel="Close class messages"
        onPress={onClose}
        style={{ flex: 1, justifyContent: "flex-end", backgroundColor: colors.scrim }}
      >
        <Pressable onPress={() => {}} style={{ height: "82%", minHeight: 360 }}>
          {panel}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = {
  panel: { flex: 1, minHeight: 0, overflow: "hidden", borderWidth: 1 } as const,
  grow: { flex: 1 } as const,
  header: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1 } as const,
  headerIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" } as const,
  iconButton: { alignItems: "center", justifyContent: "center" } as const,
  handleWrap: { alignItems: "center", justifyContent: "center" } as const,
  messageArea: { flex: 1, minHeight: 0 } as const,
  empty: { flex: 1, alignItems: "center", justifyContent: "center" } as const,
  emptyIcon: { width: 52, height: 52, alignItems: "center", justifyContent: "center" } as const,
  messageRow: { alignSelf: "flex-start", maxWidth: "86%" } as const,
  messageRowMe: { alignSelf: "flex-end" } as const,
  senderLine: { flexDirection: "row", alignItems: "center" } as const,
  senderLineMe: { justifyContent: "flex-end" } as const,
  messageBody: { minWidth: 44 } as const,
  newMessages: { position: "absolute", alignSelf: "center", minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "center" } as const,
  composer: { flexDirection: "row", alignItems: "flex-end", borderTopWidth: 1 } as const,
  inputShell: { flex: 1, flexDirection: "row", alignItems: "flex-end", borderWidth: 1 } as const,
  input: { flex: 1, minHeight: HIT_SLOP_MIN, maxHeight: 112, paddingTop: 12, paddingBottom: 10, outlineStyle: "none" } as object,
  send: { alignItems: "center", justifyContent: "center" } as const,
};
