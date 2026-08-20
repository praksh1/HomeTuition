import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import type { Teacher } from "@/context/AuthContext";
import { apiGet } from "@/utils/api";

/**
 * The students who follow this teacher.
 *
 * This screen used to be six invented students — Aarav Shrestha, twelve sessions attended, a
 * five-star review — hard-coded and shown to every teacher who opened it. It looked like a
 * working feature, which is worse than an empty one: a teacher could believe they had a
 * following they did not have.
 *
 * Following is free and one-directional: a student bookmarks a teacher from Discover. Until
 * now the teacher had no way of knowing it had happened.
 */

interface Follower {
  id: number;
  name: string;
  since: string;
}

export default function TeacherStudents() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const teacher = user as Teacher;
  const [followers, setFollowers] = useState<Follower[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    // The followers route is keyed by the teacher's *profile* id, not their user id — see
    // .agents/memory/teacher-id-convention.md, which exists because this is easy to get wrong.
    if (!teacher?.id) return;
    setLoading(true);
    setLoadError(false);
    try {
      const res = await apiGet<{ followers: Follower[] }>(`/teachers/${teacher.id}/followers`);
      setFollowers(res.followers);
    } catch {
      setLoadError(true);
      setFollowers([]);
    } finally {
      setLoading(false);
    }
  }, [teacher?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const filtered = followers.filter((f) => f.name.toLowerCase().includes(search.trim().toLowerCase()));

  const since = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>My Students</Text>
        <View style={styles.statsRow}>
          <View style={[styles.statPill, { backgroundColor: colors.primary + "12" }]}>
            <Text style={[styles.statNum, { color: colors.primary }]}>{followers.length}</Text>
            <Text style={[styles.statLabel, { color: colors.primary }]}>
              {followers.length === 1 ? "Follower" : "Followers"}
            </Text>
          </View>
        </View>
        {followers.length > 0 && (
          <View style={[styles.searchBar, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="Search students..."
              placeholderTextColor={colors.mutedForeground}
              value={search}
              onChangeText={setSearch}
            />
          </View>
        )}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        scrollEnabled={!!filtered.length}
        renderItem={({ item }) => {
          const initials = item.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
          return (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <View style={[styles.avatar, { backgroundColor: colors.primary + "15" }]}>
                  <Text style={[styles.initials, { color: colors.primary }]}>{initials}</Text>
                </View>
                <View style={styles.studentInfo}>
                  <Text style={[styles.studentName, { color: colors.foreground }]}>{item.name}</Text>
                  <Text style={[styles.studentGrade, { color: colors.mutedForeground }]}>
                    Following since {since(item.since)}
                  </Text>
                </View>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : loadError ? (
            <View style={styles.empty}>
              <Feather name="wifi-off" size={44} color={colors.border} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                Your students could not be loaded
              </Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                This is a connection problem, not an empty list.
              </Text>
              <TouchableOpacity
                style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
                onPress={() => void load()}
                activeOpacity={0.85}
              >
                <Text style={styles.emptyBtnText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : search.trim() ? (
            <View style={styles.empty}>
              <Feather name="search" size={44} color={colors.border} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No match</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No student of yours has that name.
              </Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Feather name="users" size={44} color={colors.border} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No followers yet</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Students who find you on Discover can follow you for free, and they appear here.
                Running classes is what gets you found.
              </Text>
              <TouchableOpacity
                style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
                onPress={() => router.push("/(teacher)/session-create")}
                activeOpacity={0.85}
              >
                <Text style={styles.emptyBtnText}>Create a session</Text>
              </TouchableOpacity>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 14 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  statsRow: { flexDirection: "row", gap: 10 },
  statPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  statNum: { fontSize: 15, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", outlineStyle: "none" } as object,
  list: { paddingHorizontal: 20, gap: 12 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  initials: { fontSize: 16, fontFamily: "Inter_700Bold" },
  studentInfo: { flex: 1, gap: 2 },
  studentName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  studentGrade: { fontSize: 12.5, fontFamily: "Inter_400Regular" },
  empty: { alignItems: "center", gap: 10, paddingTop: 70, paddingHorizontal: 34 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptyText: { fontSize: 13.5, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  emptyBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 12 },
  emptyBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
