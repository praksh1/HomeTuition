import React, { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet } from "@/utils/api";
import {
  participantTestTotals,
  type ParticipantTestReceipt,
} from "@/utils/batchTestMoney";
import { ProgramButton, ProgramCardShell, ProgramNotice } from "../programs/ProgramPieces";

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
  const { t, space, radius } = useLayout();
  const [receipts, setReceipts] = useState<ParticipantTestReceipt[] | null>(null);
  const [open, setOpen] = useState(false);
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
        <Metric label={role === "teacher" ? "Student test payments" : "Test payment total"} value={totals.grossNpr} />
        <Metric label="Held by Fadko" value={totals.heldGrossNpr} />
        {role === "teacher" ? <>
          <Metric label="Your share still held" value={totals.teacherHeldNpr} />
          <Metric label="Test-paid to you" value={totals.teacherPaidOutNpr} />
        </> : <Metric label="Test refunded" value={totals.refundedGrossNpr} />}
      </View>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>Actual money {role === "teacher" ? "received" : "charged"}: NPR {totals.actualMoneyMovedNpr.toLocaleString("en-NP")}</Text>
      <ProgramButton emphasis="quiet" label={open ? "Hide receipt details" : `View ${receipts.length} test ${receipts.length === 1 ? "receipt" : "receipts"}`} onPress={() => setOpen(!open)} />
      {open ? <View style={{ gap: space.sm }}>
        {receipts.map((receipt) => <View key={receipt.bookingId} accessibilityRole="summary" style={{ gap: space.xxs, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text style={[t.bodyStrong, { color: colors.foreground }]}>{receipt.classTitle}</Text>
          {role === "teacher" ? <Text style={[t.caption, { color: colors.mutedForeground }]}>Student: {receipt.studentName}</Text> : null}
          <Text style={[t.caption, { color: colors.mutedForeground }]}>TEST receipt {receipt.reference} · NPR {receipt.grossNpr.toLocaleString("en-NP")}</Text>
        </View>)}
      </View> : null}
    </> : busy ? <Text style={[t.callout, { color: colors.mutedForeground }]}>Loading test totals…</Text> : null}
  </ProgramCardShell>;
}
