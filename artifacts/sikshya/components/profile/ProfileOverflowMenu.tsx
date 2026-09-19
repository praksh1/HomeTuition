import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { HIT_SLOP_MIN, elevation, space } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

type IconName = React.ComponentProps<typeof Feather>["name"];

interface MenuItem {
  icon: IconName;
  label: string;
  detail?: string;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export function ProfileOverflowMenu({ items }: { items: MenuItem[] }) {
  const colors = useColors();
  const { t, radius: radii } = useLayout();
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? "Close profile menu" : "Open profile menu"}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.trigger, { minHeight: HIT_SLOP_MIN, borderRadius: radii.pill, borderColor: open ? colors.primary : colors.border, backgroundColor: open ? colors.actionSoft : colors.card }, pressed && styles.pressed]}
        testID="profile-overflow-trigger"
      >
        <Feather name={open ? "x" : "menu"} size={21} color={open ? colors.primary : colors.foreground} />
      </Pressable>
      {open ? (
        <View style={[styles.menu, { borderRadius: radii.lg, borderColor: colors.border, backgroundColor: colors.card, ...elevation.sheet }]} testID="profile-overflow-menu">
          <Text style={[t.overline, styles.menuEyebrow, { color: colors.inkFaint }]}>PROFILE MENU</Text>
          {items.map((item) => {
            const textColor = item.destructive ? colors.destructive : item.disabled ? colors.inkFaint : colors.foreground;
            return (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                accessibilityState={{ disabled: item.disabled }}
                disabled={item.disabled}
                onPress={() => { setOpen(false); item.onPress?.(); }}
                style={({ pressed }) => [styles.item, { minHeight: HIT_SLOP_MIN, borderRadius: radii.sm }, pressed && !item.disabled && { backgroundColor: colors.actionSoft }]}
                testID={`profile-menu-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                <View style={[styles.itemIcon, { borderRadius: radii.sm, backgroundColor: item.disabled ? colors.muted : colors.actionSoft }]}>
                  <Feather name={item.icon} size={18} color={textColor} />
                </View>
                <View style={styles.itemCopy}>
                  <Text style={[t.bodyStrong, { color: textColor }]}>{item.label}</Text>
                  {item.detail ? <Text style={[t.caption, { color: colors.mutedForeground }]}>{item.detail}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", zIndex: 10, alignItems: "flex-end" },
  trigger: { width: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  menu: { position: "absolute", top: HIT_SLOP_MIN + space.xs, right: 0, width: 280, borderWidth: 1, padding: space.xs, gap: 2 },
  menuEyebrow: { paddingHorizontal: space.sm, paddingTop: space.xs, paddingBottom: space.xxs },
  item: { width: "100%", flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xs },
  itemIcon: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center" },
  itemCopy: { flex: 1, gap: 2 },
  pressed: { opacity: 0.72 },
});
