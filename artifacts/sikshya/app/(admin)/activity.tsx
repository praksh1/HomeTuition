import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/utils/api";

/**
 * Everything that has happened, newest first.
 *
 * The screen for the question nobody anticipated. Filterable by person and by thing, because
 * those are the two ways it actually gets read: "what did this person do" and "what happened
 * to this class".
 */

interface Row {
  id: number; userId: number | null; userName: string | null; action: string;
  subjectType: string | null; subjectId: number | null; createdAt: string;
}

export default function AdminActivity() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [action, setAction] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [known, setKnown] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const query = action.trim() ? `?action=${encodeURIComponent(action.trim())}` : "";
      const res = await apiGet<{ known: boolean; rows: Row[] }>(`/admin/activity${query}`);
      setRows(res.rows ?? []);
      setKnown(res.known !== false);
    } catch {
      setKnown(false);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [action]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>Activity</Text>

      <TextInput
        testID="admin-activity-filter"
        style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
        placeholder="Filter by action, e.g. admin.account.suspended"
        placeholderTextColor={colors.mutedForeground}
        value={action}
        onChangeText={setAction}
        autoCapitalize="none"
        onSubmitEditing={() => void load()}
        returnKeyType="search"
      />

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      ) : !known ? (
        <Text style={[styles.empty, { color: colors.destructive }]}>
          The log could not be read. That is not the same as nothing having happened.
        </Text>
      ) : rows.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>Nothing matches.</Text>
      ) : (
        rows.map((row) => (
          <TouchableOpacity
            key={row.id}
            style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
            activeOpacity={row.userId ? 0.8 : 1}
            onPress={() => { if (row.userId) router.push(`/(admin)/person/${row.userId}`); }}
          >
            <Text style={[styles.action, { color: colors.foreground }]}>{row.action}</Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {row.userName ?? "the server"}
              {row.subjectType ? ` · ${row.subjectType} ${row.subjectId}` : ""}
              {" · "}{new Date(row.createdAt).toLocaleString()}
            </Text>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 10 },
  title: { fontSize: 24, fontFamily: "Inter_600SemiBold" },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular" },
  empty: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 20, lineHeight: 20 },
  row: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 3 },
  action: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
