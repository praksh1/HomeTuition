import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HIT_SLOP_MIN, marketplaceColumnMax } from "@/constants/layout";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet } from "@/utils/api";
import { matches } from "@/utils/search";

interface Recipient {
  userId: number;
  name: string;
  role: string | null;
  note: string;
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

/** Choose a relevant class contact, then go directly into the conversation. */
export default function NewMessageScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t, gutter, space, radius } = useLayout();
  const [people, setPeople] = useState<Recipient[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setPeople(await apiGet<Recipient[]>("/message-recipients"));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const data = await apiGet<Recipient[]>("/message-recipients");
        if (live) setPeople(data);
      } catch {
        if (live) setFailed(true);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, []);

  const shown = useMemo(
    () => (query.trim() ? people.filter((person) => matches(`${person.name} ${person.note}`, query)) : people),
    [people, query],
  );
  const teaching = user?.role === "teacher";
  const audience = teaching ? "students" : "teachers";

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.topBar, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={[styles.topBarInner, { maxWidth: marketplaceColumnMax, paddingHorizontal: gutter }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.back, { minWidth: HIT_SLOP_MIN, minHeight: HIT_SLOP_MIN, borderRadius: radius.pill, borderColor: colors.border, backgroundColor: colors.card }]}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel="Back to messages"
            testID="new-message-back"
          >
            <Feather name="arrow-left" size={20} color={colors.primary} />
          </TouchableOpacity>
          <View style={styles.topCopy}>
            <Text style={[t.overline, { color: colors.primary }]}>Messages</Text>
            <Text style={[t.title2, { color: colors.foreground }]}>New conversation</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          width: "100%",
          maxWidth: marketplaceColumnMax,
          alignSelf: "center",
          paddingHorizontal: gutter,
          paddingTop: space.lg,
          paddingBottom: insets.bottom + space.xxxl,
          gap: space.md,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text style={[t.title1, { color: colors.foreground }]}>Who would you like to message?</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>Choose from {audience} connected to your Fadko classes.</Text>
        </View>

        <View style={[styles.search, { minHeight: HIT_SLOP_MIN, borderRadius: radius.md, borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            style={[t.body, styles.searchInput, { color: colors.foreground }]}
            placeholder={`Search your ${audience}`}
            placeholderTextColor={colors.inkFaint}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            returnKeyType="search"
            testID="recipient-search"
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery("")} style={styles.clear} accessibilityLabel="Clear search">
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[t.callout, { color: colors.mutedForeground }]}>Finding your contacts…</Text>
          </View>
        ) : null}

        {!loading && failed ? (
          <View style={[styles.stateCard, { borderRadius: radius.lg, borderColor: colors.border, backgroundColor: colors.card }]}>
            <View style={[styles.iconWell, { borderRadius: radius.pill, backgroundColor: colors.warnSoft }]}>
              <Feather name="wifi-off" size={22} color={colors.warn} />
            </View>
            <Text style={[t.title3, { color: colors.foreground }]}>Contacts are unavailable</Text>
            <Text style={[t.callout, styles.center, { color: colors.mutedForeground }]}>Check your connection, then try again.</Text>
            <TouchableOpacity
              onPress={() => { setLoading(true); void load(); }}
              style={[styles.retry, { minHeight: HIT_SLOP_MIN, borderRadius: radius.sm, backgroundColor: colors.primary }]}
              testID="recipient-retry"
            >
              <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!loading && !failed && people.length === 0 ? (
          <View style={[styles.stateCard, { borderRadius: radius.lg, borderColor: colors.border, backgroundColor: colors.card }]}>
            <View style={[styles.iconWell, { borderRadius: radius.pill, backgroundColor: colors.actionSoft }]}>
              <Feather name="users" size={23} color={colors.primary} />
            </View>
            <Text style={[t.title3, { color: colors.foreground }]}>No contacts yet</Text>
            <Text style={[t.callout, styles.center, { color: colors.mutedForeground }]}>
              {teaching
                ? "Students appear here after they follow you or join one of your classes."
                : "Teachers appear here after you follow them or join one of their classes."}
            </Text>
          </View>
        ) : null}

        {!loading && !failed && people.length > 0 && shown.length === 0 ? (
          <View style={[styles.smallState, { borderRadius: radius.md, backgroundColor: colors.muted }]}>
            <Feather name="search" size={20} color={colors.mutedForeground} />
            <Text style={[t.callout, styles.center, { color: colors.mutedForeground }]}>Nobody matches “{query.trim()}”.</Text>
          </View>
        ) : null}

        {!loading && !failed && shown.length > 0 ? (
          <View style={[styles.list, { borderRadius: radius.lg, borderColor: colors.border, backgroundColor: colors.card }]}>
            {shown.map((person, index) => (
              <TouchableOpacity
                key={person.userId}
                style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
                activeOpacity={0.72}
                testID={`recipient-${person.userId}`}
                accessibilityRole="button"
                accessibilityLabel={`Message ${person.name}${person.note ? `, ${person.note}` : ""}`}
                onPress={() => router.replace({ pathname: "/conversation/[id]", params: { id: String(person.userId), name: person.name } })}
              >
                <View style={[styles.avatar, { borderRadius: radius.pill, backgroundColor: colors.actionSoft }]}>
                  <Text style={[t.bodyStrong, { color: colors.primary }]}>{initials(person.name)}</Text>
                </View>
                <View style={styles.personCopy}>
                  <Text style={[t.bodyStrong, { color: colors.foreground }]} numberOfLines={1}>{person.name}</Text>
                  {person.note ? <Text style={[t.caption, { color: colors.mutedForeground }]} numberOfLines={1}>{person.note}</Text> : null}
                </View>
                <View style={[styles.messageIcon, { borderRadius: radius.pill, backgroundColor: colors.primary }]}>
                  <Feather name="message-circle" size={17} color={colors.primaryForeground} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { borderBottomWidth: StyleSheet.hairlineWidth },
  topBarInner: { width: "100%", alignSelf: "center", minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12 },
  back: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  topCopy: { flex: 1 },
  scroll: { flex: 1 },
  intro: { gap: 4 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, paddingHorizontal: 14 },
  searchInput: { flex: 1, paddingVertical: 10 },
  clear: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  loading: { alignItems: "center", gap: 12, paddingVertical: 48 },
  stateCard: { alignItems: "center", gap: 12, borderWidth: 1, padding: 24 },
  iconWell: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" },
  retry: { alignSelf: "stretch", alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  smallState: { alignItems: "center", gap: 8, padding: 20 },
  list: { overflow: "hidden", borderWidth: 1 },
  row: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  avatar: { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  personCopy: { flex: 1, minWidth: 0 },
  messageIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
