import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

type IconName = React.ComponentProps<typeof Feather>["name"];

interface ProfileActionRowProps {
  icon: IconName;
  title: string;
  detail: string;
  onPress: () => void;
  testID?: string;
}

export function ProfileActionRow({ icon, title, detail, onPress, testID }: ProfileActionRowProps) {
  const colors = useColors();
  const { t, space, radius } = useLayout();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: HIT_SLOP_MIN + space.md,
          gap: space.sm,
          padding: space.sm,
          borderRadius: radius.md,
          borderColor: pressed ? colors.primary : colors.border,
          backgroundColor: pressed ? colors.actionSoft : colors.card,
        },
      ]}
    >
      {({ pressed }) => <>
        <View style={[styles.icon, { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, borderRadius: radius.sm, backgroundColor: colors.actionSoft }]}>
          <Feather name={icon} size={19} color={colors.primary} />
        </View>
        <View style={[styles.copy, { gap: space.xxs }]}>
          <Text style={[t.bodyStrong, { color: colors.foreground }]}>{title}</Text>
          <Text style={[t.caption, { color: colors.mutedForeground }]}>{detail}</Text>
        </View>
        <Feather name="chevron-right" size={19} color={pressed ? colors.primary : colors.mutedForeground} />
      </>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { width: "100%", flexDirection: "row", alignItems: "center", borderWidth: 1 },
  icon: { alignItems: "center", justifyContent: "center" },
  copy: { flex: 1 },
});
