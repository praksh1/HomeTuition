import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
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

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/utils/api";
import { matches } from "@/utils/search";

/**
 * Choosing who to write to.
 *
 * Messaging only ever worked in one direction. A student could open a teacher's profile and
 * message them from there; a teacher had nowhere to begin, so their Messages screen listed
 * conversations they could only reply to, under an empty state reading "Messages you send or
 * receive will show up here" — true, and no help at all when there is no way to send one.
 *
 * The list is whoever the server says this person could sensibly write to: for a teacher, the
 * students who follow them and the students in their classes; for a student, the teachers they
 * follow and the ones they are learning from. It is a starting point rather than a restriction
 * — a conversation already under way is reached from the Messages list as before.
 */

interface Recipient {
  userId: number;
  name: string;
  role: string | null;
  note: string;
}

export default function NewMessageScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [people, setPeople] = useState<Recipient[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

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
    return () => {
      live = false;
    };
  }, []);

  // The same matching the rest of the app searches names with, so "ram pra sad" finds
  // Ram Prasad here exactly as it does everywhere else. See utils/search.ts.
  const shown = useMemo(
    () => (query.trim() ? people.filter((p) => matches(p.name, query)) : people),
    [people, query],
  );

  const initials = (name: string) =>
    name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  const teaching = user?.role === "teacher";

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} activeOpacity={0.7}>
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>New message</Text>
      </View>

      <View style={[styles.searchBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        <Feather name="search" size={15} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder={teaching ? "Search your students" : "Search your teachers"}
          placeholderTextColor={colors.mutedForeground}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          testID="recipient-search"
        />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {loading && <ActivityIndicator style={styles.spinner} color={colors.primary} />}

        {!loading && failed && (
          <View style={[styles.empty, { backgroundColor: colors.muted }]}>
            <Feather name="wifi-off" size={24} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Could not load your contacts. Check your connection and try again.
            </Text>
          </View>
        )}

        {/*
          Two different emptinesses, said differently. Nobody to write to is a fact about the
          account and worth explaining; nobody matching a search is a fact about the search.
        */}
        {!loading && !failed && people.length === 0 && (
          <View style={[styles.empty, { backgroundColor: colors.muted }]}>
            <Feather name="users" size={24} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {teaching
                ? "No students yet. Once someone follows you or books one of your classes, you can message them here."
                : "No teachers yet. Follow a teacher or book a class, and you can message them here."}
            </Text>
          </View>
        )}

        {!loading && !failed && people.length > 0 && shown.length === 0 && (
          <View style={[styles.empty, { backgroundColor: colors.muted }]}>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Nobody matching “{query.trim()}”.
            </Text>
          </View>
        )}

        {shown.map((p) => (
          <TouchableOpacity
            key={p.userId}
            style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
            activeOpacity={0.7}
            testID={`recipient-${p.userId}`}
            onPress={() =>
              // Replace rather than push: coming back from the conversation should land on
              // Messages, not on the picker they have just finished with.
              router.replace({
                pathname: "/conversation/[id]",
                params: { id: String(p.userId), name: p.name },
              })
            }
          >
            <View style={[styles.avatar, { backgroundColor: colors.primary + "18" }]}>
              <Text style={[styles.avatarText, { color: colors.primary }]}>{initials(p.name)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                {p.name}
              </Text>
              {p.note ? (
                <Text style={[styles.note, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {p.note}
                </Text>
              ) : null}
            </View>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { padding: 6 },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginTop: 14, marginBottom: 6, paddingHorizontal: 12, height: 42, borderRadius: 12, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 0 },
  spinner: { marginTop: 32 },
  empty: { borderRadius: 16, padding: 24, alignItems: "center", gap: 10, margin: 16 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginTop: 10, padding: 12, borderRadius: 14, borderWidth: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  note: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
