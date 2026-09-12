import React, { useState } from "react";
import { Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet } from "@/utils/api";
import { programCommerceNepalTime } from "@/utils/programCommerceHistory";
import { ProgramButton, ProgramNotice } from "../programs/ProgramPieces";

interface Receipt { reference: string; classTitle: string; studentName: string; recordedAt: string;
  grossNpr: number; teacherNpr: number; fadkoNpr: number }

export function BatchTestLedger() {
  const colors = useColors();
  const { t, space, numeric } = useLayout();
  const [rows, setRows] = useState<Receipt[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true); setError("");
    try { setRows((await apiGet<{ receipts: Receipt[] }>("/admin/batch-test-payments")).receipts); }
    catch (e) { setRows(null); setError(e instanceof Error ? e.message : "Could not load test receipts."); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: space.sm }}>
    <Text accessibilityRole="header" style={[t.bodyStrong, { color: colors.foreground }]}>Class checkout · test ledger</Text>
    <Text style={[t.caption, { color: colors.mutedForeground }]}>Most recent 50 simulated purchases. Separate from the older Program rehearsal below. No real revenue or payouts.</Text>
    <ProgramButton label={busy ? "Loading…" : rows ? "Refresh test receipts" : "Show test receipts"} disabled={busy} onPress={() => void load()} />
    {error ? <ProgramNotice title="Could not load ledger" body={error} tone="stopped" /> : null}
    {rows?.length === 0 ? <Text style={[t.callout, { color: colors.mutedForeground }]}>No simulated class payments recorded yet.</Text> : null}
    {rows?.map(r => <ProgramNotice key={r.reference} title={`TEST · ${r.reference}`}>
      <Text style={[t.bodyStrong, { color: colors.foreground }]}>{r.classTitle}</Text>
      <Text style={[t.callout, { color: colors.foreground }]}>{r.studentName} · {programCommerceNepalTime(r.recordedAt)}</Text>
      <Text style={[t.callout, numeric, { color: colors.foreground }]}>Simulated: NPR {r.grossNpr.toLocaleString("en-NP")} · teacher {r.teacherNpr.toLocaleString("en-NP")} / Fadko {r.fadkoNpr.toLocaleString("en-NP")}</Text>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>Allocated and held for testing; not earned or paid out.</Text>
    </ProgramNotice>)}
  </View>;
}
