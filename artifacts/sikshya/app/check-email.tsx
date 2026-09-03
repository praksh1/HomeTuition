import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiPost } from "@/utils/api";
import {
  noticeFromParams,
  noticeFromResend,
  noticeFromResendError,
  type VerificationNotice,
  type VerificationTone,
} from "@/utils/verificationMessage";

export default function CheckEmail() {
  const params = useLocalSearchParams<{ email?: string; sent?: string; configured?: string }>();
  const { user } = useAuth();
  const colors = useColors();
  const { t, gutter, space, radius } = useLayout();
  const insets = useSafeAreaInsets();
  const [sending, setSending] = useState(false);

  /**
   * What a resend told us, once one has been attempted. `null` until then.
   *
   * Kept separate from the route's own reading rather than seeding one state from the other: the
   * route describes what happened *before* this screen opened, a resend describes what happened
   * on it, and collapsing them is how a stale parameter ends up outliving a fresher answer.
   */
  const [resent, setResent] = useState<VerificationNotice | null>(null);

  /**
   * The screen's claim, derived rather than defaulted.
   *
   * This was a `useState` initialised to "We sent a verification link." whenever the parameters
   * were anything other than an explicit zero — and the screen is reached without parameters far
   * more often than with them. See `utils/verificationMessage.ts`.
   */
  const fromRoute = useMemo(
    () => noticeFromParams(params.sent, params.configured),
    [params.sent, params.configured],
  );
  const notice = resent ?? fromRoute;

  /** Tone to token. The only place a colour is chosen; the helper stays free of presentation. */
  const toneColor: Record<VerificationTone, string> = {
    sent: colors.success,
    verified: colors.success,
    unknown: colors.mutedForeground,
    unconfigured: colors.warn,
    failed: colors.destructive,
  };

  const toneIcon: Record<VerificationTone, keyof typeof Feather.glyphMap> = {
    sent: "send",
    verified: "check-circle",
    unknown: "help-circle",
    unconfigured: "alert-triangle",
    failed: "alert-circle",
  };

  const resend = async () => {
    setSending(true);
    try {
      // The body matters: the route answers 200 with { verified: true, sent: false } for an address
      // that is already verified, and a screen that reads only the status code announces a link it
      // never sent.
      const body = await apiPost<{ verified?: boolean; sent?: boolean }>("/auth/verification/resend", {});
      setResent(noticeFromResend(body));
    } catch (error) {
      setResent(noticeFromResendError(error));
    } finally {
      setSending(false);
    }
  };

  const email = params.email ?? user?.email ?? "your email address";
  const alreadyVerified = notice.tone === "verified";

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
        <Text style={[t.body, { color: colors.mutedForeground, textAlign: "center" }]}>
          We use this to protect your account and deliver password-reset and review messages.
        </Text>

        <View
          style={{
            width: "100%",
            padding: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            gap: space.xs,
          }}
        >
          <Text style={[t.bodyStrong, { color: colors.foreground }]}>{email}</Text>
          {/*
            The state is carried in an icon as well as a colour, so it still reads for somebody who
            cannot separate the two — and so "nothing was sent" is not merely a paler shade of
            "sent".
          */}
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.xs }}>
            <Feather
              name={toneIcon[notice.tone]}
              size={16}
              color={toneColor[notice.tone]}
              style={{ marginTop: 2 }}
            />
            <Text testID="verification-notice" style={[t.caption, { flex: 1, color: toneColor[notice.tone] }]}>
              {notice.text}
            </Text>
          </View>
        </View>

        {/*
          Hidden once the server has said the address is already verified: a button offering to send
          another link, on a screen that has just explained none was needed, is an invitation to
          keep pressing it.
        */}
        {!alreadyVerified && (
          <TouchableOpacity
            onPress={() => void resend()}
            disabled={sending}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ disabled: sending }}
            testID="verification-resend"
            style={{
              width: "100%",
              minHeight: 48,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.sm,
              backgroundColor: colors.primary,
            }}
          >
            {sending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Send another link</Text>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={() => router.replace("/")}
          activeOpacity={0.75}
          accessibilityRole="button"
          testID="verification-continue"
          style={{ padding: space.sm }}
        >
          <Text style={[t.bodyStrong, { color: colors.primary }]}>Continue to my account</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
