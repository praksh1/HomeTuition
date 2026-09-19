import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { AppShellHeader } from "@/components/navigation/AppShellHeader";
import { FloatingTabBar, type FloatingTabBarProps } from "@/components/navigation/FloatingTabBar";
import { useUnreadMessages } from "@/hooks/useUnreadMessages";
import { useAuth } from "@/context/AuthContext";

function ClassicStudentTabLayout() {
  const { user } = useAuth();
  const { unread: unreadMessages } = useUnreadMessages(user?.role === "student");
  const icon = (name: React.ComponentProps<typeof Feather>["name"]) =>
    ({ color, focused }: { color: string; focused: boolean }) => (
      <Feather name={name} size={21} color={color} />
    );

  return (
    <Tabs
      tabBar={(props) => (
        <FloatingTabBar {...(props as unknown as FloatingTabBarProps)} />
      )}
      screenOptions={({ route }) => ({
        headerShown: ["index", "sessions", "messages", "support", "requests", "profile"].includes(route.name),
        header: () => <AppShellHeader role="student" routeName={route.name} />,
        animation: "fade",
        freezeOnBlur: true,
      })}
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
      {/* Support remains part of the shell, but lives in the profile menu rather than
          competing with daily destinations in the compact dock. */}
      <Tabs.Screen
        name="support"
        options={{
          title: "Support",
          href: null,
          tabBarIcon: icon("life-buoy"),
        }}
      />
      <Tabs.Screen name="requests" options={{ href: null }} />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: icon("user"),
        }}
      />
      {/* Reached from Discover. See the note in the teacher's layout about the size of the bar. */}
      <Tabs.Screen name="monthly" options={{ href: null, tabBarStyle: { display: "none" } }} />
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
