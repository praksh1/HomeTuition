import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { readingWidth } from "@/constants/layout";
import { apiGet } from "@/utils/api";
import { ProgramBackControl, ProgramButton, ProgramCardShell, ProgramNotice } from "@/components/programs/ProgramPieces";
import LegacyTeacherPlans from "@/components/legacy/LegacyTeacherPlans";
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
        <Text style={[t.title2, { color: colors.foreground }]}>Teach without buying a tier</Text>
        <Text style={[t.body, { color: colors.foreground }]}>Prepare your class and set its price. New teacher-plan purchases are paused while we connect student payments.</Text>
        <Text style={[t.body, { color: colors.foreground }]}>When you enter a class price and lesson dates, Fadko shows your estimated earnings for each enrolled student and the approximate amount per lesson.</Text>
        <Text style={[t.caption, { color: colors.mutedForeground }]}>Estimates are shown before applicable taxes. Final earnings can change after an approved refund or adjustment. Students pay upfront; eligible earnings are released after lesson delivery and the complaint window.</Text>
        <ProgramButton label="Prepare a class" emphasis="primary" onPress={() => router.push("/(teacher)/create-class")} />
      </ProgramCardShell>
      <ProgramNotice title={policy.testPilotEndsAt ? "Private test bookings are open" : "Listings only for now"} tone="waiting">
        <Text style={[t.body, { color: colors.foreground }]}>{policy.testPilotEndsAt ? "Approved test students can book published classes without payment. Lesson links appear after the first test booking. Test activity creates no earnings or payouts." : "Publishing a new class does not yet collect payment, enrol students or create a live classroom. Your existing classes keep their current access and terms."}</Text>
      </ProgramNotice>
      <BatchTestMoneySummary role="teacher" />
      <ProgramCardShell>
        <Text style={[t.title3, { color: colors.foreground }]}>Your existing teaching continues</Text>
        <Text style={[t.body, { color: colors.foreground }]}>Monthly homework, submissions, feedback and class messages are preserved. We will not move your students or change their purchased terms automatically.</Text>
        <ProgramButton label="Open existing monthly class" emphasis="secondary" onPress={() => router.push("/(teacher)/monthly")} />
        <ProgramButton label="View existing sessions" emphasis="quiet" onPress={() => router.push("/(teacher)/sessions")} />
      </ProgramCardShell>
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
  if (policy?.legacyPlanSalesOpen) return <LegacyTeacherPlans />;
  return <TeachingEarningsContent policy={policy} failed={failed} retry={() => setAttempt((n) => n + 1)} />;
}
