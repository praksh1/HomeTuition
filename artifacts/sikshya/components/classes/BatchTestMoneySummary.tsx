import React, { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet } from "@/utils/api";
import {
  participantReceiptStatus,
  participantTestTotals,
  testReceiptNepalTime,
  type ParticipantTestReceipt,
} from "@/utils/batchTestMoney";
import { ProgramButton, ProgramCardShell, ProgramChip, ProgramNotice } from "../programs/ProgramPieces";

function Money({ value }: { value: number }) {
  const colors = useColors();
  const { t, numeric } = useLayout();
  return <Text style={[t.title3, numeric, { color: colors.foreground }]}>NPR {value.toLocaleString("en-NP")}</Text>;
}

function Metric({ label, value }: { label: string; value: number }) {
  const colors = useColors();
  const { t, space } = useLayout();
  return <View style={{ flexBasis: "46%", flexGrow: 1, gap: space.xxs }}>
    <Text style={[t.caption, { color: colors.mutedForeground }]}>{label}</Text>
    <Money value={value} />
  </View>;
}

/** A read-only, participant-scoped summary of simulated payments. */
export function BatchTestMoneySummary({ role }: { role: "student" | "teacher" }) {
  const colors = useColors();
  const { t, space, radius, numeric } = useLayout();
  const [receipts, setReceipts] = useState<ParticipantTestReceipt[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError("");
    try {
      const result = await apiGet<{ receipts: ParticipantTestReceipt[] }>("/batch-tests/me/payments");
      setReceipts(result.receipts);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load test payment details.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);
  const totals = useMemo(() => participantTestTotals(receipts ?? []), [receipts]);
  if (!busy && !error && receipts?.length === 0) return null;

  return <ProgramCardShell testID={`participant-test-money-${role}`}>
    <View style={{ gap: space.xxs }}>
      <Text accessibilityRole="header" style={[t.title3, { color: colors.foreground }]}>{role === "teacher" ? "Test earnings summary" : "Test payment summary"}</Text>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>Practice records only · no real money moved</Text>
    </View>
    {error ? <ProgramNotice title="Test totals could not be loaded" body={error} tone="stopped">
      <ProgramButton label="Try again" busy={busy} onPress={() => void load()} />
    </ProgramNotice> : null}
    {receipts?.length ? <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md, padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSunk }}>
        <Metric label={role === "teacher" ? "Expected test earnings" : "Test payments"} value={role === "teacher" ? totals.teacherShareNpr : totals.grossNpr} />
        {role === "teacher" ? <>
          <Metric label="Pending test earnings" value={totals.teacherHeldNpr} />
          <Metric label="Test-paid to you" value={totals.teacherPaidOutNpr} />
          {totals.teacherRefundedNpr > 0 ? <Metric label="Reversed after test refund" value={totals.teacherRefundedNpr} /> : null}
        </> : <>
          <Metric label="Test refunded" value={totals.refundedGrossNpr} />
          <Metric label="Net test payments" value={Math.max(0, totals.grossNpr - totals.refundedGrossNpr)} />
        </>}
      </View>
      <ProgramNotice title="Testing only" body={`These records show how payments and earnings will look. No real money was ${role === "teacher" ? "paid to you" : "charged"}.`} tone="neutral" />
      <View style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[t.bodyStrong, { color: colors.foreground }]}>History</Text>
        {receipts.map((receipt) => <View key={receipt.bookingId} accessibilityRole="summary" style={{ gap: space.xxs, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs }}>
            <Text style={[t.bodyStrong, { color: colors.foreground, flexGrow: 1, flexShrink: 1 }]}>{receipt.classTitle}</Text>
            <ProgramChip label={participantReceiptStatus(receipt, role)} />
          </View>
          {role === "teacher" ? <Text style={[t.caption, { color: colors.mutedForeground }]}>Student: {receipt.studentName ?? "Name unavailable"}</Text> : null}
          <Text style={[t.caption, { color: colors.mutedForeground }]}>{testReceiptNepalTime(receipt.recordedAt)}</Text>
          <Text style={[t.callout, numeric, { color: colors.foreground }]}>
            {role === "teacher" ? "Your expected test earnings" : "Test payment"}: NPR {(role === "teacher"
              ? receipt.allocations.reduce((sum, allocation) => sum + (allocation.teacherNpr ?? 0), 0)
              : receipt.grossNpr ?? 0).toLocaleString("en-NP")}
          </Text>
          {role === "student" && (receipt.accounting.refundedGrossNpr ?? 0) > 0 ? <Text style={[t.caption, numeric, { color: colors.foreground }]}>Test refunded: NPR {(receipt.accounting.refundedGrossNpr ?? 0).toLocaleString("en-NP")}</Text> : null}
          <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>Test receipt {receipt.reference}</Text>
        </View>)}
      </View>
    </> : busy ? <Text style={[t.callout, { color: colors.mutedForeground }]}>Loading test totals…</Text> : null}
  </ProgramCardShell>;
}
