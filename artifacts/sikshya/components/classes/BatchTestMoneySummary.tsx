import React, { useEffect, useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet } from "@/utils/api";
import {
  participantMoneyStatement,
  participantReceiptStatus,
  participantTestTotals,
  teacherReceiptBreakdown,
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
  const [visible, setVisible] = useState(8);
  if (!rows.length && !empty) return null;
  return <View testID={`money-statement-${title.toLowerCase()}`} style={{ gap: space.xs }}>
    <Text accessibilityRole="header" style={[t.bodyStrong, { color: colors.foreground }]}>{title}</Text>
    {rows.length ? rows.slice(0, visible).map((row) => <StatementRow key={row.id} row={row} />) : <Text style={[t.caption, { color: colors.mutedForeground }]}>{empty}</Text>}
    {rows.length > visible ? <ProgramButton label={`Show more ${title.toLowerCase()} (${rows.length - visible})`} onPress={() => setVisible((count) => count + 8)} /> : null}
  </View>;
}

/** A read-only, participant-scoped summary of simulated payments. */
export function BatchTestMoneySummary({ role }: { role: "student" | "teacher" }) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const [receipts, setReceipts] = useState<ParticipantTestReceipt[] | null>(null);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receiptQuery, setReceiptQuery] = useState("");
  const [visibleReceipts, setVisibleReceipts] = useState(8);

  async function load(cursor?: number) {
    setBusy(true);
    setError("");
    try {
      const result = await apiGet<{ receipts: ParticipantTestReceipt[]; nextCursor?: number | null }>(`/batch-tests/me/payments${cursor ? `?cursor=${cursor}` : ""}`);
      setReceipts((current) => cursor ? [...(current ?? []), ...result.receipts] : result.receipts);
      setNextCursor(result.nextCursor ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load test payment details.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);
  const totals = useMemo(() => participantTestTotals(receipts ?? []), [receipts]);
  const statement = useMemo(() => participantMoneyStatement(receipts ?? [], role), [receipts, role]);
  const matchingReceipts = useMemo(() => {
    const query = receiptQuery.trim().toLocaleLowerCase();
    const ordered = [...(receipts ?? [])].sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || b.bookingId - a.bookingId);
    return query ? ordered.filter((receipt) => `${receipt.classTitle} ${receipt.studentName ?? ""} ${receipt.reference}`.toLocaleLowerCase().includes(query)) : ordered;
  }, [receipts, receiptQuery]);
  if (!busy && !error && receipts?.length === 0) return null;

  return <ProgramCardShell testID={`participant-test-money-${role}`}>
    <View style={{ gap: space.xxs }}>
      <Text accessibilityRole="header" style={[t.title3, { color: colors.foreground }]}>{role === "teacher" ? "Test earnings summary" : "Test payment summary"}</Text>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>Practice records only · no real money moved</Text>
    </View>
    {error ? <ProgramNotice title="Test totals could not be loaded" body={error} tone="stopped">
      <ProgramButton label="Try again" busy={busy} onPress={() => void load(receipts?.length ? nextCursor ?? undefined : undefined)} />
    </ProgramNotice> : null}
    {receipts?.length ? <>
      {nextCursor !== null ? <Text style={[t.caption, { color: colors.mutedForeground }]}>Older receipts are available. Amounts and search below cover loaded records only; load older receipts for more history.</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md, padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSunk }}>
        {role === "teacher" ? <>
          <Metric label="Pending test earnings" value={totals.teacherHeldNpr} />
          <Metric label="Recorded test payout" value={totals.teacherPaidOutNpr} />
          {totals.teacherRefundedNpr > 0 ? <Metric label="Reversed after test refund" value={totals.teacherRefundedNpr} /> : null}
        </> : <>
          <Metric label="Net test payments" value={Math.max(0, totals.grossNpr - totals.refundedGrossNpr)} />
          <Metric label="Test payments" value={totals.grossNpr} />
          <Metric label="Test refunded" value={totals.refundedGrossNpr} />
        </>}
      </View>
      <ProgramNotice title="Testing only" body={`These records show how payments and earnings will look. No real money was ${role === "teacher" ? "paid to you" : "charged"}.`} tone="neutral" />
      <ProgramNotice title={role === "teacher" ? "Why an amount may be on hold" : "How lesson reviews work"} body={role === "teacher"
        ? "A delivered lesson is reviewed for 48 hours after its scheduled end. A dispute holds the affected lesson's share for human review. Make-up requests are handled by Support until the in-app process is ready. Eligibility is not a bank transfer."
        : "Each lesson is tracked separately. You can raise a concern during its 48-hour review window. Fadko reviews disputed lessons before deciding a refund or teacher payout. Contact Support to request a make-up."} tone="neutral" />
      {role === "teacher" ? <View style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[t.title3, { color: colors.foreground }]}>Receipts by student and class</Text>
        <TextInput accessibilityLabel="Search receipts by class, student or reference" placeholder="Search class, student or receipt" placeholderTextColor={colors.mutedForeground} value={receiptQuery} onChangeText={(value) => { setReceiptQuery(value); setVisibleReceipts(8); }} style={[t.body, { color: colors.foreground, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: space.md }]} />
        <Text style={[t.caption, { color: colors.mutedForeground }]}>Showing {Math.min(visibleReceipts, matchingReceipts.length)} of {matchingReceipts.length} matching loaded receipts{nextCursor ? " · Older receipts available" : ""}</Text>
        {matchingReceipts.slice(0, visibleReceipts).map((receipt) => {
          const breakdown = teacherReceiptBreakdown(receipt);
          return <View key={receipt.bookingId} testID={`teacher-receipt-${receipt.bookingId}`} style={{ padding: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, gap: space.xxs }}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>{receipt.classTitle}</Text>
            <Text style={[t.body, { color: colors.foreground }]}>{receipt.studentName ?? "Student name unavailable"}</Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>Receipt {receipt.reference} · {testReceiptNepalTime(receipt.recordedAt)}</Text>
            {breakdown ? <>
              <Text style={[t.body, { color: colors.foreground }]}>Student tuition: NPR {breakdown.tuitionNpr.toLocaleString("en-NP")}</Text>
              <Text style={[t.body, { color: colors.foreground }]}>Fadko commission (30%): − NPR {breakdown.fadkoFeeNpr.toLocaleString("en-NP")}</Text>
              <Text style={[t.bodyStrong, { color: colors.foreground }]}>Your share (70%): NPR {breakdown.teacherShareNpr.toLocaleString("en-NP")}</Text>
            </> : <Text style={[t.caption, { color: colors.mutedForeground }]}>Breakdown unavailable. Contact Support before relying on this receipt.</Text>}
            <Text style={[t.caption, { color: colors.mutedForeground }]}>{participantReceiptStatus(receipt, "teacher")} · Practice record, not a bank transfer</Text>
          </View>;
        })}
        {matchingReceipts.length === 0 ? <Text style={[t.body, { color: colors.mutedForeground }]}>No loaded receipts match that search.{nextCursor ? " Load older receipts to continue searching." : ""}</Text> : null}
        {matchingReceipts.length > visibleReceipts ? <ProgramButton label={`Show more receipts (${matchingReceipts.length - visibleReceipts})`} onPress={() => setVisibleReceipts((count) => count + 8)} /> : null}
      </View> : null}
      <View style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[t.title3, { color: colors.foreground }]}>Transaction history</Text>
        <StatementSection title="Pending" rows={statement.pending} />
        <StatementSection
          title="Posted"
          rows={statement.posted}
          empty={role === "teacher" ? "No test earnings have been posted yet." : "No test payments have been posted yet."}
        />
        {nextCursor !== null ? <ProgramButton label="Load older receipts" busy={busy} onPress={() => void load(nextCursor)} /> : null}
      </View>
    </> : busy ? <Text style={[t.callout, { color: colors.mutedForeground }]}>Loading test totals…</Text> : null}
  </ProgramCardShell>;
}
