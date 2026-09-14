import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HIT_SLOP_MIN, readingWidth } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

interface SearchableSelectionFieldProps {
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  searchPlaceholder: string;
  disabled?: boolean;
  onChoose: (value: string) => void;
  testID?: string;
}

/** A bounded, searchable picker so Nepal's long district/local-level lists never expand the page. */
export function SearchableSelectionField({
  label,
  value,
  options,
  placeholder,
  searchPlaceholder,
  disabled = false,
  onChoose,
  testID,
}: SearchableSelectionFieldProps) {
  const colors = useColors();
  const { t, space, radius, elevation, gutter } = useLayout();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? options.filter((option) => option.toLocaleLowerCase().includes(needle)) : options;
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return <View style={{ gap: space.xs }}>
    <Text style={[t.bodyStrong, { color: colors.foreground }]}>{label}</Text>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${value || placeholder}`}
      accessibilityState={{ disabled, expanded: open }}
      disabled={disabled}
      onPress={() => setOpen(true)}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: HIT_SLOP_MIN + space.xs,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.sm,
        paddingHorizontal: space.md,
        borderWidth: 1,
        borderColor: pressed ? colors.primary : colors.border,
        borderRadius: radius.sm,
        backgroundColor: disabled ? colors.muted : colors.card,
        opacity: disabled ? 0.62 : 1,
      })}
    >
      <Text numberOfLines={2} style={[t.body, { flex: 1, color: value ? colors.foreground : colors.inkFaint }]}>{value || placeholder}</Text>
      <Feather name="chevron-down" size={19} color={colors.mutedForeground} />
    </Pressable>

    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close selection" onPress={close} style={{ flex: 1, justifyContent: "flex-end", backgroundColor: colors.scrim }}>
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={[{
            width: "100%",
            maxWidth: readingWidth,
            maxHeight: "82%",
            alignSelf: "center",
            paddingTop: space.lg,
            paddingHorizontal: gutter,
            paddingBottom: insets.bottom + space.md,
            gap: space.md,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            backgroundColor: colors.background,
          }, elevation.modal]}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <View style={{ flex: 1, gap: space.xxs }}>
              <Text accessibilityRole="header" style={[t.title2, { color: colors.foreground }]}>{label.replace(" *", "")}</Text>
              <Text style={[t.caption, { color: colors.mutedForeground }]}>{options.length} available</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={{ width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.muted }}>
              <Feather name="x" size={20} color={colors.foreground} />
            </Pressable>
          </View>

          <View style={{ minHeight: HIT_SLOP_MIN + space.xs, flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.card }}>
            <Feather name="search" size={18} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.inkFaint}
              autoCapitalize="words"
              autoFocus
              style={[t.body, { flex: 1, color: colors.foreground }]}
            />
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(item) => item}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border }} />}
            ListEmptyComponent={<View style={{ paddingVertical: space.xl, alignItems: "center", gap: space.xs }}><Feather name="search" size={24} color={colors.mutedForeground} /><Text style={[t.body, { color: colors.mutedForeground }]}>No match found</Text></View>}
            renderItem={({ item }) => <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: item === value }}
              onPress={() => { onChoose(item); close(); }}
              style={({ pressed }) => ({
                minHeight: HIT_SLOP_MIN + space.xs,
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingHorizontal: space.sm,
                backgroundColor: pressed || item === value ? colors.actionSoft : colors.card,
              })}
            >
              <Text style={[t.body, { flex: 1, color: item === value ? colors.primary : colors.foreground }]}>{item}</Text>
              {item === value ? <Feather name="check" size={18} color={colors.primary} /> : null}
            </Pressable>}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  </View>;
}
