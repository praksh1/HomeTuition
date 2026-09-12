import React, { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet } from "@/utils/api";
import {
  PROGRAM_ALLOCATION_STATE_LABELS,
  orderedProgramCommerceHistory,
  programCommerceEventLabel,
  programCommerceNepalTime,
  type ProgramCommerceHistoryEntry,
} from "@/utils/programCommerceHistory";
import { ProgramButton, ProgramNotice } from "../programs/ProgramPieces";

interface TestAllocation {
  position: number;
  grossNpr: number;
  teacherNpr: number;
  fadkoNpr: number;
  state: string;
}
interface TestHistory extends ProgramCommerceHistoryEntry { position: number }
interface Receipt {
  bookingId: number;
  reference: string;
  classTitle: string;
  studentName: string;
  recordedAt: string;
  grossNpr: number;
  teacherNpr: number;
  fadkoNpr: number;
  needsAttention: boolean;
  allocations: TestAllocation[];
  history: TestHistory[];
  accounting: {
    heldGrossNpr: number;
    teacherPaidOutNpr: number;
    fadkoEarnedNpr: number;
    refundedGrossNpr: number;
    actualMoneyMovedNpr: number;
  };
}

export function BatchTestLedger() {
  const colors = useColors();
  const { t, space, radius, numeric } = useLayout();
  const [rows, setRows] = useState<Receipt[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setBusy(true); setError("");
    try { setRows((await apiGet<{ receipts: Receipt[] }>("/admin/batch-test-payments")).receipts); }
    catch (reason) { setRows(null); setError(reason instanceof Error ? reason.message : "Could not load test receipts."); }
    finally { setBusy(false); }
  }

  return <View style={{ gap: space.sm }}>
    <Text accessibilityRole="header" style={[t.bodyStrong, { color: colors.foreground }]}>Test payment overview</Text>
    <Text style={[t.caption, { color: colors.mutedForeground }]}>Fadko updates these lesson states from the classroom record, server time and student support cases. Operators do not mark ordinary lessons delivered or open and close review windows.</Text>
    <ProgramButton label={busy ? "Checking…" : rows ? "Refresh overview" : "View test payments"} disabled={busy} onPress={() => void load()} />
    {error ? <ProgramNotice title="Could not refresh test payments" body={error} tone="stopped" /> : null}
    {rows?.length === 0 ? <Text style={[t.callout, { color: colors.mutedForeground }]}>No simulated class payments recorded yet.</Text> : null}
    {rows?.map((receipt) => {
      const expanded = open === receipt.bookingId;
      return <ProgramNotice key={receipt.reference} title={`TEST · ${receipt.reference}`}>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>{receipt.classTitle}</Text>
        <Text style={[t.callout, { color: colors.foreground }]}>{receipt.studentName} · {programCommerceNepalTime(receipt.recordedAt)}</Text>
        <Text style={[t.callout, numeric, { color: colors.foreground }]}>Pretend purchase: NPR {receipt.grossNpr.toLocaleString("en-NP")}</Text>
        <View style={{ gap: space.xxs, padding: space.sm, borderRadius: radius.sm, backgroundColor: receipt.needsAttention ? colors.warnSoft : colors.successSoft }}>
          <Text style={[t.bodyStrong, { color: receipt.needsAttention ? colors.warn : colors.success }]}>{receipt.needsAttention ? "Needs customer-service attention" : "No operator action needed"}</Text>
          <Text style={[t.caption, { color: colors.foreground }]}>{receipt.needsAttention ? "A cancellation or student complaint needs a person to review the support case." : "The system is waiting for the lesson, review window or provider confirmation."}</Text>
        </View>
        <View style={{ gap: space.xxs, padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSunk }}>
          <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>Still held · NPR {receipt.accounting.heldGrossNpr.toLocaleString("en-NP")}</Text>
          <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>Test-paid to teacher · NPR {receipt.accounting.teacherPaidOutNpr.toLocaleString("en-NP")}</Text>
          <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>Test-earned by Fadko · NPR {receipt.accounting.fadkoEarnedNpr.toLocaleString("en-NP")}</Text>
          <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>Test-refunded to student · NPR {receipt.accounting.refundedGrossNpr.toLocaleString("en-NP")}</Text>
        </View>
        <Text style={[t.caption, { color: colors.mutedForeground }]}>Actual money moved: NPR {receipt.accounting.actualMoneyMovedNpr}. This ledger cannot trigger a real payout or refund.</Text>
        {receipt.needsAttention ? <ProgramButton emphasis="primary" label="Open support cases" onPress={() => router.push("/(admin)")} /> : null}
        <ProgramButton emphasis="quiet" label={expanded ? "Hide lesson details" : "View lesson details"} onPress={() => { setOpen(expanded ? null : receipt.bookingId); setError(""); }} />
        {expanded ? <View style={{ gap: space.md }}>
          {receipt.allocations.map((allocation) => <View key={allocation.position} style={{ gap: space.xs, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>Lesson {allocation.position + 1} · NPR {allocation.grossNpr.toLocaleString("en-NP")}</Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>{PROGRAM_ALLOCATION_STATE_LABELS[allocation.state] ?? "Recorded state unavailable"}</Text>
            <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>Teacher NPR {allocation.teacherNpr.toLocaleString("en-NP")} · Fadko NPR {allocation.fadkoNpr.toLocaleString("en-NP")}</Text>
          </View>)}
          {receipt.history.length ? <View style={{ gap: space.xs }}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>Decision history</Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>Oldest first · Nepal time · records cannot be edited or deleted</Text>
            {orderedProgramCommerceHistory(receipt.history).map((entry) => <View key={entry.id} style={{ gap: space.xxs, padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSunk }}>
              <Text style={[t.callout, { color: colors.foreground }]}>Lesson {entry.position + 1} · {programCommerceEventLabel(entry.event)}</Text>
              <Text style={[t.caption, { color: colors.mutedForeground }]}>{programCommerceNepalTime(entry.createdAt)}</Text>
              {entry.detail?.note ? <Text style={[t.caption, { color: colors.foreground }]}>Reason: {entry.detail.note}</Text> : null}
            </View>)}
          </View> : null}
        </View> : null}
      </ProgramNotice>;
    })}
  </View>;
}
