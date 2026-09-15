import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HIT_SLOP_MIN, marketplaceColumnMax } from "@/constants/layout";
import { useAuth } from "@/context/AuthContext";
import { useDates } from "@/context/DatePreferenceContext";
import { useNotifications } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import {
  filterNotifications,
  nepalDayKey,
  notificationClock,
  notificationDestination,
  notificationGroupLabel,
  notificationPresentation,
  type NotificationFilter,
} from "@/utils/notificationCenter";
import type { AppNotification } from "@/utils/notifications";

type NotificationRow =
  | { kind: "group"; key: string; label: string }
  | { kind: "notification"; key: string; item: AppNotification };

const PAGE_SIZE = 20;

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { format: formatDate, ready: datesReady } = useDates();
  const { t, numeric, space, radius, gutter } = useLayout();
  const { notifications, unreadCount, markRead, markOneRead, refresh } = useNotifications();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

  const load = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    setProblem(null);
    try {
      await refresh();
    } catch {
      setProblem("Notifications could not be refreshed. Check your connection and try again.");
    } finally {
      setReady(true);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, [refresh]);

  const rows = useMemo<NotificationRow[]>(() => {
    if (!datesReady) return [];
    const visible = filterNotifications(notifications, filter).slice(0, visibleLimit);
    const result: NotificationRow[] = [];
    let previousDay = "";
    for (const item of visible) {
      const day = nepalDayKey(item.createdAt);
      if (day !== previousDay) {
        result.push({
          kind: "group",
          key: `group:${day}`,
          label: notificationGroupLabel(day, new Date(), (date) => formatDate(date, { style: "long" })),
        });
        previousDay = day;
      }
      result.push({ kind: "notification", key: `notification:${item.id}`, item });
    }
    return result;
  }, [datesReady, filter, formatDate, notifications, visibleLimit]);

  const filteredTotal = useMemo(
    () => filterNotifications(notifications, filter).length,
    [filter, notifications],
  );

  const openNotification = async (item: AppNotification) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!item.read) await markOneRead(item.id);
    const target = notificationDestination(item.data, user?.role);
    if (target) router.push(target as never);
  };

  const markEverythingRead = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await markRead();
  };

  const renderRow = ({ item: row }: { item: NotificationRow }) => {
    if (row.kind === "group") {
      return (
        <Text
          accessibilityRole="header"
          style={[t.overline, { color: colors.inkFaint, marginTop: space.lg, marginBottom: space.xs }]}
        >
          {row.label}
        </Text>
      );
    }

    const item = row.item;
    const presentation = notificationPresentation(item);
    const tone = presentation.tone === "live"
      ? { ink: colors.brand, wash: colors.brandSoft }
      : presentation.tone === "success"
        ? { ink: colors.success, wash: colors.successSoft }
        : presentation.tone === "warning"
          ? { ink: colors.warn, wash: colors.warnSoft }
          : presentation.tone === "action"
            ? { ink: colors.primary, wash: colors.actionSoft }
            : { ink: colors.mutedForeground, wash: colors.muted };
    const target = notificationDestination(item.data, user?.role);

    return (
      <Pressable
        testID={`notification-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${item.read ? "Read" : "Unread"}: ${item.title}`}
        onPress={() => void openNotification(item)}
        style={({ pressed }) => [
          styles.notification,
          {
            minHeight: HIT_SLOP_MIN,
            padding: space.md,
            marginBottom: space.xs,
            gap: space.sm,
            borderRadius: radius.md,
            borderColor: colors.border,
            backgroundColor: item.read ? colors.card : colors.actionSoft,
            opacity: pressed ? 0.82 : 1,
          },
        ]}
      >
        <View
          style={{
            width: HIT_SLOP_MIN,
            height: HIT_SLOP_MIN,
            borderRadius: radius.sm,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tone.wash,
          }}
        >
          <Feather name={presentation.icon} size={20} color={tone.ink} />
        </View>
        <View style={{ flex: 1, gap: space.xxs }}>
          <View style={styles.metadataRow}>
            <Text style={[t.overline, { flexShrink: 1, color: tone.ink }]}>{presentation.label}</Text>
            <Text style={[t.caption, numeric, { color: colors.inkFaint }]}>
              {notificationClock(item.createdAt)}
            </Text>
          </View>
          <Text style={[t.bodyStrong, { color: colors.foreground }]}>{item.title}</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>{item.body}</Text>
        </View>
        <View style={{ alignItems: "center", gap: space.xs, paddingTop: space.xxs }}>
          {!item.read ? (
            <View
              accessibilityLabel="Unread"
              style={{ width: space.xs, height: space.xs, borderRadius: radius.pill, backgroundColor: colors.primary }}
            />
          ) : null}
          {target ? <Feather name="chevron-right" size={18} color={colors.inkFaint} /> : null}
        </View>
      </Pressable>
    );
  };

  const noVisibleItems = ready && datesReady && rows.length === 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top + space.sm,
            paddingHorizontal: gutter,
            paddingBottom: space.sm,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          testID="notifications-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={{ width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center" }}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[t.title3, { color: colors.foreground }]}>Notifications</Text>
        <Pressable
          testID="notification-settings"
          accessibilityRole="button"
          accessibilityLabel="Notification settings"
          onPress={() => router.push("/notification-settings")}
          style={{ width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center" }}
        >
          <Feather name="sliders" size={21} color={colors.primary} />
        </Pressable>
      </View>

      <FlatList
        data={rows}
        renderItem={renderRow}
        keyExtractor={(row) => row.key}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
        contentContainerStyle={{
          width: "100%",
          maxWidth: marketplaceColumnMax,
          alignSelf: "center",
          paddingHorizontal: gutter,
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.huge,
          flexGrow: 1,
        }}
        ListHeaderComponent={
          <View style={{ gap: space.lg }}>
            <View style={{ gap: space.xs }}>
              <Text style={[t.title1, { color: colors.foreground }]}>What needs your attention</Text>
              <Text style={[t.body, { color: colors.mutedForeground }]}>
                {unreadCount > 0
                  ? `${unreadCount} ${unreadCount === 1 ? "update is" : "updates are"} waiting for you.`
                  : "You are all caught up."}
              </Text>
            </View>

            <View style={[styles.filterBar, { padding: space.xxs, borderRadius: radius.sm, backgroundColor: colors.muted }]}>
              {(["all", "unread"] as const).map((option) => {
                const selected = filter === option;
                return (
                  <Pressable
                    key={option}
                    testID={`notification-filter-${option}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    aria-pressed={selected}
                    onPress={() => {
                      setFilter(option);
                      setVisibleLimit(PAGE_SIZE);
                    }}
                    style={{
                      flex: 1,
                      minHeight: HIT_SLOP_MIN,
                      borderRadius: radius.xs,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: selected ? colors.card : colors.muted,
                    }}
                  >
                    <Text style={[t.bodyStrong, numeric, { color: selected ? colors.primary : colors.mutedForeground }]}>
                      {option === "all" ? `All ${notifications.length}` : `Unread ${unreadCount}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {unreadCount > 0 ? (
              <Pressable
                testID="notification-mark-all-read"
                accessibilityRole="button"
                onPress={() => void markEverythingRead()}
                style={{ minHeight: HIT_SLOP_MIN, alignSelf: "flex-end", justifyContent: "center" }}
              >
                <Text style={[t.bodyStrong, { color: colors.primary }]}>Mark all as read</Text>
              </Pressable>
            ) : null}

            {problem ? (
              <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colors.destructiveSoft }}>
                <Text style={[t.bodyStrong, { color: colors.destructive }]}>Could not refresh</Text>
                <Text style={[t.callout, { color: colors.mutedForeground, marginTop: space.xxs }]}>{problem}</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !ready || !datesReady ? (
            <View style={[styles.empty, { gap: space.md }]}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[t.callout, { color: colors.mutedForeground }]}>Loading your updates…</Text>
            </View>
          ) : noVisibleItems ? (
            <View style={[styles.empty, { gap: space.md }]}>
              <View style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.actionSoft, alignItems: "center", justifyContent: "center" }}>
                <Feather name={filter === "unread" ? "check-circle" : "bell"} size={28} color={colors.primary} />
              </View>
              <Text style={[t.title3, { color: colors.foreground }]}>
                {filter === "unread" ? "Nothing unread" : "No notifications yet"}
              </Text>
              <Text style={[t.body, { color: colors.mutedForeground, textAlign: "center" }]}>
                {filter === "unread"
                  ? "You have read every update."
                  : "Messages, homework, class changes and payment updates will appear here."}
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          rows.length > 0 && visibleLimit < filteredTotal ? (
            <Pressable
              testID="notification-show-older"
              accessibilityRole="button"
              onPress={() => setVisibleLimit((current) => current + PAGE_SIZE)}
              style={{ minHeight: HIT_SLOP_MIN, marginTop: space.md, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={[t.bodyStrong, { color: colors.primary }]}>Show older updates</Text>
            </Pressable>
          ) : null
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterBar: { flexDirection: "row" },
  notification: { flexDirection: "row", alignItems: "flex-start", borderWidth: 1 },
  metadataRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 72, paddingHorizontal: 24 },
});
