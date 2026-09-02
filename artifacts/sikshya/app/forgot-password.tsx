import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiPost } from "@/utils/api";

interface ForgotResult {
  message: string;
  emailConfigured: boolean;
  /** How long before Resend is offered. The server enforces the same limit; this only draws it. */
  resendAfterSeconds?: number;
}

/** Fallback when an older server answers without the field. */
const DEFAULT_RESEND_SECONDS = 60;

export default function ForgotPassword() {
  const colors = useColors();
  const { t, gutter, space, radius } = useLayout();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  /**
   * Whether the request has been accepted.
   *
   * The screen used to leave the field and an immediately active "Send reset link" button sitting
   * there after a successful request, which reads as though nothing happened — so people press it
   * again, and the server quite correctly declines to issue a second token inside a minute, and
   * now nothing happens *twice*. Sent is a different picture, not the same one with a line of text
   * added underneath.
   */
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    timer.current = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [cooldown > 0]);

  const submit = async () => {
    if (!email.trim()) { setMessage("Enter your email address."); return; }
    setLoading(true);
    try {
      const result = await apiPost<ForgotResult>("/auth/password/forgot", { email: email.trim() });
      setSent(true);
      setCooldown(result.resendAfterSeconds ?? DEFAULT_RESEND_SECONDS);
      setMessage(
        result.emailConfigured
          ? result.message
          : "Your request was accepted, but email delivery is not configured yet. Please contact Sikshya support.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The request could not be sent.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, paddingHorizontal: gutter, paddingTop: insets.top + space.xl, backgroundColor: colors.background, gap: space.lg }}
    >
      <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ alignSelf: "flex-start", padding: space.xs }}>
        <Feather name="arrow-left" size={22} color={colors.foreground} />
      </TouchableOpacity>

      <View style={{ gap: space.sm }}>
        <Text style={[t.title1, { color: colors.foreground }]}>
          {sent ? "Check your email" : "Reset your password"}
        </Text>
        <Text style={[t.body, { color: colors.mutedForeground }]}>
          {sent
            ? /*
                Still the enumeration-safe sentence. Saying "we sent it" here would answer
                "does this address have an account?" for anybody who typed one in.
              */
              message
            : "Enter the email used for Sikshya. We will send a private link if it belongs to a password account."}
        </Text>
      </View>

      {sent ? (
        <View style={{ gap: space.md }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: space.sm,
              backgroundColor: colors.successSoft,
              borderRadius: radius.md,
              padding: space.sm,
            }}
            testID="forgot-sent-confirmation"
          >
            <Feather name="mail" size={18} color={colors.success} />
            <Text style={[t.caption, { flex: 1, color: colors.success }]}>
              The link works for 30 minutes. If you ask for another, only the newest one will work.
            </Text>
          </View>

          <TouchableOpacity
            onPress={cooldown > 0 ? undefined : () => void submit()}
            disabled={cooldown > 0 || loading}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ disabled: cooldown > 0 || loading }}
            accessibilityLabel={cooldown > 0 ? `Resend available in ${cooldown} seconds` : "Resend email"}
            testID="forgot-resend"
            style={{
              minHeight: 48,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: cooldown > 0 ? colors.border : colors.primary,
              backgroundColor: colors.surface,
            }}
          >
            {loading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={[t.bodyStrong, { color: cooldown > 0 ? colors.mutedForeground : colors.primary }]}>
                {cooldown > 0 ? `Resend email in ${cooldown}s` : "Resend email"}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.replace("/(auth)/login?role=student")}
            activeOpacity={0.85}
            accessibilityRole="button"
            style={{ minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}
          >
            <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Back to sign in</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={{ gap: space.xs }}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>Email address</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="you@example.com"
              placeholderTextColor={colors.inkFaint}
              testID="forgot-email"
              style={[t.body, { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: space.md, color: colors.foreground, backgroundColor: colors.card }]}
            />
          </View>
          {!!message && <Text style={[t.caption, { color: colors.destructive }]}>{message}</Text>}
          <TouchableOpacity
            onPress={() => void submit()}
            disabled={loading}
            activeOpacity={0.85}
            accessibilityRole="button"
            testID="forgot-submit"
            style={{ minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}
          >
            {loading ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Send reset link</Text>}
          </TouchableOpacity>
        </>
      )}
    </KeyboardAvoidingView>
  );
}
