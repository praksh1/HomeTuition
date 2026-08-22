import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/utils/api";
import { useAuth } from "@/context/AuthContext";

/**
 * The teachers a student has chosen to follow.
 *
 * This lived at the bottom of Profile, which is not where anybody looks for a teacher. The
 * owner asked for it to move into Discover — "Move 'Teachers You Follow' into the 'Discover'
 * tab. Create a secondary sub-tab/window within Discover to house this" — and that is the
 * right home: finding a teacher and returning to one you already like are the same errand.
 *
 * A component rather than a copied block, because the list is not trivial — it fetches,
 * distinguishes empty from failed, and has somewhere to send a student who follows nobody yet.
 */

interface FollowedTeacher {
  id: number;
  name: string;
  subject?: string | null;
}

export default function FollowedTeachers() {
  const colors = useColors();
  const { user } = useAuth();
  const studentId = (user as { userId?: number } | null)?.userId;
  const [teachers, setTeachers] = useState<FollowedTeacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setFailed(false);
    try {
      const res = await apiGet<{ teachers: FollowedTeacher[] }>(
        `/students/${studentId}/followed-teachers`,
      );
      setTeachers(res.teachers ?? []);
    } catch {
      // An empty list and a failed request look identical otherwise, and "you follow nobody"
      // is the wrong thing to tell somebody who follows six people on a bad connection.
      setFailed(true);
      setTeachers([]);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={styles.loading} />;
  }

  if (failed) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.muted }]}>
        <Feather name="wifi-off" size={22} color={colors.mutedForeground} />
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          We could not load the teachers you follow.
        </Text>
        <TouchableOpacity
          style={[styles.action, { backgroundColor: colors.primary }]}
          onPress={() => void load()}
          activeOpacity={0.85}
        >
          <Text style={styles.actionText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (teachers.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.muted }]}>
        <Feather name="user-plus" size={22} color={colors.mutedForeground} />
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          You are not following anyone yet. Follow a teacher and their new classes will be easy
          to find here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.list} testID="followed-teachers">
      {teachers.map((teacher) => (
        <TouchableOpacity
          key={teacher.id}
          style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push(`/(student)/teacher/${teacher.id}`)}
          activeOpacity={0.75}
        >
          <View style={[styles.avatar, { backgroundColor: colors.primary + "18" }]}>
            <Text style={[styles.avatarText, { color: colors.primary }]}>
              {teacher.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: colors.foreground }]}>{teacher.name}</Text>
            {!!teacher.subject && (
              <Text style={[styles.subject, { color: colors.mutedForeground }]}>{teacher.subject}</Text>
            )}
          </View>
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: 24 },
  list: { gap: 10, paddingHorizontal: 20, paddingTop: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  subject: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  empty: { alignItems: "center", gap: 10, borderRadius: 16, padding: 24, margin: 20 },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  action: { borderRadius: 12, paddingHorizontal: 18, paddingVertical: 9 },
  actionText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
