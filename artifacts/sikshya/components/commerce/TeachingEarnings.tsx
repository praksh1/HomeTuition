import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { readingWidth } from "@/constants/layout";
import { apiGet } from "@/utils/api";
import { ProgramBackControl, ProgramButton, ProgramCardShell, ProgramNotice } from "@/components/programs/ProgramPieces";
import { BatchTestMoneySummary } from "@/components/classes/BatchTestMoneySummary";

export interface TeachingBillingPolicy {
  legacyPlanSalesOpen: boolean;
  newClassCheckoutOpen: false;
  testPilotEndsAt?: string | null;
  teacherShareBps: number;
  platformShareBps: number;
  studentFeeNpr: number;
  status: "preparing";
}

export function TeachingEarningsContent({ policy, failed, retry }: {
  policy: TeachingBillingPolicy | null; failed: boolean; retry: () => void;
}) {
  const colors = useColors();
  const { t, space, gutter } = useLayout();
  const insets = useSafeAreaInsets();
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: gutter, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.xxl, gap: space.lg, maxWidth: readingWidth, width: "100%", alignSelf: "center" }}>
    <ProgramBackControl label="Back to Profile" testID="billing-back" onPress={() => router.replace("/(teacher)/profile")} />
    <Text accessibilityRole="header" style={[t.title1, { color: colors.foreground }]}>Teaching & earnings</Text>
    {!policy ? <ProgramNotice title={failed ? "Could not load teaching terms" : "Loading teaching terms…"} tone="neutral">
      {failed ? <ProgramButton label="Try again" onPress={retry} /> : null}
    </ProgramNotice> : <>
      <ProgramCardShell>
        <Text style={[t.title2, { color: colors.foreground }]}>Your teaching, your earnings</Text>
        <Text style={[t.body, { color: colors.foreground }]}>Creating a class is free. Set one clear price for students and see your estimated earnings before publishing.</Text>
        <Text style={[t.body, { color: colors.foreground }]}>When you enter a class price and lesson dates, Fadko shows your estimated earnings for each enrolled student and the approximate amount per lesson.</Text>
        <Text style={[t.caption, { color: colors.mutedForeground }]}>Estimates are shown before applicable taxes. Final earnings can change after an approved refund or adjustment. Students pay upfront; eligible earnings are released after lesson delivery and the complaint window.</Text>
        <ProgramButton label="Prepare a class" emphasis="primary" onPress={() => router.push("/(teacher)/create-class")} />
      </ProgramCardShell>
      <ProgramCardShell>
        <Text style={[t.title2, { color: colors.foreground }]}>When will I get paid?</Text>
        <Text style={[t.body, { color: colors.foreground }]}>During testing, bookings and earnings are practice records. No real money is collected or paid out.</Text>
        <Text style={[t.body, { color: colors.mutedForeground }]}>Each original lesson's earnings stay pending until delivery is confirmed and its 48-hour student review window ends. An open dispute or make-up keeps that lesson's share on hold, not your other eligible lessons. A delivered replacement starts a fresh 48-hour review window after delivery is confirmed; it is not a second charge or earning.</Text>
        <Text style={[t.body, { color: colors.mutedForeground }]}>Eligible does not mean paid or transferred to your bank. Fadko will publish the payout schedule, transfer method and processing time before accepting real payments.</Text>
        <ProgramButton label="Ask about earnings" onPress={() => router.push("/support")} />
      </ProgramCardShell>
      <ProgramNotice title={policy.testPilotEndsAt ? "Practice payments" : "Payments are not open yet"} tone="waiting">
        <Text style={[t.body, { color: colors.foreground }]}>{policy.testPilotEndsAt ? "The current test environment uses practice bookings. No money is collected or paid out. Your lesson records and payment breakdown remain available below." : "You can prepare and publish a class. New paid enrollment will open when payment processing is ready; your existing lessons and learning resources remain available."}</Text>
      </ProgramNotice>
      <BatchTestMoneySummary role="teacher" />
    </>}
  </ScrollView>;
}

export default function TeachingEarnings() {
  const [policy, setPolicy] = useState<TeachingBillingPolicy | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    apiGet<TeachingBillingPolicy>("/teachers/me/billing").then((value) => { if (alive) setPolicy(value); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [attempt]);
  return <TeachingEarningsContent policy={policy} failed={failed} retry={() => setAttempt((n) => n + 1)} />;
}
