import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { bottomNavClearance, HIT_SLOP_MIN, marketplaceColumnMax } from "@/constants/layout";
import { useDates } from "@/context/DatePreferenceContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet } from "@/utils/api";
import {
  conversationPreview,
  conversationTimeLabel,
  filterConversations,
  type ConversationFilter,
  type ConversationSummary,
} from "@/utils/conversationList";
import { loadDrafts, type Drafts } from "@/utils/drafts";

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function roleLabel(role: string | null) {
  if (role === "teacher") return "Teacher";
  if (role === "student") return "Student";
  return "Conversation";
}

/** A single modern inbox: conversations stay together, and drafts stay with their person. */
export default function ConversationList({ title }: { title: string }) {
  const colors = useColors();
  const dates = useDates();
  const insets = useSafeAreaInsets();
  const { t, numeric, gutter, space, radius } = useLayout();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await apiGet<ConversationSummary[]>("/conversations");
      setConversations(data);
      setProblem("");
      try {
        setDrafts(await loadDrafts());
      } catch {
        // A device-storage failure should not hide conversations fetched from the server.
      }
    } catch {
      setProblem("Fadko could not load your conversations.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 6000);
    return () => clearInterval(interval);
  }, [load]);

  const visible = useMemo(
    () => filterConversations(conversations, query, filter),
    [conversations, filter, query],
  );
  const unread = conversations.filter((conversation) => conversation.unreadCount > 0).length;
  const draftOnly = Object.keys(drafts).filter(
    (id) => !conversations.some((conversation) => String(conversation.otherUserId) === id),
  );
  const emptyInbox = !loading && !problem && conversations.length === 0 && draftOnly.length === 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        width: "100%",
        maxWidth: marketplaceColumnMax,
        alignSelf: "center",
        paddingHorizontal: gutter,
        paddingTop: insets.top + space.md,
        paddingBottom: insets.bottom + bottomNavClearance,
        gap: space.md,
      }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.primary} />}
    >
      <View style={styles.titleRow}>
        <View style={styles.headingCopy}>
          <Text style={[t.overline, { color: colors.primary }]}>Conversations</Text>
          <Text style={[t.title1, { color: colors.foreground }]}>{title}</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>Class conversations, together in one place.</Text>
        </View>
        <TouchableOpacity
          style={[styles.newButton, { minHeight: HIT_SLOP_MIN, borderRadius: radius.pill, backgroundColor: colors.primary }]}
          onPress={() => router.push("/new-message")}
          activeOpacity={0.82}
          accessibilityRole="button"
          accessibilityLabel="Write a new message"
          testID="new-message-button"
        >
          <Feather name="edit-3" size={16} color={colors.primaryForeground} />
          <Text style={[t.caption, { color: colors.primaryForeground }]}>New</Text>
        </TouchableOpacity>
      </View>

      {!loading && !problem && conversations.length > 0 ? (
        <>
          <View style={[styles.search, { minHeight: HIT_SLOP_MIN, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card }]}>
            <Feather name="search" size={18} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search conversations"
              placeholderTextColor={colors.inkFaint}
              style={[t.body, styles.searchInput, { color: colors.foreground }]}
              autoCorrect={false}
              returnKeyType="search"
              testID="conversation-search"
            />
            {query ? (
              <TouchableOpacity onPress={() => setQuery("")} style={styles.clearButton} accessibilityLabel="Clear search">
                <Feather name="x" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.filters}>
            {(["all", "unread"] as const).map((value) => {
              const selected = filter === value;
              const label = value === "all" ? `All ${conversations.length}` : `Unread ${unread}`;
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => setFilter(value)}
                  style={[
                    styles.filter,
                    { minHeight: HIT_SLOP_MIN, borderRadius: radius.pill, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.actionSoft : colors.card },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  aria-selected={selected}
                  testID={`conversation-filter-${value}`}
                >
                  <Text style={[t.caption, numeric, { color: selected ? colors.primary : colors.mutedForeground }]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      ) : null}

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[t.callout, { color: colors.mutedForeground }]}>Loading conversations…</Text>
        </View>
      ) : null}

      {!loading && problem ? (
        <View style={[styles.stateCard, { borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card }]}>
          <View style={[styles.stateIcon, { borderRadius: radius.pill, backgroundColor: colors.warnSoft }]}>
            <Feather name="wifi-off" size={22} color={colors.warn} />
          </View>
          <Text style={[t.title3, { color: colors.foreground }]}>Messages are unavailable</Text>
          <Text style={[t.callout, styles.center, { color: colors.mutedForeground }]}>{problem} Check your connection and try again.</Text>
          <TouchableOpacity
            onPress={() => { setLoading(true); void load(); }}
            style={[styles.retryButton, { minHeight: HIT_SLOP_MIN, borderRadius: radius.sm, backgroundColor: colors.primary }]}
          >
            <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {emptyInbox ? (
        <View style={[styles.stateCard, { borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card }]}>
          <View style={[styles.stateIcon, { borderRadius: radius.pill, backgroundColor: colors.actionSoft }]}>
            <Feather name="message-circle" size={24} color={colors.primary} />
          </View>
          <Text style={[t.title3, { color: colors.foreground }]}>Your conversations start here</Text>
          <Text style={[t.callout, styles.center, { color: colors.mutedForeground }]}>Write to a teacher or student connected to your classes.</Text>
          <TouchableOpacity
            style={[styles.retryButton, { minHeight: HIT_SLOP_MIN, borderRadius: radius.sm, backgroundColor: colors.primary }]}
            onPress={() => router.push("/new-message")}
            activeOpacity={0.82}
            testID="empty-new-message-button"
          >
            <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Write a message</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!loading && !problem && !emptyInbox && visible.length === 0 ? (
        <View style={[styles.inlineState, { borderRadius: radius.md, backgroundColor: colors.muted }]}>
          <Feather name={filter === "unread" ? "check-circle" : "search"} size={20} color={colors.mutedForeground} />
          <Text style={[t.callout, styles.center, { color: colors.mutedForeground }]}>
            {filter === "unread" && !query ? "You are all caught up." : `No conversation matches “${query.trim()}”.`}
          </Text>
        </View>
      ) : null}

      {!loading && !problem && visible.length > 0 ? (
        <View style={[styles.list, { borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card }]}>
          {visible.map((conversation, index) => {
            const preview = conversationPreview(conversation, drafts[String(conversation.otherUserId)]);
            const time = conversationTimeLabel(conversation.lastMessageAt, Date.now(), (date) => dates.format(date, { style: "short" }));
            const isUnread = conversation.unreadCount > 0;
            return (
              <TouchableOpacity
                key={conversation.otherUserId}
                style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, isUnread && { backgroundColor: colors.actionSoft }]}
                activeOpacity={0.72}
                onPress={() => router.push({ pathname: "/conversation/[id]", params: { id: String(conversation.otherUserId), name: conversation.otherUserName } })}
                accessibilityRole="button"
                accessibilityLabel={`${conversation.otherUserName}, ${preview.label} ${preview.text}${isUnread ? `, ${conversation.unreadCount} unread` : ""}`}
                testID={`conversation-row-${conversation.otherUserId}`}
              >
                <View style={[styles.avatar, { borderRadius: radius.pill, backgroundColor: isUnread ? colors.primary : colors.muted }]}>
                  <Text style={[t.bodyStrong, { color: isUnread ? colors.primaryForeground : colors.primary }]}>{initials(conversation.otherUserName)}</Text>
                </View>
                <View style={styles.rowCopy}>
                  <View style={styles.rowTop}>
                    <Text style={[t.bodyStrong, { color: colors.foreground }]} numberOfLines={1}>{conversation.otherUserName}</Text>
                    <Text style={[t.caption, numeric, { color: isUnread ? colors.primary : colors.inkFaint }]}>{time}</Text>
                  </View>
                  <Text style={[t.caption, { color: colors.inkFaint }]}>{roleLabel(conversation.otherUserRole)}</Text>
                  <Text style={[t.callout, isUnread && t.bodyStrong, { color: isUnread ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>
                    {preview.label ? <Text style={{ color: preview.draft ? colors.destructive : colors.mutedForeground }}>{preview.label} </Text> : null}
                    {preview.text}
                  </Text>
                </View>
                {isUnread ? (
                  <View style={[styles.badge, { borderRadius: radius.pill, backgroundColor: colors.primary }]}>
                    <Text style={[t.overline, numeric, { color: colors.primaryForeground }]}>{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</Text>
                  </View>
                ) : (
                  <Feather name="chevron-right" size={18} color={colors.inkFaint} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {!loading && !problem && filter === "all" && !query && draftOnly.map((id) => (
        <TouchableOpacity
          key={`draft-${id}`}
          style={[styles.orphanDraft, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card }]}
          activeOpacity={0.72}
          onPress={() => router.push({ pathname: "/conversation/[id]", params: { id } })}
          testID={`draft-row-${id}`}
        >
          <View style={[styles.avatar, { borderRadius: radius.pill, backgroundColor: colors.muted }]}>
            <Feather name="edit-3" size={17} color={colors.primary} />
          </View>
          <View style={styles.rowCopy}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>Unsent message</Text>
            <Text style={[t.callout, { color: colors.mutedForeground }]} numberOfLines={1}>
              <Text style={{ color: colors.destructive }}>Draft: </Text>{drafts[id]}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.inkFaint} />
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
  headingCopy: { flex: 1, gap: 2 },
  newButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, paddingHorizontal: 14 },
  searchInput: { flex: 1, paddingVertical: 10 },
  clearButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filter: { alignItems: "center", justifyContent: "center", borderWidth: 1, paddingHorizontal: 16 },
  state: { alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 48 },
  stateCard: { alignItems: "center", borderWidth: 1, gap: 12, padding: 24 },
  stateIcon: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  retryButton: { alignItems: "center", justifyContent: "center", alignSelf: "stretch", paddingHorizontal: 20 },
  center: { textAlign: "center" },
  inlineState: { alignItems: "center", gap: 8, padding: 20 },
  list: { overflow: "hidden", borderWidth: 1 },
  row: { minHeight: 84, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  avatar: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  badge: { minWidth: 26, minHeight: 26, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  orphanDraft: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, padding: 12 },
});
