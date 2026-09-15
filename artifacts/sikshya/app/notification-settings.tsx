import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useNotifications } from "@/context/NotificationContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { PREF_LABELS, visiblePreferenceOrder, type PrefChannel, type PrefKind } from "@/utils/notificationPrefs";
import DateSystemSetting from "@/components/DateSystemSetting";
import { HIT_SLOP_MIN, readingWidth, space as layoutSpace } from "@/constants/layout";
import { useLayout } from "@/hooks/useLayout";

export default function NotificationSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, space, radius, gutter } = useLayout();
  const { user } = useAuth();
  const { preferences, emailAvailable, hasPermission, setPreference } = useNotifications();
  const order = visiblePreferenceOrder(user?.role);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (channel: PrefChannel, kind: PrefKind, value: boolean) => {
    setError(null);
    setSaving(`${channel}:${kind}`);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await setPreference(channel, kind, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setSaving(null);
    }
  };

  const renderRow = (channel: PrefChannel, kind: PrefKind, disabled: boolean) => {
    const label = PREF_LABELS[kind];
    const busy = saving === `${channel}:${kind}`;
    return (
      <View key={`${channel}:${kind}`} style={[styles.row, { padding: space.md, borderBottomColor: colors.border }]}>
        <View style={[styles.rowText, { paddingRight: space.sm }]}>
          <Text style={[t.bodyStrong, { color: disabled ? colors.mutedForeground : colors.foreground }]}>
            {label.title}
          </Text>
          <Text style={[t.caption, { color: colors.mutedForeground, marginTop: space.xxs }]}>{label.help}</Text>
        </View>
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} style={styles.rowControl} />
        ) : (
          <Switch
            value={preferences[channel][kind]}
            disabled={disabled}
            onValueChange={(value) => void toggle(channel, kind, value)}
            trackColor={{ false: colors.input, true: colors.primary }}
            thumbColor={colors.card}
            style={styles.rowControl}
          />
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: space.sm, borderBottomColor: colors.border }]}>
        <TouchableOpacity testID="notification-settings-back" accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[t.title3, { color: colors.foreground }]}>Notifications & dates</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingHorizontal: gutter, paddingTop: space.xl, paddingBottom: insets.bottom + space.huge }]}
        showsVerticalScrollIndicator={false}
      >
        {/*
          The calendar sits with the notification switches rather than in a screen of its own.

          Both are "how this app behaves for me", both are reached from Profile, and a settings
          screen with one item on it is a screen nobody finds.
        */}
        <DateSystemSetting />
        <View style={{ height: space.xl }} />

        {error && (
          <View style={[styles.notice, { gap: space.xs, padding: space.sm, marginBottom: space.md, borderRadius: radius.sm, backgroundColor: colors.destructiveSoft, borderColor: colors.destructive }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[t.callout, styles.noticeText, { color: colors.destructive }]}>{error}</Text>
          </View>
        )}

        {/* Device permission is separate from these switches: turning one on here cannot
            grant a permission the operating system has refused, so say so rather than
            leaving a switch that appears on and does nothing. */}
        {Platform.OS !== "web" && !hasPermission && (
          <View style={[styles.notice, { gap: space.xs, padding: space.sm, marginBottom: space.md, borderRadius: radius.sm, backgroundColor: colors.warnSoft, borderColor: colors.warn }]}>
            <Feather name="bell-off" size={16} color={colors.warn} />
            <Text style={[t.callout, styles.noticeText, { color: colors.foreground }]}>
              Your phone is blocking notifications for Fadko. Turn them on in your phone&apos;s
              Settings to get alerts when the app is closed. In-app alerts still work.
            </Text>
          </View>
        )}

        <Text style={[t.title3, { color: colors.foreground, marginTop: space.sm }]}>In the app</Text>
        <Text style={[t.callout, { color: colors.mutedForeground, marginTop: space.xxs, marginBottom: space.xs }]}>
          Alerts on your phone and in your notification list.
        </Text>
        <View style={[styles.card, { borderRadius: radius.md, backgroundColor: colors.card, borderColor: colors.border }]}>
          {order.map((kind) => renderRow("push", kind, false))}
        </View>

        <Text style={[t.title3, { color: colors.foreground, marginTop: space.xl }]}>By email</Text>
        <Text style={[t.callout, { color: colors.mutedForeground, marginTop: space.xxs, marginBottom: space.xs }]}>
          {emailAvailable
            ? "For the things worth knowing about when the app is closed."
            : "Email is not switched on for this server yet, so these cannot be sent."}
        </Text>
        <View
          style={[
            styles.card,
            { borderRadius: radius.md, backgroundColor: colors.card, borderColor: colors.border, opacity: emailAvailable ? 1 : 0.55 },
          ]}
        >
          {order.map((kind) => renderRow("email", kind, !emailAvailable))}
        </View>

        <Text style={[t.caption, { color: colors.mutedForeground, marginTop: space.lg, textAlign: "center" }]}>
          These settings apply to every device you sign in on.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center" },
  scroll: { width: "100%", maxWidth: readingWidth, alignSelf: "center" },
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
  rowControl: { width: HIT_SLOP_MIN + layoutSpace.xs, alignItems: "flex-end" },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeText: { flex: 1 },
});
