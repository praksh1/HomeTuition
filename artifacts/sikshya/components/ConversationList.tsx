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
import { useNotifications } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { ApiError, apiGet } from "@/utils/api";
import {
  conversationTimeLabel,
  filterInboxThreads,
  inboxPreview,
  inboxThreadKey,
  inboxThreadTitle,
  inboxThreads,
  type ClassConversationSummary,
  type ConversationFilter,
  type ConversationSummary,
  type InboxThread,
} from "@/utils/conversationList";
import { loadDrafts, type Drafts } from "@/utils/drafts";
import { classConversationDestination } from "@/utils/conversationRoute";

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
  const { lastEvent } = useNotifications();
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    try {
      let data: { direct: ConversationSummary[]; classes: ClassConversationSummary[] };
      try {
        data = await apiGet("/message-inbox");
      } catch (error) {
        // The website can deploy moments before its API during a release. Keep direct messages
        // usable against that older server, but do not disguise any other server failure.
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        data = { direct: await apiGet<ConversationSummary[]>("/conversations"), classes: [] };
      }
      setThreads(inboxThreads(data.direct, data.classes));
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
    // The user socket refreshes immediately below. This slower fallback covers a missed event
    // without making an idle inbox refetch ten times a minute.
    const interval = setInterval(() => void load(), 12000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (lastEvent?.kind === "message" || lastEvent?.kind === "class_message" || lastEvent?.kind === "conversation_sync") void load();
  }, [lastEvent, load]);

  const visible = useMemo(
    () => filterInboxThreads(threads, query, filter),
    [threads, filter, query],
  );
  const unread = threads.filter((thread) => thread.unreadCount > 0).length;
  const classes = threads.filter((thread) => thread.kind === "class").length;
  const direct = threads.filter((thread) => thread.kind === "direct").length;
  const filterOptions = [
    { value: "all" as const, label: "All conversations", count: threads.length, icon: "message-circle" as const },
    { value: "classes" as const, label: "Classes", count: classes, icon: "users" as const },
    { value: "direct" as const, label: "Direct", count: direct, icon: "user" as const },
    { value: "unread" as const, label: "Unread", count: unread, icon: "circle" as const },
  ];
  const activeFilter = filterOptions.find((option) => option.value === filter) ?? filterOptions[0];
  const draftOnly = Object.keys(drafts).filter(
    (id) => !threads.some((thread) => thread.kind === "direct" && String(thread.otherUserId) === id),
  );
  const emptyInbox = !loading && !problem && threads.length === 0 && draftOnly.length === 0;

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
          <Text style={[t.callout, { color: colors.mutedForeground }]}>Direct messages and class discussions, together.</Text>
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

      {!loading && !problem && threads.length > 0 ? (
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
          <View style={[styles.filterShell, { borderRadius: radius.md, borderColor: colors.border, backgroundColor: colors.card }]}>
            <TouchableOpacity
              onPress={() => setFilterOpen((open) => !open)}
              style={[styles.filterTrigger, { minHeight: HIT_SLOP_MIN }]}
              accessibilityRole="button"
              accessibilityLabel={`Filter conversations. ${activeFilter.label}, ${activeFilter.count}`}
              accessibilityState={{ expanded: filterOpen }}
              testID="conversation-filter-trigger"
            >
              <View style={[styles.filterIcon, { borderRadius: radius.sm, backgroundColor: colors.actionSoft }]}>
                <Feather name={activeFilter.icon} size={17} color={colors.primary} />
              </View>
              <View style={styles.filterCopy}>
                <Text style={[t.overline, { color: colors.inkFaint }]}>VIEW</Text>
                <Text style={[t.bodyStrong, numeric, { color: colors.foreground }]}>{activeFilter.label} ({activeFilter.count})</Text>
              </View>
              <Feather name={filterOpen ? "chevron-up" : "chevron-down"} size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
            {filterOpen ? (
              <View style={[styles.filterMenu, { borderTopColor: colors.border }]} testID="conversation-filter-menu">
                {filterOptions.map((option) => {
                  const selected = option.value === filter;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      onPress={() => { setFilter(option.value); setFilterOpen(false); }}
                      style={[styles.filterOption, { minHeight: HIT_SLOP_MIN }, selected && { backgroundColor: colors.actionSoft }]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      aria-selected={selected}
                      testID={`conversation-filter-${option.value}`}
                    >
                      <Feather name={option.icon} size={17} color={selected ? colors.primary : colors.mutedForeground} />
                      <Text style={[t.body, numeric, styles.filterOptionText, { color: selected ? colors.primary : colors.foreground }]}>{option.label} ({option.count})</Text>
                      {selected ? <Feather name="check" size={18} color={colors.primary} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
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
            {filter === "unread" && !query
              ? "You are all caught up."
              : filter === "classes" && !query
                ? "Your enrolled class discussions will appear here."
                : filter === "direct" && !query
                  ? "Your private conversations will appear here."
                : `No conversation matches “${query.trim()}”.`}
          </Text>
        </View>
      ) : null}

      {!loading && !problem && visible.length > 0 ? (
        <View style={[styles.list, { borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card }]}>
          {visible.map((thread, index) => {
            const directDraft = thread.kind === "direct" ? drafts[String(thread.otherUserId)] : undefined;
            const preview = inboxPreview(thread, directDraft);
            const time = thread.lastMessageAt
              ? conversationTimeLabel(thread.lastMessageAt, Date.now(), (date) => dates.format(date, { style: "short" }))
              : "";
            const isUnread = thread.unreadCount > 0;
            const title = inboxThreadTitle(thread);
            return (
              <TouchableOpacity
                key={inboxThreadKey(thread)}
                style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, isUnread && { backgroundColor: colors.actionSoft }]}
                activeOpacity={0.72}
                onPress={() => thread.kind === "direct"
                  ? router.push({ pathname: "/conversation/[id]", params: { id: String(thread.otherUserId), name: thread.otherUserName } })
                  : router.push(classConversationDestination(thread.batchId))}
                accessibilityRole="button"
                accessibilityLabel={`${title}, ${thread.kind === "class" ? "class discussion, " : ""}${preview.label} ${preview.text}${isUnread ? `, ${thread.unreadCount} unread` : ""}`}
                testID={thread.kind === "direct" ? `conversation-row-${thread.otherUserId}` : `class-conversation-row-${thread.batchId}`}
              >
                <View style={[styles.avatar, { borderRadius: radius.pill, backgroundColor: isUnread ? colors.primary : colors.muted }]}>
                  {thread.kind === "class" ? (
                    <Feather name="users" size={20} color={isUnread ? colors.primaryForeground : colors.primary} />
                  ) : (
                    <Text style={[t.bodyStrong, { color: isUnread ? colors.primaryForeground : colors.primary }]}>{initials(thread.otherUserName)}</Text>
                  )}
                </View>
                <View style={styles.rowCopy}>
                  <View style={styles.rowTop}>
                    <Text style={[t.bodyStrong, { color: colors.foreground }]} numberOfLines={1}>{title}</Text>
                    {time ? <Text style={[t.caption, numeric, { color: isUnread ? colors.primary : colors.inkFaint }]}>{time}</Text> : null}
                  </View>
                  <Text style={[t.caption, { color: colors.inkFaint }]}>
                    {thread.kind === "class" ? "Class discussion" : roleLabel(thread.otherUserRole)}
                  </Text>
                  <Text style={[t.callout, isUnread && t.bodyStrong, { color: isUnread ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>
                    {preview.label ? <Text style={{ color: preview.draft ? colors.destructive : colors.mutedForeground }}>{preview.label} </Text> : null}
                    {preview.text}
                  </Text>
                </View>
                {isUnread ? (
                  <View style={[styles.badge, { borderRadius: radius.pill, backgroundColor: colors.primary }]}>
                    <Text style={[t.overline, numeric, { color: colors.primaryForeground }]}>{thread.unreadCount > 99 ? "99+" : thread.unreadCount}</Text>
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
  filterShell: { overflow: "hidden", borderWidth: 1 },
  filterTrigger: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 8 },
  filterIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  filterCopy: { flex: 1, minWidth: 0 },
  filterMenu: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 4 },
  filterOption: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 9 },
  filterOptionText: { flex: 1 },
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
