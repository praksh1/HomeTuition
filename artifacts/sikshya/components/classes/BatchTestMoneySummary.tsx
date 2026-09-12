import React, { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet } from "@/utils/api";
import {
  participantMoneyStatement,
  participantTestTotals,
  testReceiptNepalTime,
  type ParticipantMoneyStatementRow,
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

function StatementRow({ row }: { row: ParticipantMoneyStatementRow }) {
  const colors = useColors();
  const { t, space, numeric } = useLayout();
  const sign = row.direction === "credit" ? "+ " : row.direction === "debit" ? "− " : "";
  return <View
    testID={`money-transaction-${row.id}`}
    accessibilityRole="summary"
    style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}
  >
    <View style={{ flex: 1, minWidth: 0, gap: space.xxs }}>
      <Text style={[t.bodyStrong, { color: colors.foreground }]}>{row.title}</Text>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>{row.detail}</Text>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>{testReceiptNepalTime(row.occurredAt)}</Text>
    </View>
    <View style={{ flexShrink: 0, alignItems: "flex-end", gap: space.xxs }}>
      <Text
        testID={`money-amount-${row.id}`}
        style={[
          t.bodyStrong,
          numeric,
          {
            color: row.direction === "credit" ? colors.success : row.section === "pending" ? colors.mutedForeground : colors.foreground,
            fontStyle: row.section === "pending" ? "italic" : "normal",
            textAlign: "right",
          },
        ]}
      >{sign}NPR {row.amountNpr.toLocaleString("en-NP")}</Text>
      <Text style={[t.caption, { color: row.section === "pending" ? colors.mutedForeground : colors.foreground, fontStyle: row.section === "pending" ? "italic" : "normal", textAlign: "right" }]}>{row.status}</Text>
    </View>
  </View>;
}

function StatementSection({ title, rows, empty }: { title: string; rows: ParticipantMoneyStatementRow[]; empty?: string }) {
  const colors = useColors();
  const { t, space } = useLayout();
  if (!rows.length && !empty) return null;
  return <View testID={`money-statement-${title.toLowerCase()}`} style={{ gap: space.xs }}>
    <Text accessibilityRole="header" style={[t.bodyStrong, { color: colors.foreground }]}>{title}</Text>
    {rows.length ? rows.map((row) => <StatementRow key={row.id} row={row} />) : <Text style={[t.caption, { color: colors.mutedForeground }]}>{empty}</Text>}
  </View>;
}

/** A read-only, participant-scoped summary of simulated payments. */
export function BatchTestMoneySummary({ role }: { role: "student" | "teacher" }) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
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
  const statement = useMemo(() => participantMoneyStatement(receipts ?? [], role), [receipts, role]);
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
        {role === "teacher" ? <>
          <Metric label="Pending test earnings" value={totals.teacherHeldNpr} />
          <Metric label="Test-paid to you" value={totals.teacherPaidOutNpr} />
          {totals.teacherRefundedNpr > 0 ? <Metric label="Reversed after test refund" value={totals.teacherRefundedNpr} /> : null}
        </> : <>
          <Metric label="Net test payments" value={Math.max(0, totals.grossNpr - totals.refundedGrossNpr)} />
          <Metric label="Test payments" value={totals.grossNpr} />
          <Metric label="Test refunded" value={totals.refundedGrossNpr} />
        </>}
      </View>
      <ProgramNotice title="Testing only" body={`These records show how payments and earnings will look. No real money was ${role === "teacher" ? "paid to you" : "charged"}.`} tone="neutral" />
      <View style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[t.title3, { color: colors.foreground }]}>Transaction history</Text>
        <StatementSection title="Pending" rows={statement.pending} />
        <StatementSection
          title="Posted"
          rows={statement.posted}
          empty={role === "teacher" ? "No test earnings have been posted yet." : "No test payments have been posted yet."}
        />
      </View>
    </> : busy ? <Text style={[t.callout, { color: colors.mutedForeground }]}>Loading test totals…</Text> : null}
  </ProgramCardShell>;
}
