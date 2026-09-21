import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SocialSignIn } from "@/components/SocialSignIn";
import { AccountDetailsCard } from "@/components/profile/AccountDetailsCard";
import { ProfileActionRow } from "@/components/profile/ProfileActionRow";
import { ProfileHero } from "@/components/profile/ProfileHero";
import SupportAssistantLauncher from "@/components/support/SupportAssistantLauncher";
import { readingWidth } from "@/constants/layout";
import { useAuth, type Student } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

export default function StudentProfile() {
  const { support } = useLocalSearchParams<{ support?: string }>();
  const { user } = useAuth();
  const colors = useColors();
  const { t, space, radius, gutter } = useLayout();
  const insets = useSafeAreaInsets();
  const student = user as Student;
  const styles = createStyles({ colors, space, radius, gutter });

  if (!student || student.role !== "student") return null;

  const initials = student.name.split(" ").map((name) => name[0]).slice(0, 2).join("").toUpperCase();
  const verificationColor = student.emailVerified ? colors.success : colors.warn;
  const verificationBackground = student.emailVerified ? colors.successSoft : colors.warnSoft;

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.container, {
        paddingTop: space.md,
        paddingBottom: insets.bottom + space.huge + space.huge,
      }]}
      showsVerticalScrollIndicator={false}
    >
      <ProfileHero
        eyebrow="MY FADKO PROFILE"
        initials={initials}
        name={student.name}
        subtitle={student.grade || "Grade not added yet"}
        status={{
          icon: student.emailVerified ? "check-circle" : "mail",
          label: student.emailVerified ? "Email verified" : "Email not verified",
          color: verificationColor,
          background: verificationBackground,
        }}
      />

      <AccountDetailsCard email={student.email} role="student" />

      <View style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[t.title3, { color: colors.foreground }]}>Account & payments</Text>
        <ProfileActionRow
          icon="file-text"
          title="Payments & receipts"
          detail="Charges, test payments and refunds"
          onPress={() => router.push("/(student)/payments")}
          testID="student-payments-link"
        />
        <ProfileActionRow
          icon="bell"
          title="Notifications"
          detail="Choose which updates reach you"
          onPress={() => router.push("/notification-settings")}
          testID="notification-settings-link"
        />
      </View>

      <View style={styles.socialRow}><SocialSignIn mode="link" /></View>

    </ScrollView>
    <SupportAssistantLauncher openOnMount={support === "1"} />
    </View>
  );
}

interface StyleOptions {
  colors: ReturnType<typeof useColors>;
  space: ReturnType<typeof useLayout>["space"];
  radius: ReturnType<typeof useLayout>["radius"];
  gutter: number;
}

function createStyles({ colors, space, radius, gutter }: StyleOptions) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    container: { width: "100%", maxWidth: readingWidth, alignSelf: "center", gap: space.md, paddingHorizontal: gutter },
    socialRow: { marginHorizontal: space.xxs },
  });
}
