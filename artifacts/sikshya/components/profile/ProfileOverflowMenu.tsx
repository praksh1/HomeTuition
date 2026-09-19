import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FadkoLogo } from "@/components/FadkoLogo";
import { HIT_SLOP_MIN, elevation, radius, space } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

type IconName = React.ComponentProps<typeof Feather>["name"];

export interface ProfileMenuItem {
  icon: IconName;
  label: string;
  detail?: string;
  section?: string;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

/** A profile menu is a destination, not a tiny dropdown. */
export function ProfileOverflowMenu({ items }: { items: ProfileMenuItem[] }) {
  const colors = useColors();
  const { t, isExpanded } = useLayout();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<ProfileMenuItem | null>(null);

  const sections = useMemo(() => {
    const grouped = new Map<string, ProfileMenuItem[]>();
    for (const item of items) {
      const section = item.section ?? "Account";
      grouped.set(section, [...(grouped.get(section) ?? []), item]);
    }
    return [...grouped.entries()];
  }, [items]);

  const close = () => {
    setConfirming(null);
    setOpen(false);
  };

  const choose = (item: ProfileMenuItem) => {
    if (item.disabled) return;
    if (item.destructive) {
      setConfirming(item);
      return;
    }
    close();
    item.onPress?.();
  };

  const panelWidth = isExpanded ? Math.min(460, width - space.xxl * 2) : width;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open profile menu"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.trigger,
          { borderColor: colors.border, backgroundColor: colors.card },
          pressed && styles.pressed,
        ]}
        testID="profile-overflow-trigger"
      >
        <Feather name="menu" size={22} color={colors.foreground} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityLabel="Close menu" style={[styles.scrim, { backgroundColor: colors.scrim }]} onPress={close} />
          <View
            testID="profile-overflow-menu"
            style={[
              styles.menu,
              {
                width: panelWidth,
                top: isExpanded ? space.md : 0,
                bottom: isExpanded ? space.md : 0,
                borderRadius: isExpanded ? radius.lg : 0,
                borderColor: colors.border,
                backgroundColor: colors.background,
                paddingTop: isExpanded ? space.md : Math.max(insets.top, space.sm),
                paddingBottom: Math.max(insets.bottom, space.sm),
                ...elevation.modal,
              },
            ]}
          >
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={confirming ? "Back to menu" : "Close menu"}
                onPress={() => confirming ? setConfirming(null) : close()}
                style={({ pressed }) => [styles.back, { backgroundColor: colors.muted }, pressed && styles.pressed]}
              >
                <Feather name="arrow-left" size={21} color={colors.foreground} />
              </Pressable>
              <View style={styles.headerIdentity}><FadkoLogo compact /></View>
            </View>

            {confirming ? (
              <View style={styles.confirmation} testID="profile-menu-confirmation">
                <View style={[styles.confirmIcon, { backgroundColor: colors.destructiveSoft }]}>
                  <Feather name="log-out" size={24} color={colors.destructive} />
                </View>
                <Text accessibilityRole="header" style={[t.title1, { color: colors.foreground }]}>Log out of Fadko?</Text>
                <Text style={[t.body, styles.confirmCopy, { color: colors.mutedForeground }]}>You can sign back in at any time. Your classes, messages and account details stay safely in place.</Text>
                <View style={styles.confirmActions}>
                  <Pressable accessibilityRole="button" onPress={() => setConfirming(null)} style={({ pressed }) => [styles.confirmButton, { borderColor: colors.border, backgroundColor: colors.card }, pressed && styles.pressed]}>
                    <Text style={[t.bodyStrong, { color: colors.foreground }]}>Stay signed in</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => { close(); confirming.onPress?.(); }} style={({ pressed }) => [styles.confirmButton, { borderColor: colors.destructive, backgroundColor: colors.destructiveSoft }, pressed && styles.pressed]}>
                    <Text style={[t.bodyStrong, { color: colors.destructive }]}>Log out</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
                <View style={styles.titleBlock}>
                  <Text accessibilityRole="header" style={[t.display, { color: colors.foreground }]}>Menu</Text>
                  <Text style={[t.body, { color: colors.mutedForeground }]}>Your account, learning or teaching tools, and help in one place.</Text>
                </View>

                {sections.map(([section, sectionItems]) => (
                  <View key={section} style={styles.section}>
                    <Text style={[t.overline, styles.sectionLabel, { color: colors.inkFaint }]}>{section}</Text>
                    <View style={[styles.sectionRows, { borderTopColor: colors.border }]}>
                      {sectionItems.map((item, index) => {
                        const textColor = item.destructive ? colors.destructive : item.disabled ? colors.inkFaint : colors.foreground;
                        return (
                          <Pressable
                            key={item.label}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: item.disabled }}
                            disabled={item.disabled}
                            onPress={() => choose(item)}
                            style={({ pressed }) => [
                              styles.item,
                              index < sectionItems.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
                              pressed && !item.disabled && { backgroundColor: colors.actionSoft },
                            ]}
                            testID={`profile-menu-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                          >
                            <View style={[styles.itemIcon, { backgroundColor: item.destructive ? colors.destructiveSoft : colors.muted }]}>
                              <Feather name={item.icon} size={19} color={textColor} />
                            </View>
                            <View style={styles.itemCopy}>
                              <Text style={[t.bodyStrong, { color: textColor }]}>{item.label}</Text>
                              {item.detail ? <Text style={[t.caption, { color: colors.mutedForeground }]}>{item.detail}</Text> : null}
                            </View>
                            {item.disabled ? (
                              <View style={[styles.soon, { backgroundColor: colors.muted }]}><Text style={[t.caption, { color: colors.inkFaint }]}>Soon</Text></View>
                            ) : (
                              <Feather name="chevron-right" size={19} color={item.destructive ? colors.destructive : colors.inkFaint} />
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, borderWidth: 1 },
  modalRoot: { flex: 1, alignItems: "flex-end" },
  scrim: { ...StyleSheet.absoluteFillObject },
  menu: { position: "absolute", right: 0, overflow: "hidden", borderWidth: 1 },
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", paddingHorizontal: space.md, gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  headerIdentity: { flex: 1, alignItems: "flex-end" },
  back: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  content: { paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.xxxl, gap: space.xl },
  titleBlock: { gap: space.xs },
  section: { gap: space.xs },
  sectionLabel: { paddingHorizontal: space.xxs },
  sectionRows: { borderTopWidth: StyleSheet.hairlineWidth },
  item: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.xxs, paddingVertical: space.xs },
  itemIcon: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  itemCopy: { flex: 1, gap: 2 },
  soon: { borderRadius: radius.pill, paddingHorizontal: space.xs, paddingVertical: space.xxs },
  confirmation: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.md },
  confirmIcon: { width: 58, height: 58, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  confirmCopy: { textAlign: "center", maxWidth: 340 },
  confirmActions: { width: "100%", maxWidth: 360, gap: space.sm, marginTop: space.sm },
  confirmButton: { minHeight: HIT_SLOP_MIN + space.xs, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md },
  pressed: { opacity: Platform.OS === "web" ? 0.72 : 0.78, transform: [{ scale: 0.98 }] },
});
