import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiPost, setToken } from "@/utils/api";

type LoginReply = { token: string; operator: { mustChangePassword: boolean } };

export default function OperatorLogin() {
  const colors = useColors();
  const { t, space, radius, gutter } = useLayout();
  const insets = useSafeAreaInsets();
  const { retryStartup } = useAuth();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signIn = async () => {
    if (busy) return;
    if (!loginId.trim() || !password) { setError("Enter your operator ID and password."); return; }
    setBusy(true); setError("");
    try {
      const reply = await apiPost<LoginReply>("/operator/login", { loginId: loginId.trim(), password });
      await setToken(reply.token);
      setPassword("");
      // Unlike refreshUser, startup recovery makes a failed profile request retryable and visible.
      await retryStartup();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not sign in. Try again."); }
    finally { setBusy(false); }
  };
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, paddingHorizontal: gutter, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }}>
    <View style={{ width: "100%", maxWidth: 440, padding: space.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card, gap: space.md }}>
      <Text style={[t.overline, { color: colors.primary }]}>FADKO · PRIVATE WORKSPACE</Text>
      <Text accessibilityRole="header" style={[t.title1, { color: colors.foreground }]}>Operator sign in</Text>
      <Text style={[t.body, { color: colors.mutedForeground }]}>Use your administrator-issued operator ID. On your first visit, use your one-time password and choose a private password.</Text>
      <View style={{ gap: space.xs }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>Operator ID</Text>
        <TextInput accessibilityLabel="Operator ID" autoCapitalize="none" autoCorrect={false} autoComplete="username" value={loginId} onChangeText={setLoginId} style={[t.body, { minHeight: space.huge, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: space.sm, color: colors.foreground }]} /></View>
      <View style={{ gap: space.xs }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>Password</Text>
        <TextInput accessibilityLabel="Operator password" autoComplete="current-password" secureTextEntry value={password} onChangeText={setPassword} onSubmitEditing={() => void signIn()} style={[t.body, { minHeight: space.huge, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: space.sm, color: colors.foreground }]} /></View>
      {error ? <Text accessibilityRole="alert" style={[t.body, { color: colors.destructive }]}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Sign in to Fadko Desk" accessibilityState={{ disabled: busy, busy }} aria-disabled={busy} aria-busy={busy} disabled={busy} onPress={() => void signIn()} style={{ minHeight: space.huge, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}>
        {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Sign in</Text>}
      </Pressable>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>This workspace is for Fadko operators. Teacher and student accounts cannot sign in here.</Text>
    </View>
  </View>;
}
