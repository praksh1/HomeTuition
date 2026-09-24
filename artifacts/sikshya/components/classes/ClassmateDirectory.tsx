import React, { useContext, useEffect, useRef, useState } from "react";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useVisibleViewport } from "@/hooks/useVisibleViewport";
import { apiGet, apiPost } from "@/utils/api";
import { shouldSendMessageOnKey } from "@/utils/messageComposer";

type Person = { userId: number; name: string };
type Access = { canSend: boolean; blockedByYou: boolean; reason: string | null };

/** Names only, from the authenticated classroom socket. Messaging is checked again by the API.
 * Compose in place: opening a classmate must never unmount the live classroom or its call. */
export function ClassmateDirectory({ open, onClose, classmates, userId }: {
  open: boolean; onClose: () => void; classmates: Person[]; userId: number;
}) {
  const colors = useColors();
  const { t, numeric, space, radius, isCompact } = useLayout();
  const viewport = useVisibleViewport(open);
  const safeArea = useContext(SafeAreaInsetsContext);
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    setAccess(null); setNotice(null); setDraft("");
    if (!open || !person) return;
    void apiGet<Access>(`/messages/${person.userId}/access`).then(value => {
      if (version === generation.current) setAccess(value);
    }).catch(() => { if (version === generation.current) setNotice("Cannot check messaging right now. Close and try again."); });
    return () => { generation.current++; };
  }, [open, person]);
  useEffect(() => { if (!open) { setPerson(null); setQuery(""); } }, [open]);
  const send = async () => {
    if (!person || !access?.canSend || busy || !draft.trim()) return;
    const version = generation.current;
    setBusy(true); setNotice(null);
    try {
      await apiPost(`/messages/${person.userId}`, { body: draft.trim() });
      if (version === generation.current) { setDraft(""); setNotice("Sent privately. Find this conversation and replies in Messages."); }
    } catch (error) {
      if (version === generation.current) setNotice(error instanceof Error ? error.message : "Message did not send. Try again.");
    } finally { setBusy(false); }
  };
  const toggleBlock = async () => {
    if (!person || !access || busy) return;
    const version = generation.current;
    setBusy(true);
    try {
      const next = await apiPost<Access>(`/messages/${person.userId}/block`, { blocked: !access.blockedByYou });
      if (version === generation.current) { setAccess(next); setNotice(next.blockedByYou ? "Blocked. Neither of you can send new private messages to the other. Existing messages are kept." : "Unblocked."); }
    } catch { if (version === generation.current) setNotice("Could not change blocking. Please try again."); }
    finally { setBusy(false); }
  };
  if (!open) return null;
  const panel = <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.card, padding: space.md, gap: space.sm }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      {person ? <Pressable accessibilityRole="button" accessibilityLabel="Back to classmates" onPress={() => setPerson(null)} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}><Feather name="arrow-left" size={20} color={colors.primary} /></Pressable> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[t.title3, { color: colors.foreground }]} numberOfLines={1}>{person ? person.name : "Classmates here"}</Text>
        <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>{person ? "Private message · your call stays connected" : `${classmates.length} students · includes you, not the teacher`}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Close classmates" onPress={onClose} style={{ minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" }}><Feather name="x" size={20} color={colors.foreground} /></Pressable>
    </View>
    {person ? <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ gap: space.sm, paddingBottom: space.xl }}>
      {!access && !notice ? <ActivityIndicator color={colors.primary} /> : null}
      {access?.reason ? <Text style={[t.callout, { color: colors.mutedForeground }]}>{access.reason}</Text> : null}
      <TextInput accessibilityLabel="Private message to classmate" value={draft} onChangeText={setDraft} multiline maxLength={5000}
        editable={Boolean(access?.canSend) && !busy} placeholder="Keep it kind and class-related…" placeholderTextColor={colors.inkFaint}
        onKeyPress={event => { const key = event.nativeEvent as { key: string; shiftKey?: boolean; isComposing?: boolean }; if (shouldSendMessageOnKey(Platform.OS, key.key, key.shiftKey, key.isComposing)) { event.preventDefault(); void send(); } }}
        style={[t.body, { color: colors.foreground, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.sm, minHeight: 96, maxHeight: 160, textAlignVertical: "top" }]} />
      <Pressable accessibilityRole="button" accessibilityLabel="Send private message" disabled={!access?.canSend || busy || !draft.trim()} aria-disabled={!access?.canSend || busy || !draft.trim()} onPress={() => void send()}
        style={{ minHeight: 44, justifyContent: "center", alignItems: "center", borderRadius: radius.pill, backgroundColor: colors.primary, opacity: !access?.canSend || busy || !draft.trim() ? 0.5 : 1 }}>
        <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>{busy ? "Please wait…" : "Send privately"}</Text>
      </Pressable>
      {notice ? <Text accessibilityLiveRegion="polite" style={[t.callout, { color: colors.mutedForeground }]}>{notice}</Text> : null}
      {access ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void toggleBlock()} style={{ minHeight: 44, justifyContent: "center" }}><Text style={[t.callout, { color: colors.destructive }]}>{access.blockedByYou ? "Unblock this person" : "Block private messages from this person"}</Text></Pressable> : null}
      <Text style={[t.caption, { color: colors.mutedForeground }]}>To report a conversation, open it in Messages and choose Safety & help. Your messages are kept for review.</Text>
    </ScrollView> : <>
      <TextInput accessibilityLabel="Search classmates" placeholder="Search classmates" placeholderTextColor={colors.inkFaint} value={query} onChangeText={setQuery}
        style={[t.body, { color: colors.foreground, minHeight: 44, backgroundColor: colors.surfaceSunk, padding: space.sm, borderRadius: radius.md }]} />
      <FlatList style={{ flex: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled" data={classmates.filter(p => p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))} keyExtractor={p => String(p.userId)}
        ListEmptyComponent={<Text style={[t.callout, { color: colors.mutedForeground }]}>No classmates match this view.</Text>}
        renderItem={({ item }) => <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={[t.body, { flex: 1, minWidth: 0, color: colors.foreground }]} numberOfLines={2}>{item.name}{item.userId === userId ? " (you)" : ""}</Text>
          {item.userId !== userId ? <Pressable accessibilityRole="button" accessibilityLabel={`Message ${item.name} privately`} onPress={() => setPerson(item)} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.actionSoft }}><Feather name="message-circle" size={20} color={colors.primary} /></Pressable> : null}
        </View>} />
    </>}
  </View>;
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <View style={[{ flex: 1, backgroundColor: colors.scrim, alignItems: "flex-end", justifyContent: "flex-end" }, Platform.OS === "web" ? { position: "absolute", top: viewport.top, height: viewport.height, left: 0, right: 0, paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" } as object : { paddingTop: safeArea?.top ?? space.xl, paddingBottom: safeArea?.bottom ?? space.md }]}>
        <Pressable accessibilityLabel="Close classmates" onPress={onClose} style={{ position: "absolute", inset: 0 } as object} />
        <View testID="classmate-directory" style={{ height: "100%", width: isCompact ? "100%" : 400, maxWidth: "100%", overflow: "hidden", borderTopLeftRadius: radius.lg, borderTopRightRadius: isCompact ? radius.lg : 0 }}>{panel}</View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
