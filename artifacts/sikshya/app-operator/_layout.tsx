import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { DatePreferenceProvider } from "@/context/DatePreferenceContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/utils/api";

SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient();

type OperatorMe = { mustChangePassword: boolean };

function OperatorGuard() {
  const { user, isLoading, logout } = useAuth();
  const segments = useSegments();
  const colors = useColors();
  const [checked, setChecked] = useState(false);
  const first = segments[0] as string | undefined;

  useEffect(() => {
    if (isLoading) return;
    let active = true;
    if (!user) {
      setChecked(true);
      if (first !== "index" && first !== undefined) router.replace("/" as never);
      return;
    }
    setChecked(false);
    if (user.role !== "admin") {
      void Promise.resolve(logout()).then(() => { if (active) router.replace("/" as never); });
      return () => { active = false; };
    }
    void apiGet<OperatorMe>("/operator/me").then((operator) => {
      if (!active) return;
      setChecked(true);
      if (operator.mustChangePassword && first !== "password") router.replace("/password" as never);
      else if (!operator.mustChangePassword && (first === "index" || first === undefined || first === "password")) router.replace("/(admin)" as never);
    }).catch(() => {
      if (!active) return;
      void Promise.resolve(logout()).then(() => { if (active) router.replace("/" as never); });
    });
    return () => { active = false; };
  }, [user, isLoading, first]);

  if (isLoading || !checked) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} /></View>;
  return <Stack screenOptions={{ headerShown: false }}>
    <Stack.Screen name="index" />
    <Stack.Screen name="password" />
    <Stack.Screen name="(admin)" />
  </Stack>;
}

export default function OperatorRootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  useEffect(() => { if (fontsLoaded || fontError) void SplashScreen.hideAsync(); }, [fontsLoaded, fontError]);
  if (!fontsLoaded && !fontError) return null;
  return <SafeAreaProvider><ErrorBoundary><QueryClientProvider client={queryClient}>
    <AuthProvider><DatePreferenceProvider><NotificationProvider>
      <GestureHandlerRootView style={{ flex: 1 }}><KeyboardProvider><OperatorGuard /></KeyboardProvider></GestureHandlerRootView>
    </NotificationProvider></DatePreferenceProvider></AuthProvider>
  </QueryClientProvider></ErrorBoundary></SafeAreaProvider>;
}
