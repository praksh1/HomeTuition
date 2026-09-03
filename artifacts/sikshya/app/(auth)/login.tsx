import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/utils/api";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { SocialSignIn } from "@/components/SocialSignIn";

function showAccessDenied(message: string) {
  if (Platform.OS === "web") window.alert(`Access Denied\n\n${message}`);
  else Alert.alert("Access Denied", message);
}

export default function Login() {
  const { role } = useLocalSearchParams<{ role: "teacher" | "student" }>();
  const resolvedRole = (role === "teacher" || role === "student") ? role : "student";
  const { login, logout } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLayout();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const passwordRef = useRef<TextInput>(null);

  const isTeacher = resolvedRole === "teacher";
  const accentColor = isTeacher ? colors.primary : colors.secondary;

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const loggedInUser = await login(email.trim(), password, resolvedRole);
      setLoading(false);
      if (!loggedInUser) {
        setError("Login failed. Please try again.");
        return;
      }
      /**
       * A support agent goes through whichever door they used.
       *
       * The check below refuses an account whose role does not match the door — which is right
       * for a teacher arriving at the student login, and was quietly fatal for an agent: there
       * is no agent door, so both doors logged them straight back out and the support desk
       * could not be reached at all. The guard in app/_layout.tsx sends them to `(admin)` from
       * here.
       */
      if (loggedInUser.role === "admin") {
        router.replace("/");
        return;
      }
      if (loggedInUser.role !== resolvedRole) {
        await logout();
        const actualHome = loggedInUser.role === "teacher" ? "teacher" : "student";
        showAccessDenied(
          `This account is registered as a ${loggedInUser.role}, not a ${resolvedRole}. Please use the ${actualHome} login instead.`,
        );
        router.replace(loggedInUser.role === "teacher" ? "/(auth)/login?role=teacher" : "/(auth)/login?role=student");
        return;
      }
      if (!loggedInUser.emailVerified) {
        // Signing in sends nothing, so no `sent` or `configured` is passed and the screen says it
        // cannot confirm a link went out. It previously read that silence as a successful send.
        router.replace({ pathname: "/check-email" as never, params: { email: loggedInUser.email } });
        return;
      }
      router.replace("/");
    } catch (e) {
      setLoading(false);
      setError(e instanceof ApiError ? e.message : "Login failed. Please try again.");
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: colors.background }}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>

        <LinearGradient
          colors={isTeacher ? ["#C41E3A15", "#C41E3A05"] : ["#1A365D15", "#1A365D05"]}
          style={[styles.roleTag, { borderColor: accentColor + "30" }]}
        >
          <Feather name={isTeacher ? "book-open" : "users"} size={16} color={accentColor} />
          <Text style={[styles.roleTagText, { color: accentColor }]}>
            {isTeacher ? "Teacher Login" : "Student Login"}
          </Text>
        </LinearGradient>

        <Text style={[styles.title, { color: colors.foreground }]}>Welcome back</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {isTeacher
            ? "Log in to manage your sessions and students"
            : "Log in to discover teachers and join sessions"}
        </Text>

        <View style={styles.form}>
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>Email Address</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Feather name="mail" size={18} color={colors.mutedForeground} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="your@email.com"
                placeholderTextColor={colors.mutedForeground}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                submitBehavior="submit"
              />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <View style={styles.passwordLabelRow}>
              <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
              <TouchableOpacity onPress={() => router.push("/forgot-password" as never)} activeOpacity={0.7}>
                <Text style={[t.caption, { color: accentColor }]}>Forgot password?</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.inputWrapper, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Feather name="lock" size={18} color={colors.mutedForeground} />
              <TextInput
                ref={passwordRef}
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Enter your password"
                placeholderTextColor={colors.mutedForeground}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          </View>

          {!!error && (
            <View style={[styles.errorBox, { backgroundColor: colors.destructive + "10" }]}>
              <Feather name="alert-circle" size={14} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.loginBtn, { backgroundColor: accentColor }, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>or</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          <SocialSignIn mode="login" onSignedIn={() => router.replace("/")} />

          <TouchableOpacity
            style={[styles.registerBtn, { borderColor: accentColor }]}
            onPress={() => router.push(`/(auth)/register?role=${resolvedRole}`)}
            activeOpacity={0.8}
          >
            <Text style={[styles.registerBtnText, { color: accentColor }]}>Create New Account</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchRole}
            onPress={() => router.replace(`/(auth)/login?role=${isTeacher ? "student" : "teacher"}`)}
          >
            <Text style={[styles.switchRoleText, { color: colors.mutedForeground }]}>
              {isTeacher ? "Looking to join as a student?" : "Are you a teacher?"}
              <Text style={{ color: accentColor }}> Switch</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24 },
  backBtn: { alignSelf: "flex-start", padding: 8, marginLeft: -8, marginBottom: 20 },
  roleTag: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-start", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, marginBottom: 20,
  },
  roleTagText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  title: { fontSize: 30, fontFamily: "Inter_700Bold", letterSpacing: -1, marginBottom: 8 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22, marginBottom: 24 },
  form: { gap: 16 },
  fieldGroup: { gap: 8 },
  passwordLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: 14, fontFamily: "Inter_500Medium" },
  inputWrapper: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14,
  },
  input: { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular" },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: 12 },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  loginBtn: { borderRadius: 16, paddingVertical: 17, alignItems: "center", marginTop: 4 },
  btnDisabled: { opacity: 0.7 },
  loginBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  divider: { flexDirection: "row", alignItems: "center", gap: 12 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  registerBtn: { borderRadius: 16, paddingVertical: 16, alignItems: "center", borderWidth: 1.5 },
  registerBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  switchRole: { alignItems: "center", paddingVertical: 8 },
  switchRoleText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
