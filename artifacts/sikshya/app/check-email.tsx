import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiPost } from "@/utils/api";

export default function CheckEmail() {
  const params = useLocalSearchParams<{ email?: string; sent?: string; configured?: string }>();
  const { user } = useAuth();
  const colors = useColors();
  const { t, gutter, space, radius } = useLayout();
  const insets = useSafeAreaInsets();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState(
    params.sent === "0" || params.configured === "0"
      ? "Email delivery is not configured on the server yet. Your account is saved, but Sikshya support must finish email setup before the link can arrive."
      : "We sent a verification link. It is valid for 24 hours.",
  );

  const resend = async () => {
    setSending(true);
    try {
      await apiPost("/auth/verification/resend", {});
      setMessage("A new verification link has been sent. Check spam or junk if it is not in your inbox.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The email could not be sent. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const email = params.email ?? user?.email ?? "your email address";
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        paddingHorizontal: gutter,
        paddingTop: insets.top + space.xl,
        paddingBottom: insets.bottom + space.xl,
      }}
    >
      <View style={{ alignItems: "center", gap: space.md }}>
        <View style={{ padding: space.md, borderRadius: radius.pill, backgroundColor: colors.actionSoft }}>
          <Feather name="mail" size={32} color={colors.primary} />
        </View>
        <Text style={[t.title1, { color: colors.foreground, textAlign: "center" }]}>Verify your email</Text>
        <Text style={[t.body, { color: colors.mutedForeground, textAlign: "center" }]}>We use this to protect your account and deliver password-reset and review messages.</Text>
        <View style={{ width: "100%", padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, gap: space.xs }}>
          <Text style={[t.bodyStrong, { color: colors.foreground }]}>{email}</Text>
          <Text style={[t.caption, { color: colors.mutedForeground }]}>{message}</Text>
        </View>
        <TouchableOpacity
          onPress={() => void resend()}
          disabled={sending}
          activeOpacity={0.85}
          style={{ width: "100%", minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}
        >
          {sending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Send another link</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace("/")} activeOpacity={0.75} style={{ padding: space.sm }}>
          <Text style={[t.bodyStrong, { color: colors.primary }]}>Continue to my account</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
