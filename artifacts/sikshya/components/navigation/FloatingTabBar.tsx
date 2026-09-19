import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Link, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HIT_SLOP_MIN, elevation, motion, radius, space } from "@/constants/layout";
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

/**
 * A stable app control surface: compact on phones and a navigation rail on laptops.
 * The selected surface physically moves between destinations instead of each tab blinking on.
 */
export function FloatingTabBar({ state, descriptors, navigation }: FloatingTabBarProps) {
  const colors = useColors();
  const { t, isExpanded } = useLayout();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const position = useRef(new Animated.Value(0)).current;
  const [shellSize, setShellSize] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const currentOptions = descriptors[state.routes[state.index].key]?.options as RouteOptions | undefined;

  const visibleRoutes = useMemo(() => state.routes.filter((route) => {
    const options = descriptors[route.key]?.options;
    // Expo Router drops `href: null` from web descriptors. The icon is the
    // cross-platform visibility contract: primary destinations have one;
    // shell-preserving nested destinations deliberately do not.
    return Boolean(options?.tabBarIcon && options.href !== null);
  }), [descriptors, state.routes]);
  const activeRoute = state.routes[state.index];
  const activeIndex = visibleRoutes.findIndex((route) => route.key === activeRoute.key);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    // Hidden destinations such as Support keep the shell available, but no
    // visible tab should pretend to be selected while the user is there.
    if (activeIndex < 0) return;
    if (reduceMotion) {
      position.setValue(activeIndex);
      return;
    }
    Animated.spring(position, {
      toValue: activeIndex,
      useNativeDriver: true,
      ...motion.spring,
    }).start();
  }, [activeIndex, position, reduceMotion]);

  if ((currentOptions?.tabBarStyle as { display?: string } | undefined)?.display === "none") {
    return null;
  }

  const count = Math.max(visibleRoutes.length, 1);
  const mobileWidth = Math.min(width - space.lg, 430);
  const railItemHeight = 64;
  const indicatorTravel = isExpanded
    ? Math.max(0, railItemHeight * (count - 1))
    : Math.max(0, ((shellSize - space.xs * 2) / count) * (count - 1));
  const indicatorTransform = position.interpolate({
    inputRange: count === 1 ? [0, 1] : [0, count - 1],
    outputRange: [0, indicatorTravel],
    extrapolate: "clamp",
  });

  const captureSize = (event: LayoutChangeEvent) => {
    setShellSize(isExpanded ? event.nativeEvent.layout.height : event.nativeEvent.layout.width);
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        pointerEvents="box-none"
        style={isExpanded ? styles.desktopDock : [styles.mobileDock, { bottom: Math.max(insets.bottom, Platform.OS === "web" ? space.sm : space.xs) }]}
      >
        <View
          onLayout={captureSize}
          style={[
            styles.shell,
            isExpanded ? styles.rail : styles.bar,
            {
              width: isExpanded ? 92 : mobileWidth,
              minHeight: isExpanded ? count * railItemHeight + space.xs * 2 : 66,
              borderColor: colors.border,
              backgroundColor: colors.card,
              ...elevation.sheet,
            },
          ]}
        >
          {shellSize > 0 && activeIndex >= 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.indicator,
                isExpanded
                  ? {
                      top: space.xs,
                      left: space.xs,
                      right: space.xs,
                      height: railItemHeight - 4,
                      transform: [{ translateY: indicatorTransform }],
                    }
                  : {
                      top: space.xs,
                      bottom: space.xs,
                      left: space.xs,
                      width: Math.max(44, (shellSize - space.xs * 2) / count - 2),
                      transform: [{ translateX: indicatorTransform }],
                    },
                { backgroundColor: colors.actionSoft, borderColor: `${colors.primary}20` },
              ]}
            >
              <View style={[styles.indicatorHighlight, { backgroundColor: colors.card }]} />
            </Animated.View>
          ) : null}

          {visibleRoutes.map((route) => {
            const index = state.routes.findIndex((candidate) => candidate.key === route.key);
            const options = descriptors[route.key].options;
            const focused = state.index === index;
            const label = typeof options.tabBarLabel === "string"
              ? options.tabBarLabel
              : typeof options.title === "string" ? options.title : route.name;
            const badge = options.tabBarBadge;
            const onPress = () => {
              const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                if (Platform.OS !== "web") void Haptics.selectionAsync();
                navigation.navigate(route.name, route.params);
              }
            };
            const onLongPress = () => navigation.emit({ type: "tabLongPress", target: route.key });
            const icon = options.tabBarIcon?.({ focused, color: focused ? colors.primary : colors.mutedForeground, size: 21, position: "below-icon" });
            const href = (route.name === "index" ? "/" : `/${route.name}`) as Href;

            return (
              <Link key={route.key} href={href} asChild>
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={focused ? { selected: true } : {}}
                  accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
                  onPress={onPress}
                  onLongPress={onLongPress}
                  testID={options.tabBarButtonTestID ?? `tab-${route.name}`}
                  style={({ pressed }) => [
                    styles.item,
                    isExpanded ? { height: railItemHeight } : { minHeight: HIT_SLOP_MIN + space.sm },
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.iconWrap}>
                    {icon}
                    {badge !== undefined && badge !== null ? (
                      <View style={[styles.badge, { backgroundColor: colors.brand, borderColor: colors.card }]}>
                        <Text style={[t.caption, styles.badgeText, { color: colors.onInverse }]}>{String(badge)}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text numberOfLines={1} style={[t.caption, styles.label, { color: focused ? colors.primary : colors.mutedForeground, fontWeight: focused ? "700" : "500" }]}>
                    {label}
                  </Text>
                </Pressable>
              </Link>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mobileDock: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  desktopDock: { position: "absolute", left: space.xl, top: 96, alignItems: "flex-start" },
  shell: { overflow: "hidden", borderWidth: 1 },
  bar: { flexDirection: "row", alignItems: "stretch", borderRadius: radius.pill, padding: space.xs },
  rail: { flexDirection: "column", borderRadius: radius.lg, padding: space.xs },
  indicator: { position: "absolute", overflow: "hidden", borderWidth: 1, borderRadius: radius.pill },
  indicatorHighlight: { position: "absolute", left: "22%", right: "22%", top: 2, height: 1, opacity: 0.8 },
  item: { flex: 1, minWidth: 44, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: radius.pill, zIndex: 1 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.94 }] },
  iconWrap: { width: 28, height: 25, alignItems: "center", justifyContent: "center" },
  label: { maxWidth: "100%" },
  badge: { position: "absolute", top: -7, right: -8, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 3, borderRadius: radius.pill, borderWidth: 2 },
  badgeText: { lineHeight: 11, fontWeight: "700", transform: [{ scale: 0.82 }] },
});
