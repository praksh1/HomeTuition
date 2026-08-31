import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
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

const SUBJECTS = [
  "Mathematics", "Science", "English", "Nepali", "Social Studies",
  "Computer Science", "History", "Geography", "Economics", "Accountancy",
];

const GRADES = ["Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12", "College"];

export default function Register() {
  const { role } = useLocalSearchParams<{ role: "teacher" | "student" }>();
  const resolvedRole = role === "teacher" ? "teacher" : "student";
  const { register: doRegister } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [subject, setSubject] = useState("");
  const [bio, setBio] = useState("");
  const [grade, setGrade] = useState("Grade 10");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [guardianRelationship, setGuardianRelationship] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isTeacher = resolvedRole === "teacher";
  const accentColor = isTeacher ? colors.primary : colors.secondary;
  const birthYear = Number(dateOfBirth.slice(0, 4));
  const isMinor = !isTeacher && /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) && new Date().getFullYear() - birthYear < 18;

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError("Please fill all required fields");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (isTeacher && !subject) {
      setError("Please select your subject specialization");
      return;
    }
    if (isTeacher && !bio.trim()) {
      setError("Please write a short bio so students know why to learn with you");
      return;
    }
    if (!isTeacher && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      setError("Please enter the student's date of birth as YYYY-MM-DD");
      return;
    }
    if (isMinor && (!guardianName.trim() || !guardianEmail.trim() || !guardianPhone.trim() || !guardianRelationship.trim())) {
      setError("A parent or guardian must complete all guardian fields for a student under 18");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await doRegister({
        name: name.trim(), email: email.trim(), password, role: resolvedRole, subject, bio, grade,
        dateOfBirth, guardianName, guardianEmail, guardianPhone, guardianRelationship,
      });
      setLoading(false);
      if (result.success) {
        router.replace({
          pathname: "/check-email" as never,
          params: {
            email: email.trim(),
            sent: result.verificationEmailSent ? "1" : "0",
            configured: result.emailConfigured ? "1" : "0",
          },
        });
      }
    } catch (e) {
      setLoading(false);
      setError(e instanceof ApiError ? e.message : "Registration failed. Please try again.");
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

        <Text style={[styles.title, { color: colors.foreground }]}>
          {isTeacher ? "Join as a Teacher" : "Join as a Student"}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {isTeacher
            ? "Create your account to start teaching on Sikshya"
            : "Join thousands of students learning with Nepal's best teachers"}
        </Text>

        {isTeacher && (
          <View style={[styles.infoBox, { backgroundColor: colors.accent + "12", borderColor: colors.accent + "30" }]}>
            <Feather name="shield" size={15} color={colors.accent} />
            <Text style={[styles.infoText, { color: colors.accentForeground }]}>
              After registering, you'll need to upload your identity documents and credentials for verification before you can start teaching.
            </Text>
          </View>
        )}

        <View style={styles.form}>
          {!isTeacher && (
            <>
              <Field label="Student's Date of Birth *" icon="calendar" value={dateOfBirth} onChange={setDateOfBirth} placeholder="YYYY-MM-DD" colors={colors} />
              <Text style={[styles.infoText, { color: colors.mutedForeground }]}>We ask this first because a parent or guardian must create the account for a student under 18.</Text>
              {isMinor && (
                <View style={[styles.guardianBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
                  <Text style={[styles.label, { color: colors.foreground }]}>Parent or guardian details</Text>
                  <Field label="Guardian's full name *" icon="user" value={guardianName} onChange={setGuardianName} placeholder="Full name" colors={colors} />
                  <Field label="Guardian's email *" icon="mail" value={guardianEmail} onChange={setGuardianEmail} placeholder="parent@example.com" keyboardType="email-address" colors={colors} />
                  <Field label="Guardian's phone *" icon="phone" value={guardianPhone} onChange={setGuardianPhone} placeholder="+977…" keyboardType="phone-pad" colors={colors} />
                  <Field label="Relationship *" icon="users" value={guardianRelationship} onChange={setGuardianRelationship} placeholder="Parent, guardian, aunt…" colors={colors} />
                </View>
              )}
            </>
          )}
          <Field label="Full Name" icon="user" value={name} onChange={setName} placeholder="Your full name" colors={colors} />
          <Field label="Email Address" icon="mail" value={email} onChange={setEmail} placeholder="your@email.com" keyboardType="email-address" colors={colors} />
          <Field label="Password" icon="lock" value={password} onChange={setPassword} placeholder="Create a strong password" secure colors={colors} />
          <Field label="Confirm Password" icon="lock" value={confirmPassword} onChange={setConfirmPassword} placeholder="Repeat your password" secure colors={colors} />

          {isTeacher && (
            <>
              <View style={styles.fieldGroup}>
                <Text style={[styles.label, { color: colors.foreground }]}>Subject Specialization *</Text>
                <View style={styles.chipGrid}>
                  {SUBJECTS.map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.chip, { borderColor: subject === s ? accentColor : colors.border, backgroundColor: subject === s ? accentColor + "15" : colors.muted }]}
                      onPress={() => setSubject(s)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.chipText, { color: subject === s ? accentColor : colors.mutedForeground }]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={[styles.label, { color: colors.foreground }]}>Brief Bio *</Text>
                <Text style={[styles.infoText, { color: colors.mutedForeground }]}>Students use this to decide whether your experience and teaching style fit them.</Text>
                <View style={[styles.inputWrapper, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.input, styles.textArea, { color: colors.foreground }]}
                    placeholder="Tell students about your experience and teaching style..."
                    placeholderTextColor={colors.mutedForeground}
                    value={bio}
                    onChangeText={setBio}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                </View>
              </View>
            </>
          )}

          {!isTeacher && (
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.foreground }]}>Current Grade / Level *</Text>
              <View style={styles.chipGrid}>
                {GRADES.map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={[styles.chip, { borderColor: grade === g ? accentColor : colors.border, backgroundColor: grade === g ? accentColor + "15" : colors.muted }]}
                    onPress={() => setGrade(g)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, { color: grade === g ? accentColor : colors.mutedForeground }]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {!!error && (
            <View style={[styles.errorBox, { backgroundColor: colors.destructive + "10" }]}>
              <Feather name="alert-circle" size={14} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.registerBtn, { backgroundColor: accentColor }, loading && styles.btnDisabled]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.registerBtnText}>Create Account</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.loginLink} onPress={() => router.back()}>
            <Text style={[styles.loginLinkText, { color: colors.mutedForeground }]}>
              Already have an account?{" "}
              <Text style={{ color: accentColor }}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label, icon, value, onChange, placeholder, secure = false, keyboardType = "default", colors, multiline = false,
}: {
  label: string; icon: string; value: string; onChange: (v: string) => void;
  placeholder: string; secure?: boolean; keyboardType?: string; colors: ReturnType<typeof import("@/hooks/useColors").useColors>; multiline?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <View style={[styles.inputWrapper, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        <Feather name={icon as "user"} size={18} color={colors.mutedForeground} />
        <TextInput
          style={[styles.input, { color: colors.foreground }]}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          value={value}
          onChangeText={onChange}
          secureTextEntry={secure && !show}
          keyboardType={keyboardType as "email-address"}
          autoCapitalize="none"
          autoCorrect={false}
          multiline={multiline}
        />
        {secure && (
          <TouchableOpacity onPress={() => setShow(!show)}>
            <Feather name={show ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24 },
  backBtn: { alignSelf: "flex-start", padding: 8, marginLeft: -8, marginBottom: 20 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.8, marginBottom: 8 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22, marginBottom: 20 },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 20 },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  form: { gap: 16 },
  guardianBox: { gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  fieldGroup: { gap: 8 },
  label: { fontSize: 14, fontFamily: "Inter_500Medium" },
  inputWrapper: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14 },
  input: { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular" },
  textArea: { minHeight: 80, paddingTop: 4 },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: 12 },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  registerBtn: { borderRadius: 16, paddingVertical: 17, alignItems: "center", marginTop: 4 },
  btnDisabled: { opacity: 0.7 },
  registerBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  loginLink: { alignItems: "center", paddingVertical: 8 },
  loginLinkText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
