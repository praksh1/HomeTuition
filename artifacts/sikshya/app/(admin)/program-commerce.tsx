import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BatchTestLedger } from "@/components/classes/BatchTestLedger";
import { ProgramButton } from "@/components/programs/ProgramPieces";
import { readingWidth } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

export default function PaymentReviewDesk() {
  const colors = useColors();
  const { t, space, radius, gutter } = useLayout();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ width: "100%", maxWidth: readingWidth, alignSelf: "center", padding: gutter, paddingBottom: space.huge * 2, gap: space.xl }}>
        <View style={{ gap: space.xxs }}>
          <Text accessibilityRole="header" style={[t.title1, { color: colors.foreground }]}>Payments</Text>
          <Text style={[t.body, { color: colors.mutedForeground }]}>A clear view of test purchases and held funds. Fadko handles routine lesson updates automatically.</Text>
        </View>

        <View style={{ padding: space.lg, gap: space.sm, borderRadius: radius.md, backgroundColor: colors.actionSoft, borderWidth: 1, borderColor: colors.primary }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Feather name="shield" size={22} color={colors.primary} />
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>Operators handle exceptions, not routine accounting</Text>
          </View>
          <Text style={[t.body, { color: colors.foreground }]}>The classroom record marks a lesson completed. Server time manages the 48-hour review period. A student opens their own support case. Only a disputed or unclear case needs an operator.</Text>
          <ProgramButton emphasis="secondary" label="Open customer-service cases" onPress={() => router.push("/(admin)")} />
        </View>

        <View style={{ padding: space.lg, gap: space.xs, borderRadius: radius.md, backgroundColor: colors.warnSoft, borderWidth: 1, borderColor: colors.warn }}>
          <Text style={[t.bodyStrong, { color: colors.warn }]}>Testing only</Text>
          <Text style={[t.body, { color: colors.foreground }]}>Every amount on this page is simulated. No student was charged, no teacher can be paid, and no refund can move money.</Text>
        </View>

        <BatchTestLedger />
      </ScrollView>
    </SafeAreaView>
  );
}
