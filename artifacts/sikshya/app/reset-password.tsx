import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiPost } from "@/utils/api";

export default function ResetPassword() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const colors = useColors();
  const { t, gutter, space, radius } = useLayout();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (password.length < 8) { setMessage("Use at least 8 characters."); return; }
    if (password !== confirm) { setMessage("The two passwords do not match."); return; }
    setLoading(true);
    try {
      await apiPost("/auth/password/reset", { token: token ?? "", password });
      setDone(true);
      setMessage("Your password has been changed. You can sign in now.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The password could not be changed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center", padding: gutter, backgroundColor: colors.background }}>
      <View style={{ gap: space.md }}>
        <Text style={[t.title1, { color: colors.foreground }]}>Choose a new password</Text>
        {!done && <>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="New password" placeholderTextColor={colors.inkFaint} style={[t.body, { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: space.md, color: colors.foreground, backgroundColor: colors.card }]} />
          <TextInput value={confirm} onChangeText={setConfirm} secureTextEntry placeholder="Repeat new password" placeholderTextColor={colors.inkFaint} style={[t.body, { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: space.md, color: colors.foreground, backgroundColor: colors.card }]} />
        </>}
        {!!message && <Text style={[t.body, { color: done ? colors.success : colors.destructive }]}>{message}</Text>}
        <TouchableOpacity onPress={done ? () => router.replace("/(auth)/login?role=student") : () => void submit()} disabled={loading} activeOpacity={0.85} style={{ minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}>
          {loading ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>{done ? "Sign in" : "Save new password"}</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
