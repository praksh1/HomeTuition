import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { applyWebViewportFix } from "@/utils/webViewport";
import { NotificationProvider } from "@/context/NotificationContext";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

/**
 * Screens that live outside the teacher and student tab groups, and belong to both.
 *
 * One list, read by the navigator below *and* by the guard above, because they used to be two
 * and they disagreed. `notification-settings` was declared as a screen and left out of the
 * guard, so a teacher tapping Profile → Notifications failed every branch of the role check
 * and was sent back to their dashboard — the screen was fine and unreachable. The sibling
 * `notifications` was in both lists and worked, which is what made it look like a dead button
 * rather than a routing bug.
 *
 * `segment` is the first path segment the router reports, which is the file name for a plain
 * screen and the directory for a dynamic one.
 */
const SHARED_SCREENS = [
  { name: "notifications", segment: "notifications" },
  { name: "notification-settings", segment: "notification-settings" },
  { name: "conversation/[id]", segment: "conversation" },
  { name: "new-message", segment: "new-message" },
  { name: "support", segment: "support" },
  // A class's own page. Shared because both roles land on it from the same link — the one in
  // the invitation and booking emails, which until now led nowhere.
  { name: "session/[id]", segment: "session" },
] as const;

function AuthGuard() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inTeacherGroup = segments[0] === "(teacher)";
    const inStudentGroup = segments[0] === "(student)";
    const inAuthGroup = segments[0] === "(auth)";
    const onSharedScreen = SHARED_SCREENS.some(({ segment }) => segments[0] === segment);
    const inProtectedGroup = inTeacherGroup || inStudentGroup;

    if (!user) {
      if (inProtectedGroup || onSharedScreen) router.replace("/welcome");
    } else if (user.role === "teacher") {
      if (!inTeacherGroup && !inAuthGroup && !onSharedScreen) router.replace("/(teacher)");
    } else if (user.role === "student") {
      if (!inStudentGroup && !inAuthGroup && !onSharedScreen) router.replace("/(student)");
    }
  }, [user, isLoading, segments]);

  return null;
}

function RootLayoutNav() {
  return (
    <>
      <AuthGuard />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(teacher)" />
        <Stack.Screen name="(student)" />
        {SHARED_SCREENS.map(({ name }) => (
          <Stack.Screen
            key={name}
            name={name}
            options={{ animation: "slide_from_right", presentation: "card" }}
          />
        ))}
      </Stack>
    </>
  );
}

// iOS Safari draws the bottom of a 100%-tall page behind its own toolbar, which is where the
// chat input lives. See utils/webViewport.ts.
applyWebViewportFix();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <NotificationProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </NotificationProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
