import { Redirect, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { FadkoLogo } from "@/components/FadkoLogo";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

export default function Index() {
  const { user, isLoading, startupProblem, isRetryingStartup, retryStartup } = useAuth();
  const router = useRouter();
  const colors = useColors();
  const { t, space, radius, elevation } = useLayout();

  useEffect(() => {
    if (!startupProblem || isRetryingStartup) return;
    // A short API restart should heal without asking the person to do anything. The screen below
    // stays usable while this happens, so repeated trouble is visible rather than another spinner.
    const retry = setTimeout(() => void retryStartup(), 5_000);
    return () => clearTimeout(retry);
  }, [startupProblem, isRetryingStartup, retryStartup]);

  if (isLoading) {
    return (
      <View style={[styles.loading, { backgroundColor: "#C41E3A" }]}>
        <ActivityIndicator color="#fff" size="large" />
        <Text style={styles.loadingText}>Fadko</Text>
      </View>
    );
  }

  if (startupProblem) {
    return (
      <View style={[styles.recovery, { gap: space.xl, padding: space.lg, backgroundColor: colors.background }]} accessibilityRole="alert" testID="startup-recovery">
        <FadkoLogo color={colors.brand} wordmarkColor={colors.foreground} />
        <View style={[styles.recoveryCard, elevation.sheet, { gap: space.md, padding: space.xl, borderRadius: radius.lg, borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={[styles.statusRow, { gap: space.xs }]}>
            <View style={[styles.statusDot, { backgroundColor: colors.warn }]} />
            <Text style={[t.caption, { color: colors.warn }]}>{isRetryingStartup ? "Checking again…" : "Connection interrupted"}</Text>
          </View>
          <Text style={[t.title1, { color: colors.foreground }]}>We’re reconnecting</Text>
          <Text style={[t.body, { color: colors.mutedForeground }]}>
            Fadko could not confirm your session just now. Your account is safe, and we will keep trying automatically.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry connection now"
            disabled={isRetryingStartup}
            onPress={() => void retryStartup()}
            style={({ pressed }) => [styles.retryButton, { borderRadius: radius.lg, backgroundColor: colors.primary }, pressed && styles.pressed, isRetryingStartup && styles.disabled]}
          >
            {isRetryingStartup ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Retry now</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.replace("/welcome")} style={[styles.signInButton, { borderRadius: radius.md }]}>
            <Text style={[t.bodyStrong, { color: colors.primary }]}>Open sign in</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (user?.role === "teacher") return <Redirect href="/(teacher)" />;
  if (user?.role === "student") return <Redirect href="/(student)" />;
  // The guard in app/_layout.tsx would send an agent to the desk anyway; sending them straight
  // there saves a bounce through the welcome screen, which they would otherwise see flash.
  if (user?.role === "admin") return <Redirect href="/(admin)" />;
  return <Redirect href="/welcome" />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16 },
  loadingText: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -1 },
  recovery: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  recoveryCard: {
    width: "100%",
    maxWidth: 460,
    borderWidth: 1,
  },
  statusRow: { flexDirection: "row", alignItems: "center" },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  retryButton: { minHeight: 54, alignItems: "center", justifyContent: "center" },
  signInButton: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.72 },
});
