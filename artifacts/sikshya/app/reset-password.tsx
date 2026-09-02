import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiPost } from "@/utils/api";

/**
 * One password field with its own show/hide control.
 *
 * Its own component so the two fields cannot drift apart, and so each keeps *independent*
 * visibility — revealing the new password must not also reveal the confirmation, or the
 * confirmation stops confirming anything.
 *
 * The label on the button changes between "Show password" and "Hide password" rather than staying
 * a fixed name for an eye icon, because a screen reader announcing "show password" on a field that
 * is already visible is telling the person the opposite of the truth.
 */
function PasswordField({
  label,
  value,
  onChangeText,
  placeholder,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  testID: string;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const [visible, setVisible] = useState(false);

  return (
    <View style={{ gap: space.xxs }}>
      <Text style={[t.bodyStrong, { color: colors.foreground }]}>{label}</Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.sm,
          backgroundColor: colors.card,
          paddingRight: space.xs,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={placeholder}
          placeholderTextColor={colors.inkFaint}
          testID={testID}
          accessibilityLabel={label}
          style={[t.body, { flex: 1, minHeight: 48, paddingHorizontal: space.md, color: colors.foreground }]}
        />
        <TouchableOpacity
          onPress={() => setVisible((v) => !v)}
          // 44 is the smallest reliably tappable target on a phone; the icon alone is 18.
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={visible ? "Hide password" : "Show password"}
          accessibilityState={{ selected: visible }}
          testID={`${testID}-toggle`}
          style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Feather name={visible ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

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
      // The server distinguishes "that is the password you already have" from "this link has
      // expired", and its message is shown as written — sending somebody off for a fresh link
      // when the link was never the problem is the failure this replaces.
      setMessage(error instanceof Error ? error.message : "The password could not be changed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, justifyContent: "center", padding: gutter, backgroundColor: colors.background }}
    >
      <View style={{ gap: space.md }}>
        <Text style={[t.title1, { color: colors.foreground }]}>Choose a new password</Text>

        {!done && (
          <>
            <PasswordField
              label="New password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              testID="reset-password"
            />
            <PasswordField
              label="Repeat new password"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Type it again"
              testID="reset-confirm"
            />
          </>
        )}

        {!!message && (
          <Text style={[t.body, { color: done ? colors.success : colors.destructive }]} testID="reset-message">
            {message}
          </Text>
        )}

        {done && (
          // Stated because it is true and because people assume the opposite. Sikshya's sessions
          // are stateless tokens with nothing to revoke, so a device already signed in stays
          // signed in. See HANDOVER section 8.
          <Text style={[t.caption, { color: colors.mutedForeground }]}>
            Devices already signed in stay signed in. Sign out from any you no longer use.
          </Text>
        )}

        <TouchableOpacity
          onPress={done ? () => router.replace("/(auth)/login?role=student") : () => void submit()}
          disabled={loading}
          activeOpacity={0.85}
          accessibilityRole="button"
          testID="reset-submit"
          style={{ minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}
        >
          {loading
            ? <ActivityIndicator color={colors.primaryForeground} />
            : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>{done ? "Sign in" : "Save new password"}</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
