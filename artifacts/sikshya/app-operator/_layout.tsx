import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { DatePreferenceProvider } from "@/context/DatePreferenceContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { OperatorAccessContext } from "@/context/OperatorAccessContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet } from "@/utils/api";
import { operatorAccessRejected, operatorDestination } from "@/utils/operatorNavigation";

void SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient();
type OperatorMe = { mustChangePassword: boolean };

function OperatorGuard() {
  const { user, isLoading, logout, startupProblem, isRetryingStartup, retryStartup } = useAuth();
  const first = useSegments()[0] as string | undefined;
  const colors = useColors();
  const { t, space, gutter, radius } = useLayout();
  const [checked, setChecked] = useState(false);
  const [problem, setProblem] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mustChangePassword, setMustChangePassword] = useState(true);

  useEffect(() => {
    if (isLoading || startupProblem) return;
    let active = true;
    setProblem(false);
    if (!user) {
      setChecked(true);
      const target = operatorDestination(null, false, first);
      if (target) router.replace(target as never);
      return;
    }
    setChecked(false);
    if (user.role !== "admin") {
      void Promise.resolve(logout()).then(() => { if (active) router.replace("/login" as never); });
      return () => { active = false; };
    }
    void apiGet<OperatorMe>("/operator/me").then((operator) => {
      if (!active) return;
      setMustChangePassword(operator.mustChangePassword);
      const target = operatorDestination(user.role, operator.mustChangePassword, first);
      if (target) router.replace(target as never);
      setChecked(true);
    }).catch((error: unknown) => {
      if (!active) return;
      if (operatorAccessRejected(error)) {
        void Promise.resolve(logout()).then(() => { if (active) router.replace("/login" as never); });
      } else setProblem(true);
    });
    return () => { active = false; };
  }, [user, isLoading, startupProblem, first, attempt]);

  const blocked = startupProblem || problem || isLoading || !checked;
  // The root navigator must mount before an effect can redirect. Keep access checks as a
  // blocking overlay; unmounting Stack for the initial spinner makes the first login redirect fail.
  return <View style={{ flex: 1 }}>
    <View pointerEvents={blocked ? "none" : "auto"} style={{ flex: 1, opacity: blocked ? 0 : 1 }}>
      <OperatorAccessContext.Provider value={!blocked && user?.role === "admin" && !mustChangePassword}>
        <Stack screenOptions={{ headerShown: false }}><Stack.Screen name="index" /><Stack.Screen name="login" /><Stack.Screen name="password" /><Stack.Screen name="(admin)" /></Stack>
      </OperatorAccessContext.Provider>
    </View>
    {startupProblem || problem ? <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: gutter, gap: space.md }}>
    <Text accessibilityRole="header" style={[t.title2, { color: colors.foreground }]}>The desk could not connect</Text>
    <Text style={[t.body, { color: colors.mutedForeground, textAlign: "center" }]}>Your session is still saved. Try again without refreshing or signing in again.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Retry the operator connection" accessibilityState={{ disabled: isRetryingStartup, busy: isRetryingStartup }} aria-disabled={isRetryingStartup} aria-busy={isRetryingStartup} disabled={isRetryingStartup} onPress={() => startupProblem ? void retryStartup() : setAttempt(value => value + 1)} style={{ minHeight: space.huge, paddingHorizontal: space.xl, justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}>
      <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>{isRetryingStartup ? "Connecting…" : "Try again"}</Text>
    </Pressable>
    </View> : blocked ? <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} /></View> : null}
  </View>;
}

export default function OperatorRootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  useEffect(() => { if (fontsLoaded || fontError) void SplashScreen.hideAsync(); }, [fontsLoaded, fontError]);
  if (!fontsLoaded && !fontError) return null;
  return <SafeAreaProvider><ErrorBoundary><QueryClientProvider client={queryClient}><AuthProvider><DatePreferenceProvider><NotificationProvider>
    <GestureHandlerRootView style={{ flex: 1 }}><KeyboardProvider><OperatorGuard /></KeyboardProvider></GestureHandlerRootView>
  </NotificationProvider></DatePreferenceProvider></AuthProvider></QueryClientProvider></ErrorBoundary></SafeAreaProvider>;
}
