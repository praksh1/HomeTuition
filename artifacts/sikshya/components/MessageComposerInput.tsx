import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { clearDraft, clearFailedDraft, getDraft, getFailedDraft, saveDraft, saveFailedDraft } from "@/utils/drafts";
import { shouldSendMessageOnKey } from "@/utils/messageComposer";

/** Keystrokes belong to the composer, not the message timeline or its date/image work. */
export function MessageComposerInput({ draftKey, sending, hasAttachment, onSend, placeholder, inputLabel, sendLabel, inputTestID, sendTestID }: {
  draftKey: string;
  sending: boolean;
  hasAttachment: boolean;
  onSend: (body: string) => Promise<boolean>;
  placeholder: string;
  inputLabel: string;
  sendLabel: string;
  inputTestID: string;
  sendTestID: string;
}) {
  const colors = useColors();
  const { t, radius, space } = useLayout();
  const [draft, setDraft] = useState("");
  const [failedDraft, setFailedDraft] = useState("");
  const failedText = useRef("");
  const latest = useRef("");
  const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const dirty = useRef(false);

  const cancelPendingSave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const flush = () => {
    cancelPendingSave();
    if (!dirty.current) return;
    dirty.current = false;
    void saveDraft(draftKey, latest.current);
  };

  useEffect(() => {
    mounted.current = true;
    const initialRevision = revision.current;
    void getDraft(draftKey).then(saved => {
      // Slow storage must never overwrite words typed while the saved draft is loading.
      if (!mounted.current || revision.current !== initialRevision || !saved) return;
      latest.current = saved;
      setDraft(saved);
    });
    void getFailedDraft(draftKey).then(saved => {
      if (!mounted.current || failedText.current || !saved) return;
      failedText.current = saved;
      setFailedDraft(saved);
    });
    return () => { mounted.current = false; flush(); };
    // Each route keys this component by its conversation, so a new key mounts a new draft.
  }, [draftKey]);

  const updateDraft = (text: string) => {
    latest.current = text;
    revision.current++;
    setDraft(text);
    dirty.current = true;
    cancelPendingSave();
    timer.current = setTimeout(flush, 500);
  };

  const submit = async () => {
    const outgoing = latest.current;
    if (inFlight.current || sending || (!outgoing.trim() && !hasAttachment)) return;
    inFlight.current = true;
    cancelPendingSave();
    dirty.current = false;
    const sentRevision = ++revision.current;
    latest.current = "";
    setDraft("");
    // Persistence is best-effort and must never delay displaying a successfully sent message.
    void clearDraft(draftKey);
    let sent = false;
    try { sent = await onSend(outgoing.trim()); }
    catch { /* The screen reports the send problem; keep the unsent draft here. */ }
    finally {
      inFlight.current = false;
      if (!sent) {
        if (mounted.current && revision.current === sentRevision) updateDraft(outgoing);
        else {
          // Never overwrite the next draft, and never silently drop the failed outgoing one
          // when the person types again or leaves the screen before its request settles.
          const recovery = [failedText.current, outgoing].filter(Boolean).join("\n\n");
          failedText.current = recovery;
          void saveFailedDraft(draftKey, recovery);
          if (mounted.current) setFailedDraft(recovery);
        }
      }
    }
  };

  const hasContent = Boolean(draft.trim()) || hasAttachment;
  const disabled = sending || !hasContent;
  return <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
    {failedDraft ? <View style={{ gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.sm, backgroundColor: colors.warnSoft }} accessibilityLiveRegion="polite" testID={`${inputTestID}-unsent`}>
      <Text style={[t.caption, { color: colors.warn }]} numberOfLines={2}>Unsent message saved: {failedDraft}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Recover unsent message into draft"
        testID={`${inputTestID}-recover`}
        disabled={sending}
        accessibilityState={{ disabled: sending }}
        aria-disabled={sending}
        onPress={() => {
          const merged = [failedText.current, latest.current].filter(Boolean).join("\n\n");
          updateDraft(merged);
          failedText.current = "";
          setFailedDraft("");
          void clearFailedDraft(draftKey);
        }}
        style={{ minHeight: HIT_SLOP_MIN, justifyContent: "center" }}
      ><Text style={[t.bodyStrong, { color: colors.primary }]}>Recover into draft</Text></TouchableOpacity>
    </View> : null}
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
    <TextInput
      value={draft}
      onChangeText={updateDraft}
      onBlur={flush}
      placeholder={placeholder}
      placeholderTextColor={colors.inkFaint}
      style={[t.body, styles.input, { paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: HIT_SLOP_MIN, maxHeight: 112, borderRadius: radius.lg, borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
      multiline
      onKeyPress={event => {
        const native = event.nativeEvent as typeof event.nativeEvent & { shiftKey?: boolean; isComposing?: boolean };
        if (!shouldSendMessageOnKey(Platform.OS, native.key, native.shiftKey, native.isComposing)) return;
        event.preventDefault();
        void submit();
      }}
      accessibilityLabel={inputLabel}
      testID={inputTestID}
    />
    <TouchableOpacity
      style={[styles.action, { minWidth: HIT_SLOP_MIN, minHeight: HIT_SLOP_MIN, borderRadius: radius.pill, backgroundColor: hasContent ? colors.primary : colors.muted }]}
      onPress={() => void submit()}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={sendLabel}
      accessibilityState={{ disabled }}
      aria-disabled={disabled}
      activeOpacity={0.78}
      testID={sendTestID}
    >
      {sending ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="send" size={18} color={hasContent ? colors.primaryForeground : colors.inkFaint} />}
    </TouchableOpacity>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  input: { flex: 1, borderWidth: StyleSheet.hairlineWidth, textAlignVertical: "top" },
  action: { alignItems: "center", justifyContent: "center" },
});
