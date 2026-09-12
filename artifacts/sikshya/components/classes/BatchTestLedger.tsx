import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { ApiError, apiGet, apiPost } from "@/utils/api";
import { PROGRAM_COMMERCE_NEXT } from "@/utils/programCommerceActions";
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
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setBusy(true); setError("");
    try { setRows((await apiGet<{ receipts: Receipt[] }>("/admin/batch-test-payments")).receipts); }
    catch (reason) { setRows(null); setError(reason instanceof Error ? reason.message : "Could not load test receipts."); }
    finally { setBusy(false); }
  }

  async function apply(receipt: Receipt, allocation: TestAllocation, event: string, needsReason: boolean) {
    if (needsReason && !note.trim()) {
      setError("Write the decision reason before applying that complaint or refund action.");
      return;
    }
    setBusy(true); setError("");
    try {
      await apiPost(`/admin/batch-test-payments/${receipt.bookingId}/allocations/${allocation.position}/events`, { event, note });
      setNote("");
      await load();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "The simulated ledger could not be updated. No money moved.");
    } finally { setBusy(false); }
  }

  return <View style={{ gap: space.sm }}>
    <Text accessibilityRole="header" style={[t.bodyStrong, { color: colors.foreground }]}>Class checkout · test ledger</Text>
    <Text style={[t.caption, { color: colors.mutedForeground }]}>Student test purchases, lesson holds, refunds and payouts. Every rupee here is pretend.</Text>
    <ProgramButton label={busy ? "Loading…" : rows ? "Refresh test receipts" : "Show test receipts"} disabled={busy} onPress={() => void load()} />
    {error ? <ProgramNotice title="Could not complete that rehearsal" body={error} tone="stopped" /> : null}
    {rows?.length === 0 ? <Text style={[t.callout, { color: colors.mutedForeground }]}>No simulated class payments recorded yet.</Text> : null}
    {rows?.map((receipt) => {
      const expanded = open === receipt.bookingId;
      return <ProgramNotice key={receipt.reference} title={`TEST · ${receipt.reference}`}>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>{receipt.classTitle}</Text>
        <Text style={[t.callout, { color: colors.foreground }]}>{receipt.studentName} · {programCommerceNepalTime(receipt.recordedAt)}</Text>
        <Text style={[t.callout, numeric, { color: colors.foreground }]}>Pretend purchase: NPR {receipt.grossNpr.toLocaleString("en-NP")}</Text>
        <View style={{ gap: space.xxs, padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSunk }}>
          <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>Still held · NPR {receipt.accounting.heldGrossNpr.toLocaleString("en-NP")}</Text>
          <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>Test-paid to teacher · NPR {receipt.accounting.teacherPaidOutNpr.toLocaleString("en-NP")}</Text>
          <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>Test-earned by Fadko · NPR {receipt.accounting.fadkoEarnedNpr.toLocaleString("en-NP")}</Text>
          <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>Test-refunded to student · NPR {receipt.accounting.refundedGrossNpr.toLocaleString("en-NP")}</Text>
        </View>
        <Text style={[t.caption, { color: colors.mutedForeground }]}>Actual money moved: NPR {receipt.accounting.actualMoneyMovedNpr}. This ledger cannot trigger a real payout or refund.</Text>
        <ProgramButton emphasis="quiet" label={expanded ? "Hide lesson decisions" : "Review lesson decisions"} onPress={() => { setOpen(expanded ? null : receipt.bookingId); setError(""); }} />
        {expanded ? <View style={{ gap: space.md }}>
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            placeholder="Decision reason (required when approving or declining a complaint/refund)"
            placeholderTextColor={colors.inkFaint}
            style={[t.body, { minHeight: space.huge * 2, padding: space.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card, textAlignVertical: "top" }]}
          />
          {receipt.allocations.map((allocation) => <View key={allocation.position} style={{ gap: space.xs, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>Lesson {allocation.position + 1} · NPR {allocation.grossNpr.toLocaleString("en-NP")}</Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>{PROGRAM_ALLOCATION_STATE_LABELS[allocation.state] ?? "Recorded state unavailable"}</Text>
            <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>Teacher NPR {allocation.teacherNpr.toLocaleString("en-NP")} · Fadko NPR {allocation.fadkoNpr.toLocaleString("en-NP")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
              {(PROGRAM_COMMERCE_NEXT[allocation.state] ?? []).map((action) => <ProgramButton
                key={action.event}
                label={action.label}
                emphasis={action.event.includes("refund") || action.event.includes("upheld") ? "danger" : "secondary"}
                disabled={busy}
                onPress={() => void apply(receipt, allocation, action.event, Boolean(action.reason))}
              />)}
            </View>
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
