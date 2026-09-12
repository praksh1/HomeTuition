import React from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BatchTestMoneySummary } from "@/components/classes/BatchTestMoneySummary";
import { ProgramBackControl, ProgramCardShell } from "@/components/programs/ProgramPieces";
import { readingWidth } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

export default function StudentPayments() {
  const colors = useColors();
  const { t, space, gutter } = useLayout();
  const insets = useSafeAreaInsets();

  return <ScrollView
    style={{ flex: 1, backgroundColor: colors.background }}
    contentContainerStyle={{
      width: "100%",
      maxWidth: readingWidth,
      alignSelf: "center",
      gap: space.lg,
      paddingHorizontal: gutter,
      paddingTop: insets.top + space.md,
      paddingBottom: insets.bottom + space.xxl,
    }}
  >
    <ProgramBackControl label="Back to Profile" testID="payments-back" onPress={() => router.replace("/(student)/profile")} />
    <View style={{ gap: space.xs }}>
      <Text accessibilityRole="header" style={[t.title1, { color: colors.foreground }]}>Payments & receipts</Text>
      <Text style={[t.callout, { color: colors.mutedForeground }]}>What you paid, what was refunded, and every receipt—without internal accounting details.</Text>
    </View>
    <BatchTestMoneySummary role="student" />
    <ProgramCardShell>
      <Text style={[t.title3, { color: colors.foreground }]}>Real payments are not open yet</Text>
      <Text style={[t.body, { color: colors.mutedForeground }]}>Only private test-payment records appear here. Fadko does not store a wallet or payment PIN on your profile.</Text>
    </ProgramCardShell>
  </ScrollView>;
}
