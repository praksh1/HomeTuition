import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/utils/api";
import { notify } from "@/utils/alerts";

/** Finding a person, and the teachers waiting to be let in. */

interface Person {
  id: number; name: string; email: string; role: string;
  suspendedAt: string | null; suspendedReason: string | null;
}

interface PendingTeacher {
  userId: number; name: string; email: string; subject: string; bio: string | null;
}

interface ModerationFlag {
  id: number; userId: number | null; userName: string | null; userRole: string | null;
  surface: string; excerpt: string; matchedTerms: string[]; createdAt: string;
}

export default function AdminPeople() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [pending, setPending] = useState<PendingTeacher[]>([]);
  const [flags, setFlags] = useState<ModerationFlag[]>([]);
  const [loading, setLoading] = useState(true);

  const search = useCallback(async (q: string) => {
    try {
      const res = await apiGet<{ users: Person[] }>(`/admin/users?q=${encodeURIComponent(q)}`);
      setPeople(res.users ?? []);
    } catch {
      setPeople([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPending = useCallback(async () => {
    try {
      const [teachers, moderation] = await Promise.all([
        apiGet<{ teachers: PendingTeacher[] }>("/admin/teachers/pending"),
        apiGet<{ flags: ModerationFlag[] }>("/admin/moderation?status=open"),
      ]);
      setPending(teachers.teachers ?? []);
      setFlags(moderation.flags ?? []);
    } catch {
      setPending([]);
      setFlags([]);
    }
  }, []);

  useEffect(() => { void search(""); void loadPending(); }, [search, loadPending]);

  // Typing settles before asking: a search that fires per keystroke is one request per letter,
  // on a connection this app cannot assume is good.
  useEffect(() => {
    const timer = setTimeout(() => void search(query), 350);
    return () => clearTimeout(timer);
  }, [query, search]);

  const decide = async (userId: number, decision: "approved" | "rejected") => {
    if (decision === "rejected") {
      // A rejection needs a reason the teacher can act on, and this screen has nowhere to type
      // one, so it hands off rather than sending an empty refusal.
      router.push(`/(admin)/person/${userId}`);
      return;
    }
    try {
      await apiPost(`/admin/teachers/${userId}/decision`, { decision });
      await loadPending();
      notify("Approved", "They can schedule classes now, and have been told.");
    } catch (e) {
      notify("Could not save", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const closeFlag = async (id: number, resolution: string) => {
    try {
      await apiPost(`/admin/moderation/${id}/decision`, { resolution });
      await loadPending();
      notify("Case closed", "The moderation decision was recorded.");
    } catch (e) {
      notify("Could not save", e instanceof Error ? e.message : "Please try again.");
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>People</Text>

      {pending.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Teachers waiting to be reviewed ({pending.length})
          </Text>
          {pending.slice(0, 10).map((teacher) => (
            <View key={teacher.userId} style={[styles.row, { borderTopColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: colors.foreground }]}>{teacher.name}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={2}>
                  {teacher.subject}{teacher.bio ? ` · ${teacher.bio}` : ""}
                </Text>
              </View>
              <TouchableOpacity
                testID={`admin-approve-${teacher.userId}`}
                style={[styles.small, { backgroundColor: colors.success }]}
                onPress={() => void decide(teacher.userId, "approved")}
                activeOpacity={0.85}
              >
                <Text style={styles.smallText}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.small, { backgroundColor: colors.muted }]}
                onPress={() => void decide(teacher.userId, "rejected")}
                activeOpacity={0.85}
              >
                <Text style={[styles.smallText, { color: colors.foreground }]}>Review</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {flags.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Text needing review ({flags.length})</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>A word match is a lead for a person to review, not an automatic punishment.</Text>
          {flags.slice(0, 20).map((flag) => (
            <View key={flag.id} style={[styles.flag, { borderTopColor: colors.border }]}>
              <Text style={[styles.name, { color: colors.foreground }]}>{flag.userName ?? "Unknown account"} · {flag.surface.replaceAll("_", " ")}</Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={3}>{flag.excerpt}</Text>
              <Text style={[styles.meta, { color: colors.destructive }]}>Matched: {flag.matchedTerms.join(", ")}</Text>
              <View style={styles.flagActions}>
                {flag.userId !== null && (
                  <TouchableOpacity style={[styles.small, { backgroundColor: colors.muted }]} onPress={() => router.push(`/(admin)/person/${flag.userId}`)}>
                    <Text style={[styles.smallText, { color: colors.foreground }]}>Review person</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.small, { backgroundColor: colors.primary }]} onPress={() => void closeFlag(flag.id, "Reviewed — no action required") }>
                  <Text style={[styles.smallText, { color: colors.primaryForeground }]}>No action</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.small, { backgroundColor: colors.destructive }]} onPress={() => void closeFlag(flag.id, "Reviewed — operator handled the account") }>
                  <Text style={[styles.smallText, { color: colors.destructiveForeground }]}>Handled</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={[styles.searchBar, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        <Feather name="search" size={17} color={colors.mutedForeground} />
        <TextInput
          testID="admin-people-search"
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Search by name or email"
          placeholderTextColor={colors.mutedForeground}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      ) : (
        people.map((person) => (
          <TouchableOpacity
            key={person.id}
            testID={`admin-person-${person.id}`}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push(`/(admin)/person/${person.id}`)}
            activeOpacity={0.8}
          >
            <View style={styles.personHead}>
              <Text style={[styles.name, { color: colors.foreground }]}>{person.name}</Text>
              {person.suspendedAt && (
                <View style={[styles.pill, { backgroundColor: colors.destructive + "15" }]}>
                  <Text style={[styles.pillText, { color: colors.destructive }]}>Suspended</Text>
                </View>
              )}
            </View>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>{person.email} · {person.role}</Text>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 12 },
  title: { fontSize: 24, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 6 },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, paddingTop: 10, marginTop: 6 },
  flag: { gap: 6, borderTopWidth: 1, paddingTop: 10, marginTop: 6 },
  flagActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  personHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  small: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  smallText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  pill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
});
