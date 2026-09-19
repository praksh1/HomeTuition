import React from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HIT_SLOP_MIN, elevation, radius, space } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

type RouteOptions = {
  title?: string;
  tabBarLabel?: string | ((props: { focused: boolean; color: string; position: "below-icon" | "beside-icon" }) => React.ReactNode);
  tabBarIcon?: (props: { focused: boolean; color: string; size: number; position: "below-icon" | "beside-icon" }) => React.ReactNode;
  tabBarBadge?: string | number;
  tabBarAccessibilityLabel?: string;
  tabBarButtonTestID?: string;
  tabBarStyle?: object;
  href?: string | null;
};

type TabRoute = { key: string; name: string; params?: object };
type TabState = { index: number; routes: TabRoute[] };
type TabDescriptor = { options: RouteOptions };
type TabNavigation = {
  emit: (event: { type: "tabPress" | "tabLongPress"; target: string; canPreventDefault?: boolean }) => { defaultPrevented?: boolean };
  navigate: (name: string, params?: object) => void;
};
export type FloatingTabBarProps = { state: TabState; descriptors: Record<string, TabDescriptor>; navigation: TabNavigation };

const LinkPressable = Pressable as React.ComponentType<React.ComponentProps<typeof Pressable> & { href?: string }>;

/**
 * Fadko's primary navigation surface.
 *
 * The old tab bar was technically usable but visually read like a browser footer. This shared
 * bar keeps the familiar React Navigation contract while giving both mobile and web one clear
 * place in the product: a calm floating capsule, a soft active "bubble", and a tiny live badge.
 * On a laptop it grows only to a readable width instead of stretching across the whole window.
 */
export function FloatingTabBar({ state, descriptors, navigation }: FloatingTabBarProps) {
  const colors = useColors();
  const { t, isExpanded } = useLayout();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const currentOptions = descriptors[state.routes[state.index].key]?.options as RouteOptions | undefined;

  // Hidden detail routes can still live inside the tab navigator without covering their content.
  if (currentOptions?.href === null || (currentOptions?.tabBarStyle as { display?: string } | undefined)?.display === "none") {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        pointerEvents="box-none"
        style={[
          styles.dock,
          {
            bottom: Math.max(insets.bottom, Platform.OS === "web" ? space.sm : space.xs),
            paddingHorizontal: isExpanded ? space.xl : space.sm,
          },
        ]}
      >
        <View
          style={[
            styles.shell,
            {
              width: Math.min(Math.max(width - space.sm, 280), isExpanded ? 820 : 620),
              borderRadius: radius.lg + space.xs,
              backgroundColor: colors.card,
              borderColor: colors.border,
              ...elevation.sheet,
            },
          ]}
        >
          {state.routes.map((route, index) => {
            const options = descriptors[route.key].options;
            if ((options as RouteOptions).href === null) return null;
            const focused = state.index === index;
            const label = typeof options.tabBarLabel === "string"
              ? options.tabBarLabel
              : typeof options.title === "string" ? options.title : route.name;
            const badge = options.tabBarBadge;
            const onPress = () => {
              const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
            };
            const onLongPress = () => navigation.emit({ type: "tabLongPress", target: route.key });
            const icon = options.tabBarIcon?.({ focused, color: focused ? colors.primary : colors.mutedForeground, size: 21, position: "below-icon" });

            return (
              <LinkPressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityState={focused ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
                onPress={onPress}
                onLongPress={onLongPress}
                href={Platform.OS === "web" ? (route.name === "index" ? "/" : `/${route.name}`) : undefined}
                testID={options.tabBarButtonTestID ?? `tab-${route.name}`}
                style={({ pressed }) => [styles.item, { minHeight: HIT_SLOP_MIN + space.xs }, pressed && styles.pressed]}
              >
                <View style={[styles.bubble, focused && { backgroundColor: colors.actionSoft, borderColor: colors.primary }]}>
                  {icon}
                  {badge !== undefined && badge !== null ? (
                    <View style={[styles.badge, { backgroundColor: colors.brand, borderColor: colors.card }]}>
                      <Text style={[t.caption, styles.badgeText, { color: colors.onInverse }]}>{String(badge)}</Text>
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} style={[t.caption, styles.label, { color: focused ? colors.primary : colors.mutedForeground }]}>
                  {label}
                </Text>
                {focused ? <View style={[styles.activeDot, { backgroundColor: colors.primary }]} /> : null}
              </LinkPressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  shell: { flexDirection: "row", alignItems: "stretch", borderWidth: 1, padding: space.xs },
  item: { flex: 1, minWidth: 44, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: radius.md },
  pressed: { opacity: 0.72 },
  bubble: { width: 42, height: 30, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: "transparent" },
  label: { fontWeight: "500" },
  activeDot: { width: 4, height: 4, borderRadius: radius.pill, marginTop: 1 },
  badge: { position: "absolute", top: -6, right: -7, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 3, borderRadius: radius.pill, borderWidth: 2 },
  badgeText: { lineHeight: 11, fontWeight: "700", transform: [{ scale: 0.82 }] },
});
