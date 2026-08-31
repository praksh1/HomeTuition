import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiPost } from "@/utils/api";

export default function ForgotPassword() {
  const colors = useColors();
  const { t, gutter, space, radius } = useLayout();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async () => {
    if (!email.trim()) { setMessage("Enter your email address."); return; }
    setLoading(true);
    try {
      const result = await apiPost<{ message: string; emailConfigured: boolean }>("/auth/password/forgot", { email: email.trim() });
      setMessage(result.emailConfigured ? result.message : "Your request was accepted, but email delivery is not configured yet. Please contact Sikshya support.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The request could not be sent.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, paddingHorizontal: gutter, paddingTop: insets.top + space.xl, backgroundColor: colors.background, gap: space.lg }}>
      <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ alignSelf: "flex-start", padding: space.xs }}><Feather name="arrow-left" size={22} color={colors.foreground} /></TouchableOpacity>
      <View style={{ gap: space.sm }}>
        <Text style={[t.title1, { color: colors.foreground }]}>Reset your password</Text>
        <Text style={[t.body, { color: colors.mutedForeground }]}>Enter the email used for Sikshya. We will send a private link if it belongs to a password account.</Text>
      </View>
      <View style={{ gap: space.xs }}>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>Email address</Text>
        <TextInput value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="you@example.com" placeholderTextColor={colors.inkFaint} style={[t.body, { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: space.md, color: colors.foreground, backgroundColor: colors.card }]} />
      </View>
      {!!message && <Text style={[t.caption, { color: colors.mutedForeground }]}>{message}</Text>}
      <TouchableOpacity onPress={() => void submit()} disabled={loading} activeOpacity={0.85} style={{ minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}>
        {loading ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Send reset link</Text>}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}
