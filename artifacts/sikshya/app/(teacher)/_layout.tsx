import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { FloatingTabBar, type FloatingTabBarProps } from "@/components/navigation/FloatingTabBar";
import SupportAssistantLauncher from "@/components/support/SupportAssistantLauncher";
import { useUnreadMessages } from "@/hooks/useUnreadMessages";

function ClassicTabLayout() {
  const { unread: unreadMessages } = useUnreadMessages();
  const icon = (name: React.ComponentProps<typeof Feather>["name"]) =>
    ({ color, focused }: { color: string; focused: boolean }) => (
      <Feather name={name} size={21} color={color} />
    );

  return (
    <Tabs
      tabBar={(props) => (
        <>
          <SupportAssistantLauncher />
          <FloatingTabBar {...(props as unknown as FloatingTabBarProps)} />
        </>
      )}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: icon("home"),
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: "Schedule",
          tabBarIcon: icon("calendar"),
        }}
      />
      <Tabs.Screen
        name="students"
        options={{
          title: "Students",
          tabBarIcon: icon("users"),
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
          tabBarIcon: icon("life-buoy"),
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
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: icon("user"),
        }}
      />
      {/* Still routable, and reached from Profile — just no longer a tab of its own. */}
      <Tabs.Screen name="subscription" options={{ href: null }} />
      {/*
        Reached from the Dashboard rather than given a tab of its own.

        The bar already holds six, and the owner's students are on cheap Android phones where a
        seventh is a squeeze. A monthly class is also something a teacher sets up once and then
        lives inside, which is the same argument that moved Plan off the bar.
      */}
      <Tabs.Screen name="monthly" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="session-create" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="create-class" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="teaching-classes" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="teaching-class/[id]" options={{ href: null, tabBarStyle: { display: "none" } }} />
      {/*
        Programs, reached from the Dashboard rather than given a seventh tab.

        The bar already holds six, and the note on `monthly` above records why a seventh is a
        squeeze on the cheap Android this product is built for. A Learning Program is also the same
        shape of thing as a monthly class — set up once, then lived inside — which is the argument
        that kept that one off the bar too.
      */}
      <Tabs.Screen name="programs/index" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="programs/new" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="programs/[id]" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="programs/statement" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="program-batches/[id]" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="classroom/[id]" options={{ href: null, tabBarStyle: { display: "none" } }} />
    </Tabs>
  );
}

export default function TeacherTabLayout() {
  return <ClassicTabLayout />;
}
