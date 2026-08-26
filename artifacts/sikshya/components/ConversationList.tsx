import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/utils/api";
import { loadDrafts, type Drafts } from "@/utils/drafts";

interface Conversation {
  otherUserId: number;
  otherUserName: string;
  otherUserRole: string | null;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  lastMessageFromMe: boolean;
}

/**
 * One list, newest first — no Inbox, Sent or Drafts.
 *
 * The owner asked for Messages to work the way the apps their users already have work. Those
 * apps have no folders, and the reason is not fashion: folders are a filing metaphor from
 * email, and a conversation is not filed. It is one thread with two people in it, and
 * splitting it by who happened to speak last means the same conversation moves between tabs as
 * it goes on — you reply, and it leaves your Inbox.
 *
 * Drafts do not need a folder either. An unsent line belongs to the conversation it was typed
 * in, shown against it, where it will be finished.
 */

export default function ConversationList({ title }: { title: string }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<Conversation[]>("/conversations");
      // Announcing a new message used to happen here, by diffing one poll against the last.
      // That meant it only worked while this screen was open — which is what "notifications
      // are not real time" meant in practice. The server now pushes it down the user channel
      // (see hooks/useUserChannel), so doing it here as well would announce it twice.
      setConversations(data);
      setDrafts(await loadDrafts());
    } catch (_e) {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 6000);
    return () => clearInterval(interval);
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  /**
   * Everything, newest first.
   *
   * The server already returns them in order; sorting again here is cheap insurance against
   * that changing, and against a draft written just now sitting below a conversation from a
   * fortnight ago.
   */
  const visible = [...conversations].sort(
    (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
  );

  /** A conversation that exists only as an unsent line still belongs in the list. */
  const draftOnly = Object.keys(drafts).filter(
    (id) => !conversations.some((c) => String(c.otherUserId) === id),
  );

  const initials = (name: string) =>
    name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        {/*
          The way in. There was none: this screen listed conversations and offered no way to
          begin one, so a teacher could only ever reply to a student who had written first.
        */}
        <TouchableOpacity
          style={[styles.newBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.push("/new-message")}
          activeOpacity={0.85}
          testID="new-message-button"
        >
          <Feather name="edit-2" size={13} color="#fff" />
          <Text style={styles.newBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      {!loading && visible.length === 0 && draftOnly.length === 0 && (
        <View style={[styles.empty, { backgroundColor: colors.muted }]}>
          <Feather name="message-circle" size={26} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No conversations yet.
          </Text>
          {/* An empty state that only describes the emptiness is no help. */}
          <TouchableOpacity
            style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
            onPress={() => router.push("/new-message")}
            activeOpacity={0.85}
            testID="empty-new-message-button"
          >
            <Feather name="edit-2" size={13} color="#fff" />
            <Text style={styles.newBtnText}>Write to someone</Text>
          </TouchableOpacity>
        </View>
      )}

      {visible.map((c) => (
        <TouchableOpacity
          key={c.otherUserId}
          style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
          activeOpacity={0.7}
          onPress={() =>
            router.push({
              pathname: "/conversation/[id]",
              params: { id: String(c.otherUserId), name: c.otherUserName },
            })
          }
          testID={`conversation-row-${c.otherUserId}`}
        >
          <View style={[styles.avatar, { backgroundColor: colors.primary + "18" }]}>
            <Text style={[styles.avatarText, { color: colors.primary }]}>{initials(c.otherUserName)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.rowTop}>
              <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                {c.otherUserName}
              </Text>
              <Text style={[styles.time, { color: colors.mutedForeground }]}>
                {new Date(c.lastMessageAt).toLocaleDateString("en-NP", { month: "short", day: "numeric" })}
              </Text>
            </View>
            {/*
              An unsent line takes the preview's place.

              It is the thing that person needs to see about that conversation — they were
              part-way through saying something. Marked, so it is not mistaken for a message
              that went.
            */}
            {drafts[String(c.otherUserId)] ? (
              <Text style={[styles.preview, { color: colors.mutedForeground }]} numberOfLines={1}>
                <Text style={{ color: colors.destructive }}>Draft: </Text>
                {drafts[String(c.otherUserId)]}
              </Text>
            ) : (
              <Text
                style={[
                  styles.preview,
                  { color: colors.mutedForeground },
                  // An unread conversation reads differently at a glance, not only by its badge.
                  c.unreadCount > 0 && { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
                ]}
                numberOfLines={1}
              >
                {c.lastMessage}
              </Text>
            )}
          </View>
          {c.unreadCount > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={styles.badgeText}>{c.unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      ))}

      {/*
        Somebody typed to a person they have never sent to. Without this the line is kept and
        invisible — nothing in the list says it exists, and it surfaces only if they happen to
        open that conversation again.
      */}
      {draftOnly.map((id) => (
        <TouchableOpacity
          key={`draft-${id}`}
          style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
          activeOpacity={0.7}
          onPress={() => router.push({ pathname: "/conversation/[id]", params: { id } })}
          testID={`draft-row-${id}`}
        >
          <View style={[styles.avatar, { backgroundColor: colors.muted }]}>
            <Feather name="edit-2" size={14} color={colors.mutedForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>Unsent message</Text>
            <Text style={[styles.preview, { color: colors.mutedForeground }]} numberOfLines={1}>
              <Text style={{ color: colors.destructive }}>Draft: </Text>{drafts[id]}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  newBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  newBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, marginTop: 4 },
  empty: { borderRadius: 16, padding: 24, alignItems: "center", gap: 10, marginTop: 20 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, padding: 14 },
  avatar: { width: 46, height: 46, borderRadius: 23, justifyContent: "center", alignItems: "center" },
  avatarText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1, marginRight: 8 },
  time: { fontSize: 11, fontFamily: "Inter_400Regular" },
  preview: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, justifyContent: "center", alignItems: "center", paddingHorizontal: 6 },
  badgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
});
