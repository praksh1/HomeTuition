import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PdfViewer from "@/components/PdfViewer";
import { ProgramBackControl, ProgramButton, ProgramChip } from "@/components/programs/ProgramPieces";
import { HIT_SLOP_MIN } from "@/constants/layout";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPost, identityReviewDocument } from "@/utils/api";
import { rejectionExplanation } from "@/utils/identityStatus";
import { birthDateLabel } from "@/utils/birthDate";

type Item = { id: number; userId: number; holder: "self" | "parent"; createdAt: string };
type Review = { verification: { id: number; status: string; holder: "self" | "parent" }; details: Record<string, string | boolean | null> };
const labels = { legalName: "Document holder’s legal name", documentNumber: "Citizenship number", dateOfBirth: "Date of birth", issuingDistrict: "Issuing district", issuingMunicipality: "Issuing municipality", parentRelationship: "Relationship to student" };
const reasons: Record<string, string> = { unreadable: "Document is unreadable", missing_side: "A side is missing", details_mismatch: "Details do not match", wrong_document: "Wrong document type", consent_required: "Consent needs clarification" };

export default function IdentityReview() {
  const { user } = useAuth();
  return user?.role === "admin" ? <IdentityReviewWorkspace key={user.id} /> : null;
}
function IdentityReviewWorkspace() {
  const { user } = useAuth(); const colors = useColors(); const { t, space, radius, gutter, isWide } = useLayout(); const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[]>([]); const [cursor, setCursor] = useState<number | null>(null);
  const [review, setReview] = useState<Review | null>(null); const [selected, setSelected] = useState<number | null>(null);
  const [document, setDocument] = useState<{ url: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false); const [confirmed, setConfirmed] = useState(false); const [reason, setReason] = useState(""); const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const [documentReceived, setDocumentReceived] = useState(false);
  const [retention, setRetention] = useState<{ healthy: boolean; enabled: boolean } | null>(null);
  const generation = useRef(0); const objectUrl = useRef<string | null>(null);
  const clearPrivate = useCallback(() => {
    generation.current += 1;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null; setDocument(null); setReview(null); setSelected(null); setReady(false); setDocumentReceived(false); setConfirmed(false); setReason(""); setDecision(null); setBusy(false);
  }, []);
  const load = useCallback(async (before?: number) => {
    setLoading(true); setError("");
    try { const response = await apiGet<{ items: Item[]; nextCursor: number | null }>(`/identity-review${before ? `?before=${before}` : ""}`); setItems(old => before ? [...old, ...response.items.filter(row => !old.some(item => item.id === row.id))] : response.items); setCursor(response.nextCursor);
      setRetention(await apiGet<{ healthy: boolean; enabled: boolean }>("/identity-review/retention-health").catch(() => null)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The review queue could not load."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    clearPrivate(); setItems([]); setCursor(null); setNotice("");
    if (user?.role === "admin" && Platform.OS === "web") void load();
    return () => { generation.current += 1; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); };
  }, [clearPrivate, load, user?.id, user?.role]);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    // Hiding this tab clears displayed legal data. Returning requires a fresh audited open.
    const hide = () => { if (globalThis.document.hidden) clearPrivate(); };
    globalThis.document.addEventListener("visibilitychange",hide);
    return () => globalThis.document.removeEventListener("visibilitychange",hide);
  }, [clearPrivate]);
  const open = async (id: number) => {
    clearPrivate(); const version = generation.current; setSelected(id); setBusy(true); setError(""); setNotice("");
    try { const data = await apiPost<Review>(`/identity-review/${id}/open`, {}); if (generation.current === version) setReview(data); }
    catch (failure) { if (generation.current === version) setError(failure instanceof Error ? failure.message : "The private record could not open."); }
    finally { if (generation.current === version) setBusy(false); }
  };
  const preview = async () => {
    if (!review || busy) return;
    const version = ++generation.current; setBusy(true); setError(""); setReady(false); setDocumentReceived(false); setConfirmed(false); setDecision(null);
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null; setDocument(null);
    try {
      const blob = await identityReviewDocument(review.verification.id);
      if (generation.current !== version) return;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(blob); setDocument({ url: objectUrl.current, type: blob.type }); setDocumentReceived(true);
    } catch (failure) { if (generation.current === version) setError(failure instanceof Error ? failure.message : "The document could not open."); }
    finally { if (generation.current === version) setBusy(false); }
  };
  const saveDecision = async () => {
    if (!review || !decision || !documentReceived || !confirmed || busy || (decision === "approved" && !ready) || (decision === "rejected" && !reason)) return;
    const id = review.verification.id; const version = generation.current; setBusy(true); setError("");
    try {
      await apiPost(`/identity-review/${id}/decision`, { decision, rejectionCode: decision === "rejected" ? reason : undefined });
      if (generation.current !== version) return;
      clearPrivate(); setItems(old => old.filter(item => item.id !== id)); setNotice("Review saved. Identity approval does not automatically approve a teacher account.");
    } catch (failure) { if (generation.current === version) { setError(failure instanceof Error ? failure.message : "The decision was not saved. Refresh the queue before retrying."); setDecision(null); } }
    finally { if (generation.current === version) setBusy(false); }
  };
  const card = { padding: space.md, gap: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card };
  if (user?.role !== "admin") return null;
  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: gutter, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.huge * 3, gap: space.lg }}>
    <ProgramBackControl testID="identity-review-back" label="Back to support desk" onPress={() => { clearPrivate(); router.push("/(admin)"); }} />
    <View style={{ gap: space.xs }}><Text style={[t.title1, { color: colors.foreground }]}>Private identity reviews</Text><Text style={[t.body, { color: colors.mutedForeground }]}>Restricted, audited access. Never copy these details into tickets, messages or AI tools.</Text></View>
    {Platform.OS === "web" && <ProgramButton label="Investigation preservation holds" emphasis="quiet" onPress={() => { clearPrivate(); router.push("/(admin)/identity-holds"); }} />}
    {Platform.OS !== "web" ? <Text style={[t.body, { color: colors.foreground }]}>Use the Fadko website to review documents securely. This app does not download identity documents to your device.</Text> : <>
      {!retention?.healthy && <View style={card} accessibilityRole="alert"><Text style={[t.bodyStrong, { color: colors.destructive }]}>Retention needs attention</Text><Text style={[t.callout, { color: colors.mutedForeground }]}>A recent successful cleanup cycle has not been confirmed. Keep new identity collection closed until storage and cleanup are verified.</Text></View>}
      {!!error && <View accessibilityRole="alert" style={card}><Text style={[t.body, { color: colors.destructive }]}>{error}</Text><ProgramButton label="Refresh review queue" disabled={busy} onPress={() => { clearPrivate(); void load(); }} /></View>}
      {!!notice && <Text accessibilityRole="alert" style={[t.body, { color: colors.success }]}>{notice}</Text>}
      <View style={{ flexDirection: isWide ? "row" : "column", gap: space.lg, alignItems: "flex-start" }}>
        <View style={[card, { width: isWide ? 320 : "100%" }]} testID="identity-review-queue">
          <Text style={[t.title3, { color: colors.foreground }]}>Waiting for review</Text>
          {loading ? <ActivityIndicator color={colors.primary} /> : null}
          {!loading && !error && !items.length && <Text style={[t.body, { color: colors.mutedForeground }]}>No documents are waiting for review.</Text>}
          {items.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Review submission ${item.id}`} testID={`identity-review-item-${item.id}`} disabled={busy} onPress={() => void open(item.id)} style={{ minHeight: HIT_SLOP_MIN, padding: space.sm, gap: space.xs, borderRadius: radius.sm, backgroundColor: selected === item.id ? colors.actionSoft : colors.muted }}>
            <Text style={[t.bodyStrong, { color: colors.primary }]}>Submission #{item.id}</Text><Text style={[t.caption, { color: colors.mutedForeground }]}>Account #{item.userId} · {item.holder === "parent" ? "Parent document" : "Own document"}</Text>
          </Pressable>)}
          {cursor && <ProgramButton label="Load more reviews" busy={loading} disabled={busy} onPress={() => void load(cursor)} />}
        </View>
        <View style={{ flex: isWide ? 1 : undefined, width: isWide ? undefined : "100%", minWidth: 0, gap: space.md }}>
          {busy && !review && <ActivityIndicator accessibilityLabel="Opening private record" color={colors.primary} />}
          {!review && !busy && <View style={card}><Feather name="shield" size={24} color={colors.primary} /><Text style={[t.body, { color: colors.mutedForeground }]}>Select a submission to start. The queue does not expose legal names or document numbers.</Text></View>}
          {review && <>
            <View style={card} testID="identity-review-details">
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, justifyContent: "space-between" }}><ProgramChip label={review.verification.holder === "parent" ? "Parent’s document—not the student’s identity" : "Account holder’s document"} /><ProgramButton label="Close private record" emphasis="quiet" onPress={clearPrivate} /></View>
              {Object.entries(labels).map(([key,label]) => review.details[key] ? <View key={key} style={{ gap: space.xxs }}><Text style={[t.caption, { color: colors.mutedForeground }]}>{label}</Text><Text selectable style={[t.bodyStrong, { color: colors.foreground }]}>{key === "dateOfBirth" ? birthDateLabel(String(review.details[key])) : String(review.details[key])}</Text>{key === "dateOfBirth" && <Text style={[t.caption, { color: colors.mutedForeground }]}>{String(review.details[key])} AD</Text>}</View> : null)}
              <Text style={[t.caption, { color: colors.mutedForeground }]}>Consent recorded: {review.details.consent === true ? "Yes" : "Needs clarification"}</Text>
              <ProgramButton label={document ? "Reload private document" : "Open private document"} busy={busy} onPress={() => void preview()} />
            </View>
            {document && <View style={[card, { height: isWide ? 640 : 480 }]} testID="identity-review-preview">
              {document.type === "application/pdf" ? <PdfViewer privateReview uri={document.url} style={{ flex: 1 }} onReady={() => setReady(true)} onProblem={() => { setReady(false); setError("The PDF could not be read. Ask for a readable replacement; do not approve it."); }} /> : <Image source={{ uri: document.url }} resizeMode="contain" accessibilityLabel="Private citizenship document" style={{ width: "100%", flex: 1 }} onLoad={() => setReady(true)} onError={() => { setReady(false); setError("This image could not be displayed."); }} />}
            </View>}
            <View style={card}>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmed, disabled: !documentReceived || busy }} aria-checked={confirmed} aria-disabled={!documentReceived || busy} disabled={!documentReceived || busy} testID="identity-review-confirm" onPress={() => setConfirmed(value => !value)} style={{ flexDirection: "row", gap: space.sm, minHeight: HIT_SLOP_MIN, alignItems: "center" }}><Feather name={confirmed ? "check-square" : "square"} size={24} color={documentReceived ? colors.primary : colors.mutedForeground} /><Text style={[t.body, { flex: 1, color: colors.foreground }]}>I reviewed the document’s sides, holder details and consent, or confirmed that a readable replacement is needed.</Text></Pressable>
              <Text style={[t.caption, { color: colors.mutedForeground }]}>Open the document and scroll through every page before approval. An upload alone does not establish authenticity.</Text>
              {Object.entries(reasons).map(([code,label]) => <Pressable key={code} accessibilityRole="radio" accessibilityState={{ checked: reason === code }} aria-checked={reason === code} disabled={busy} onPress={() => { setReason(code); setDecision(null); }} style={{ minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.sm }}><Feather name={reason === code ? "check-circle" : "circle"} size={20} color={colors.primary} /><Text style={[t.body, { flex: 1, color: colors.foreground }]}>{label}</Text></Pressable>)}
              {!!reason && <Text style={[t.callout, { color: colors.mutedForeground }]}>The user will see: {rejectionExplanation[reason]}</Text>}
              <ProgramButton label="Approve identity" emphasis="primary" disabled={!ready || !confirmed || busy || !!reason} onPress={() => setDecision("approved")} />
              <ProgramButton label="Request a correction" disabled={!documentReceived || !confirmed || !reason || busy} onPress={() => setDecision("rejected")} />
              {!!reason && <ProgramButton label="Clear correction reason" emphasis="quiet" disabled={busy} onPress={() => { setReason(""); setDecision(null); }} />}
              {decision && <View testID="identity-review-decision" style={{ padding: space.md, backgroundColor: colors.actionSoft, gap: space.sm, borderRadius: radius.sm }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>{decision === "approved" ? "Confirm identity approval?" : "Send this correction request?"}</Text><Text style={[t.callout, { color: colors.mutedForeground }]}>This records your decision. It does not change teacher-account approval, issue refunds or ban anyone.</Text><ProgramButton label="Save review decision" busy={busy} onPress={() => void saveDecision()} /><ProgramButton label="Go back without saving" emphasis="quiet" disabled={busy} onPress={() => setDecision(null)} /></View>}
            </View>
          </>}
        </View>
      </View>
    </>}
  </ScrollView>;
}
