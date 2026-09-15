import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { PremiumTabIcon } from "@/components/navigation/PremiumTabIcon";
import { useColors } from "@/hooks/useColors";
import { useUnreadMessages } from "@/hooks/useUnreadMessages";
import { useAuth } from "@/context/AuthContext";

function ClassicStudentTabLayout() {
  const { user } = useAuth();
  const { unread: unreadMessages } = useUnreadMessages(user?.role === "student");
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const icon = (name: React.ComponentProps<typeof PremiumTabIcon>["name"]) =>
    ({ color, focused }: { color: string; focused: boolean }) => (
      <PremiumTabIcon name={name} color={color} focused={focused} accent={colors.primary} soft={colors.actionSoft} />
    );

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
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
        options={{
          title: "Discover",
          tabBarIcon: icon("compass"),
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: "Classes",
          tabBarIcon: icon("calendar"),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          // Without a badge a new message was invisible until the user thought to look.
          tabBarBadge: unreadMessages > 0 ? (unreadMessages > 99 ? "99+" : unreadMessages) : undefined,
          tabBarIcon: icon("message-circle"),
        }}
      />
      {/* "same for students - the Customer Service needs to have a separate Tab!" */}
      <Tabs.Screen
        name="support"
        options={{
          title: "Support",
          tabBarIcon: icon("life-buoy"),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: icon("user"),
        }}
      />
      {/* Reached from Discover. See the note in the teacher's layout about the size of the bar. */}
      <Tabs.Screen name="monthly" options={{ href: null }} />
      <Tabs.Screen name="teacher/[id]" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="program/[id]" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="classroom/[id]" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="payments" options={{ href: null, tabBarStyle: { display: "none" } }} />
    </Tabs>
  );
}

export default function StudentTabLayout() {
  return <ClassicStudentTabLayout />;
}
