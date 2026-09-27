import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiPost, setToken, clearToken } from "@/utils/api";

type LoginReply = { token: string; operator: { mustChangePassword: boolean } };

export default function OperatorLogin() {
  const colors = useColors();
  const { t, space, radius, gutter } = useLayout();
  const insets = useSafeAreaInsets();
  const { refreshUser } = useAuth();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signIn = async () => {
    if (busy) return;
    if (!loginId.trim() || !password) { setError("Enter your operator ID and password."); return; }
    setBusy(true);
    setError("");
    try {
      const reply = await apiPost<LoginReply>("/operator/login", { loginId: loginId.trim(), password });
      await setToken(reply.token);
      await refreshUser();
      // The root guard confirms /operator/me and handles the one-time-password step.
    } catch (reason) {
      await clearToken();
      setError(reason instanceof Error ? reason.message : "Could not sign in. Try again.");
    } finally { setBusy(false); }
  };
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, paddingHorizontal: gutter, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }}>
    <View style={{ width: "100%", maxWidth: 440, padding: space.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card, gap: space.md }}>
      <Text style={[t.overline, { color: colors.primary }]}>FADKO · PRIVATE WORKSPACE</Text>
      <Text accessibilityRole="header" style={[t.title1, { color: colors.foreground }]}>Operator sign in</Text>
      <Text style={[t.body, { color: colors.mutedForeground }]}>Use the ID and one-time password issued by your administrator. Teachers and students sign in on Fadko, not here.</Text>
      <View style={{ gap: space.xs }}>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>Operator ID</Text>
        <TextInput accessibilityLabel="Operator ID" autoCapitalize="none" autoCorrect={false} value={loginId} onChangeText={setLoginId} style={[t.body, { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: space.sm, color: colors.foreground }]} />
      </View>
      <View style={{ gap: space.xs }}>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>Password</Text>
        <TextInput accessibilityLabel="Operator password" secureTextEntry value={password} onChangeText={setPassword} onSubmitEditing={() => void signIn()} style={[t.body, { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: space.sm, color: colors.foreground }]} />
      </View>
      {error ? <Text accessibilityRole="alert" style={[t.body, { color: colors.destructive }]}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Sign in to Fadko Desk" disabled={busy} onPress={() => void signIn()} style={{ minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}>
        {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Sign in</Text>}
      </Pressable>
    </View>
  </View>;
}
