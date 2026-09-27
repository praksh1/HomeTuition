import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { ProgramBackControl, ProgramButton, ProgramChip } from "@/components/programs/ProgramPieces";
import { apiGet, apiPost } from "@/utils/api";
import { HIT_SLOP_MIN } from "@/constants/layout";

type Hold = { id: number; userId: number; version: number; active: boolean; caseId: number | null;
  reviewDueAt: string | null; overdue: boolean; documentDeleted: boolean; detailsDeleted: boolean };
type Action = "place" | "review" | "release";
const actionLabels = { place: "Preserve for investigation", review: "Keep hold after review", release: "Release preservation hold" };

export default function IdentityHolds() {
  const { user } = useAuth();
  // A new operator must never inherit the previous operator's in-memory private workspace.
  return user?.role === "admin" && Platform.OS === "web" ? <HoldWorkspace key={user.id} /> : null;
}
function HoldWorkspace() {
  const colors = useColors(); const { t, space, radius, gutter } = useLayout();
  const [items, setItems] = useState<Hold[]>([]); const [cursor, setCursor] = useState<number | null>(null);
  const [record, setRecord] = useState<Hold | null>(null); const [submission, setSubmission] = useState(""); const [caseNumber, setCaseNumber] = useState("");
  const [action, setAction] = useState<Action | null>(null); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const version = useRef(0); const listVersion = useRef(0);
  const load = useCallback(async (before?: number) => {
    const request = ++listVersion.current; setLoading(true);
    try {
      const data = await apiGet<{ items: Hold[]; nextCursor: number | null }>(`/identity-review/holds${before ? `?before=${before}` : ""}`);
      if (request !== listVersion.current) return;
      setItems(old => before ? [...old, ...data.items.filter(row => !old.some(item => item.id === row.id))] : data.items); setCursor(data.nextCursor);
    } catch (failure) { if (request === listVersion.current) setError(failure instanceof Error ? failure.message : "Preservation holds could not load."); }
    finally { if (request === listVersion.current) setLoading(false); }
  }, []);
  const clear = useCallback(() => { version.current++; setRecord(null); setCaseNumber(""); setAction(null); setBusy(false); }, []);
  useEffect(() => {
    void load();
    const hide = () => { if (globalThis.document.hidden) { clear(); listVersion.current++; setItems([]); setCursor(null); setSubmission(""); setLoading(false); } };
    globalThis.document.addEventListener("visibilitychange", hide);
    return () => { version.current++; listVersion.current++; globalThis.document.removeEventListener("visibilitychange", hide); };
  }, [clear, load]);
  const open = async (id: number) => {
    if (!Number.isSafeInteger(id) || id <= 0) { setError("Enter a valid submission number."); return; }
    clear(); const request = version.current; setBusy(true); setError(""); setNotice("");
    try {
      const data = await apiGet<{ hold: Hold }>(`/identity-review/${id}/hold`);
      if (request !== version.current) return;
      setRecord(data.hold); setCaseNumber(data.hold.caseId ? String(data.hold.caseId) : "");
    } catch (failure) { if (request === version.current) setError(failure instanceof Error ? failure.message : "Record could not load."); }
    finally { if (request === version.current) setBusy(false); }
  };
  const confirm = async () => {
    if (!record || !action || busy) return;
    const caseId = Number(caseNumber);
    if (!Number.isSafeInteger(caseId) || caseId <= 0) { setError("Enter the related support case number."); setAction(null); return; }
    const request = version.current; setBusy(true); setError("");
    try {
      const result = await apiPost<{ hold: Hold }>(`/identity-review/${record.id}/hold`, { action, caseId, version: record.version, confirmed: true });
      if (request !== version.current) return;
      setRecord(result.hold); setAction(null); setNotice(action === "release" ? "Hold released. The next cleanup applies the original retention deadlines; this does not extend them." : "Preservation saved. No approval, ban, refund or case decision was made."); void load();
    } catch (failure) {
      if (request === version.current) { clear(); setError(failure instanceof Error ? failure.message : "The hold was not saved. Reload before trying again."); }
    } finally { if (request === version.current) setBusy(false); }
  };
  const card = { padding: space.lg, gap: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card };
  const input = { minHeight: HIT_SLOP_MIN, padding: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, color: colors.foreground, ...t.body };
  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: gutter, paddingBottom: space.huge * 3, gap: space.lg, width: "100%", maxWidth: 960, alignSelf: "center" }}>
    <ProgramBackControl testID="identity-holds-back" label="Back to private reviews" onPress={() => { clear(); router.push("/(admin)/identity-review"); }} />
    <Text style={[t.title1, { color: colors.foreground }]}>Investigation preservation</Text>
    <Text style={[t.body, { color: colors.mutedForeground }]}>Preserve only what remains for a real investigation. No legal names, document numbers or images are shown here. Holds never release automatically.</Text>
    {!!error && <Text accessibilityRole="alert" style={[t.body, { color: colors.destructive }]}>{error}</Text>}
    {!!notice && <Text accessibilityRole="alert" style={[t.body, { color: colors.success }]}>{notice}</Text>}
    <View style={card}>
      <Text style={[t.title3, { color: colors.foreground }]}>Find a submission</Text>
      <TextInput testID="identity-hold-number" accessibilityLabel="Submission number" placeholder="Submission number" placeholderTextColor={colors.mutedForeground} value={submission} onChangeText={setSubmission} inputMode="numeric" editable={!busy} style={input} />
      <ProgramButton label="Load preservation status" busy={busy} onPress={() => void open(Number(submission))} />
    </View>
    {record && <View style={card} testID="identity-hold-record">
      <Text style={[t.title2, { color: colors.foreground }]}>Submission #{record.id} · Account #{record.userId}</Text>
      <ProgramChip label={record.active ? record.overdue ? "Review overdue · still preserved" : "Preservation active" : "No active hold"} />
      <Text style={[t.callout, { color: colors.mutedForeground }]}>{record.documentDeleted ? "Document already deleted; it cannot be restored." : "Document remains subject to retention."} {record.detailsDeleted ? "Private reference details already deleted." : "Private reference details retained."}</Text>
      {record.reviewDueAt && <Text style={[t.body, { color: record.overdue ? colors.destructive : colors.foreground }]}>Manual review due: {new Date(record.reviewDueAt).toLocaleDateString("en-GB", { timeZone: "Asia/Kathmandu" })}</Text>}
      <Text style={[t.caption, { color: colors.mutedForeground }]}>Related support case number (the number in HT-000123)</Text>
      <TextInput testID="identity-hold-case" accessibilityLabel="Related support case number" value={caseNumber} onChangeText={value => { setCaseNumber(value); setAction(null); }} inputMode="numeric" editable={!record.active && !busy} style={input} />
      {record.active ? <><ProgramButton label={actionLabels.review} disabled={busy} onPress={() => setAction("review")} /><ProgramButton label={actionLabels.release} emphasis="quiet" disabled={busy} onPress={() => setAction("release")} /></> : <ProgramButton label={actionLabels.place} disabled={busy || (record.documentDeleted && record.detailsDeleted)} onPress={() => setAction("place")} />}
      {action && <View testID="identity-hold-confirmation" style={{ padding: space.md, gap: space.md, backgroundColor: colors.actionSoft, borderRadius: radius.sm }}>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>{actionLabels[action]}?</Text>
        <Text style={[t.body, { color: colors.foreground }]}>{action === "release" ? "I have reviewed the investigation and confirm this evidence no longer needs preservation. Already-due data may be deleted on the next cleanup." : "I confirm this account is relevant to the active case and preservation remains necessary. I will review the hold again within 90 days."}</Text>
        <ProgramButton label="Confirm preservation action" busy={busy} onPress={() => void confirm()} /><ProgramButton label="Cancel without changes" emphasis="quiet" disabled={busy} onPress={() => setAction(null)} />
      </View>}
      <ProgramButton label="Close preservation record" emphasis="quiet" disabled={busy} onPress={clear} />
    </View>}
    <View style={card}>
      <Text style={[t.title3, { color: colors.foreground }]}>Active holds</Text>
      <ProgramButton label="Refresh holds" busy={loading} onPress={() => { setError(""); void load(); }} />
      {!loading && !error && !items.length && <Text style={[t.body, { color: colors.mutedForeground }]}>No active preservation holds.</Text>}
      {items.map(item => <ProgramButton key={item.id} label={`Submission #${item.id} · Case #${item.caseId}${item.overdue ? " · Review overdue" : ""}`} disabled={busy} onPress={() => void open(item.id)} />)}
      {cursor && <ProgramButton label="Load more holds" busy={loading} onPress={() => void load(cursor)} />}
    </View>
  </ScrollView>;
}
