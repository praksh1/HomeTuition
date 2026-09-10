import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useNotifications } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";
import type { AppNotification } from "@/utils/notifications";

const TYPE_CONFIG: Record<
  AppNotification["type"],
  { icon: string; bg: string; color: string; label: string }
> = {
  session_reminder: { icon: "clock", bg: "#3B82F615", color: "#3B82F6", label: "Reminder" },
  payment: { icon: "credit-card", bg: "#22C55E15", color: "#22C55E", label: "Payment" },
  credential: { icon: "shield", bg: "#F5A62315", color: "#F5A623", label: "Verification" },
  live: { icon: "radio", bg: "#EF444415", color: "#EF4444", label: "Live" },
  general: { icon: "bell", bg: "#6B728015", color: "#6B7280", label: "Update" },
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { notifications, unreadCount, markRead, refresh } = useNotifications();

  useEffect(() => {
    refresh();
  }, []);

  const todayNotifs = notifications.filter((n) => isToday(n.createdAt));
  const earlierNotifs = notifications.filter((n) => !isToday(n.createdAt));

  const handleMarkRead = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await markRead();
  };

  const handleNotifPress = async (item: AppNotification) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await markRead();
    const role = user?.role;
    const home = role === "teacher" ? "/(teacher)" : role === "student" ? "/(student)" : "/welcome";
    const programId = item.data?.programId;
    if (role === "student" && item.data?.type === "program_published" && (typeof programId === "string" || typeof programId === "number")) {
      router.push(`/(student)/program/${programId}`);
    } else if (item.type === "session_reminder" || item.type === "live") {
      if (role === "teacher") router.replace("/(teacher)/sessions");
      else if (role === "student") router.replace("/(student)/sessions");
      else router.replace(home);
    } else if (item.type === "payment" && role === "teacher") {
      router.push({ pathname: "/(teacher)/subscription", params: { from: "notif" } });
    } else {
      router.replace(home);
    }
  };

  const renderItem = ({ item }: { item: AppNotification }) => {
    const config = TYPE_CONFIG[item.type];
    return (
      <TouchableOpacity
        style={[
          styles.card,
          {
            backgroundColor: item.read ? colors.card : colors.primary + "06",
            borderColor: item.read ? colors.border : colors.primary + "20",
          },
        ]}
        activeOpacity={0.7}
        onPress={() => handleNotifPress(item)}
      >
        <View style={[styles.iconWrap, { backgroundColor: config.bg }]}>
          <Feather name={config.icon as "clock"} size={18} color={config.color} />
        </View>
        <View style={styles.content}>
          <View style={styles.contentTop}>
            <View style={[styles.typeBadge, { backgroundColor: config.bg }]}>
              <Text style={[styles.typeLabel, { color: config.color }]}>{config.label}</Text>
            </View>
            <Text style={[styles.time, { color: colors.mutedForeground }]}>
              {timeAgo(item.createdAt)}
            </Text>
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>{item.title}</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]} numberOfLines={2}>
            {item.body}
          </Text>
        </View>
        {!item.read && (
          <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        {unreadCount > 0 ? (
          <TouchableOpacity onPress={handleMarkRead} style={styles.markReadBtn} activeOpacity={0.7}>
            <Text style={[styles.markReadText, { color: colors.primary }]}>Mark all read</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 80 }} />
        )}
      </View>

      <FlatList
        data={[]}
        renderItem={null}
        keyExtractor={() => ""}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
        ListHeaderComponent={
          <View>
            {notifications.length === 0 && (
              <View style={styles.empty}>
                <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
                  <Feather name="bell-off" size={32} color={colors.mutedForeground} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  No notifications yet
                </Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Session reminders, payment alerts, and updates will appear here
                </Text>
              </View>
            )}

            {todayNotifs.length > 0 && (
              <View style={styles.group}>
                <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Today</Text>
                {todayNotifs.map((item) => (
                  <View key={item.id}>{renderItem({ item })}</View>
                ))}
              </View>
            )}

            {earlierNotifs.length > 0 && (
              <View style={styles.group}>
                <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Earlier</Text>
                {earlierNotifs.map((item) => (
                  <View key={item.id}>{renderItem({ item })}</View>
                ))}
              </View>
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  backBtn: { width: 36, height: 36, justifyContent: "center" },
  headerCenter: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  unreadBadge: {
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: "center",
  },
  unreadBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  markReadBtn: { paddingVertical: 4 },
  markReadText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  list: { paddingTop: 16, paddingHorizontal: 20 },
  group: { gap: 10, marginBottom: 24 },
  groupLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    position: "relative",
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  content: { flex: 1, gap: 4 },
  contentTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  typeBadge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  typeLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  time: { fontSize: 11, fontFamily: "Inter_400Regular" },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  body: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    position: "absolute",
    top: 14,
    right: 14,
  },
  empty: { alignItems: "center", paddingTop: 80, gap: 16, paddingHorizontal: 40 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 21,
  },
});
