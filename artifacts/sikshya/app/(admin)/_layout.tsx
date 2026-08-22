import { BlurView } from "expo-blur";
import { Tabs, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

/**
 * The support desk, for customer-care agents.
 *
 * A separate tab group rather than a screen inside Profile: an agent's whole job is in here,
 * and it has nothing in common with what a teacher or a student uses the app for.
 *
 * The guard below is a courtesy, not a control. Every route under /admin re-reads the caller's
 * role from the database on every request, so an app that showed these screens to the wrong
 * person would show them empty. Hiding them is so nobody has to find that out.
 */
function AdminRoleGuard() {
  const { user } = useAuth();

  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace(user.role === "teacher" ? "/(teacher)" : "/(student)");
    }
  }, [user]);

  return null;
}

export default function AdminTabLayout() {
  const colors = useColors();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <>
      <AdminRoleGuard />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.secondary,
          tabBarInactiveTintColor: colors.mutedForeground,
          headerShown: false,
          tabBarStyle: {
            position: "absolute",
            backgroundColor: isIOS ? "transparent" : colors.background,
            borderTopWidth: isWeb ? 1 : 0,
            borderTopColor: colors.border,
            elevation: 0,
            ...(isWeb ? { height: 84 } : {}),
          },
          tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11 },
          tabBarBackground: () =>
            isIOS ? (
              <BlurView intensity={100} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
            ) : isWeb ? (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
            ) : null,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: "Tickets", tabBarIcon: ({ color }) => <Feather name="inbox" size={22} color={color} /> }}
        />
        <Tabs.Screen
          name="people"
          options={{ title: "People", tabBarIcon: ({ color }) => <Feather name="users" size={22} color={color} /> }}
        />
        <Tabs.Screen
          name="activity"
          options={{ title: "Activity", tabBarIcon: ({ color }) => <Feather name="list" size={22} color={color} /> }}
        />
        <Tabs.Screen name="ticket/[id]" options={{ href: null }} />
        <Tabs.Screen name="person/[id]" options={{ href: null }} />
      </Tabs>
    </>
  );
}
