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
import { useColors } from "@/hooks/useColors";
import { PREF_LABELS, PREF_ORDER, type PrefChannel, type PrefKind } from "@/utils/notificationPrefs";

/** Every switch, in a deliberate order. See utils/notificationPrefs.ts for why it lives there. */
const ORDER: PrefKind[] = PREF_ORDER;

export default function NotificationSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { preferences, emailAvailable, hasPermission, setPreference } = useNotifications();
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
      <View key={`${channel}:${kind}`} style={[styles.row, { borderBottomColor: colors.border }]}>
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: disabled ? colors.mutedForeground : colors.foreground }]}>
            {label.title}
          </Text>
          <Text style={[styles.rowHelp, { color: colors.mutedForeground }]}>{label.help}</Text>
        </View>
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} style={styles.rowControl} />
        ) : (
          <Switch
            value={preferences[channel][kind]}
            disabled={disabled}
            onValueChange={(value) => void toggle(channel, kind, value)}
            trackColor={{ false: colors.input, true: colors.primary + "80" }}
            thumbColor={preferences[channel][kind] ? colors.primary : "#FFFFFF"}
            style={styles.rowControl}
          />
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Notifications</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {error && (
          <View style={[styles.notice, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "30" }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[styles.noticeText, { color: colors.destructive }]}>{error}</Text>
          </View>
        )}

        {/* Device permission is separate from these switches: turning one on here cannot
            grant a permission the operating system has refused, so say so rather than
            leaving a switch that appears on and does nothing. */}
        {Platform.OS !== "web" && !hasPermission && (
          <View style={[styles.notice, { backgroundColor: colors.accent + "12", borderColor: colors.accent + "30" }]}>
            <Feather name="bell-off" size={16} color={colors.accent} />
            <Text style={[styles.noticeText, { color: colors.foreground }]}>
              Your phone is blocking notifications for Sikshya. Turn them on in your phone&apos;s
              Settings to get alerts when the app is closed. In-app alerts still work.
            </Text>
          </View>
        )}

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>In the app</Text>
        <Text style={[styles.sectionHelp, { color: colors.mutedForeground }]}>
          Alerts on your phone and in your notification list.
        </Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {ORDER.map((kind) => renderRow("push", kind, false))}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>By email</Text>
        <Text style={[styles.sectionHelp, { color: colors.mutedForeground }]}>
          {emailAvailable
            ? "For the things worth knowing about when the app is closed."
            : "Email is not switched on for this server yet, so these cannot be sent."}
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: emailAvailable ? 1 : 0.55 },
          ]}
        >
          {ORDER.map((kind) => renderRow("email", kind, !emailAvailable))}
        </View>

        <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
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
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  scroll: { padding: 16 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginTop: 12 },
  sectionHelp: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4, marginBottom: 10, lineHeight: 18 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, paddingRight: 12 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_500Medium" },
  rowHelp: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },
  rowControl: { width: 52, alignItems: "flex-end" },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
  },
  noticeText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  footnote: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 18, textAlign: "center" },
});
