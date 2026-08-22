import { BlurView } from "expo-blur";
import { Tabs, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useUnreadMessages } from "@/hooks/useUnreadMessages";
import { useAuth } from "@/context/AuthContext";

function TeacherRoleGuard() {
  const { user, logout } = useAuth();

  useEffect(() => {
    if (user && user.role !== "teacher") {
      logout();
      const message = "This account is registered as a student. You've been signed out for security.";
      if (Platform.OS === "web") window.alert(`Access Denied\n\n${message}`);
      router.replace("/(student)");
    }
  }, [user]);

  if (user && user.role !== "teacher") return null;
  return null;
}

function ClassicTabLayout() {
  const { unread: unreadMessages } = useUnreadMessages();
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

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
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color }) => <Feather name="home" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: "Sessions",
          tabBarIcon: ({ color }) => <Feather name="calendar" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="students"
        options={{
          title: "Students",
          tabBarIcon: ({ color }) => <Feather name="users" size={22} color={color} />,
        }}
      />
      {/*
        Support takes the place Plan used to hold.

        The owner's words: "the 'Plan' tab can be integrated inside the 'Profile' tab, and
        maybe the Customer Service can be a separate tab". A subscription is something a
        teacher sets up once and then forgets; support is what they reach for on the day
        something goes wrong, and it was two taps deep inside Profile.
      */}
      <Tabs.Screen
        name="support"
        options={{
          title: "Support",
          tabBarIcon: ({ color }) => <Feather name="life-buoy" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          // Without a badge a new message was invisible until the user thought to look.
          tabBarBadge: unreadMessages > 0 ? (unreadMessages > 99 ? "99+" : unreadMessages) : undefined,
          tabBarIcon: ({ color }) => <Feather name="message-circle" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <Feather name="user" size={22} color={color} />,
        }}
      />
      {/* Still routable, and reached from Profile — just no longer a tab of its own. */}
      <Tabs.Screen name="subscription" options={{ href: null }} />
      <Tabs.Screen name="session-create" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="classroom/[id]" options={{ href: null, tabBarStyle: { display: "none" } }} />
    </Tabs>
  );
}

export default function TeacherTabLayout() {
  return (
    <>
      <TeacherRoleGuard />
      <ClassicTabLayout />
    </>
  );
}
