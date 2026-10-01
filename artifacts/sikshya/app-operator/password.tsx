import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiPost } from "@/utils/api";

export default function OperatorPassword() {
  const colors = useColors();
  const { t, space, radius, gutter } = useLayout();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (busy) return;
    if (!currentPassword || !newPassword) { setError("Enter your one-time password and a new password."); return; }
    setBusy(true); setError("");
    try {
      await apiPost("/operator/password", { currentPassword, newPassword });
      setCurrentPassword(""); setNewPassword("");
      router.replace("/(admin)" as never);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not change password."); }
    finally { setBusy(false); }
  };
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: gutter, backgroundColor: colors.background }}>
    <View style={{ width: "100%", maxWidth: 440, padding: space.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card, gap: space.md }}>
      <Text accessibilityRole="header" style={[t.title1, { color: colors.foreground }]}>Choose your own password</Text>
      <Text style={[t.body, { color: colors.mutedForeground }]}>Your one-time password cannot be used to work cases. Choose a new password before opening the desk.</Text>
      <TextInput accessibilityLabel="Current one-time password" autoComplete="current-password" placeholder="Current one-time password" placeholderTextColor={colors.mutedForeground} secureTextEntry value={currentPassword} onChangeText={setCurrentPassword} style={[t.body, { minHeight: space.huge, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: space.sm, color: colors.foreground }]} />
      <TextInput accessibilityLabel="New password" autoComplete="new-password" placeholder="New password" placeholderTextColor={colors.mutedForeground} secureTextEntry value={newPassword} onChangeText={setNewPassword} onSubmitEditing={() => void save()} style={[t.body, { minHeight: space.huge, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: space.sm, color: colors.foreground }]} />
      {error ? <Text accessibilityRole="alert" style={[t.body, { color: colors.destructive }]}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Save password and open Fadko Desk" accessibilityState={{ disabled: busy, busy }} aria-disabled={busy} aria-busy={busy} disabled={busy} onPress={() => void save()} style={{ minHeight: space.huge, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}>
        {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Save and open desk</Text>}
      </Pressable>
    </View>
  </View>;
}
