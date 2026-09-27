import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProgramBackControl, ProgramButton, ProgramChip } from "@/components/programs/ProgramPieces";
import { readingWidth, HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useAuth } from "@/context/AuthContext";
import { ApiError, apiGet, apiPost } from "@/utils/api";
import { rejectionExplanation, uploadIdentityDocument, type IdentityStatusResponse } from "@/utils/identityVerification";
import type { UploadableFile } from "@/utils/uploadFile";
import { DateOfBirthField } from "@/components/DateOfBirthField";

const fields = [
  ["legalName", "Legal name", "Exactly as shown on the citizenship card", 160],
  ["documentNumber", "Citizenship number", "As printed on the card", 80],
  ["dateOfBirth", "Date of birth", "YYYY-MM-DD", 10],
  ["issuingDistrict", "Issuing district", "The district that issued the document", 100],
  ["issuingMunicipality", "Issuing municipality", "The municipality recorded on the document", 160],
] as const;

/** Legal details live only in this mounted form, never in public-profile state or local storage. */
export default function IdentityVerification() {
  const { user } = useAuth();
  const colors = useColors();
  const { t, space, radius, gutter } = useLayout();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  const fieldRefs = useRef<Record<string, TextInput | null>>({});
  const fieldY = useRef<Record<string, number>>({});
  const [result, setResult] = useState<IdentityStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [holder, setHolder] = useState<"self" | "parent">("self");
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<UploadableFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparedId, setPreparedId] = useState<number | null>(null);
  const teacher = user?.role === "teacher";
  useEffect(() => {
    setValues({}); setFile(null); setConsent(false); setPreparedId(null); setErrors({}); setHolder("self");
  }, [user?.id]);
  useEffect(() => {
    let active = true;
    if (user?.role !== "teacher") { setLoading(false); return () => { active = false; }; }
    setLoading(true); setError("");
    apiGet<IdentityStatusResponse>("/identity-verification/me").then(data => { if (active) setResult(data); })
      .catch(() => { if (active) { setResult(null); setError("We couldn’t check your verification status. Your saved submission has not been changed."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, user?.id, user?.role]);
  const showErrors = (next: Record<string, string>) => {
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) { scroll.current?.scrollTo({ y: Math.max(0, (fieldY.current[first] ?? 0) - space.md), animated: true }); fieldRefs.current[first]?.focus(); }
  };
  const change = (key: string, value: string) => {
    setValues(old => ({ ...old, [key]: value })); setPreparedId(null);
    setErrors(old => { const next = { ...old }; delete next[key]; return next; });
  };
  const choose = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png", "application/pdf"], copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      if (asset.size && asset.size > 8 * 1024 * 1024) { showErrors({ document: "Choose a document no larger than 8 MB." }); return; }
      setFile({ uri: asset.uri, name: asset.name, size: asset.size ?? 0, mimeType: asset.mimeType ?? "application/octet-stream" });
      setErrors(old => { const next = { ...old }; delete next.document; return next; });
    } catch { setError("The file picker could not open. Please try again."); }
  };
  const submit = async () => {
    if (busy) return;
    const invalid: Record<string, string> = {};
    for (const [key, label] of fields) if (!values[key]?.trim()) invalid[key] = `Enter ${holder === "parent" ? "your parent’s " : "your "}${label.toLowerCase()}.`;
    if (holder === "parent" && !values.parentRelationship?.trim()) invalid.parentRelationship = "Enter the parent’s relationship to you.";
    if (!file) invalid.document = "Choose the citizenship document to upload.";
    if (!consent) invalid.consent = "The document holder must agree before submission.";
    if (Object.keys(invalid).length) { showErrors(invalid); return; }
    setBusy(true); setError(""); setErrors({});
    try {
      const id = preparedId ?? (await apiPost<{ id: number }>("/identity-verification/prepare", { ...values, holder, documentType: "citizenship", consent })).id;
      setPreparedId(id);
      const uploaded = await uploadIdentityDocument(id, file!);
      setResult({ enabled: true, available: true, verification: uploaded.verification });
      setValues({}); setFile(null); setConsent(false); setPreparedId(null);
      scroll.current?.scrollTo({ y: 0, animated: true });
    } catch (failure) {
      if (failure instanceof ApiError && failure.data.fields && typeof failure.data.fields === "object") {
        const safe = Object.fromEntries(Object.entries(failure.data.fields).filter(([, value]) => typeof value === "string")) as Record<string, string>;
        showErrors(safe);
      } else setError(failure instanceof Error ? failure.message : "Your document was not submitted. Please try again.");
    } finally { setBusy(false); }
  };
  const card = { padding: space.lg, gap: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card };
  const status = result?.verification?.status;
  const pending = status === "submitted";
  const approved = status === "approved";
  const errorText = (key: string) => errors[key] ? <Text accessibilityRole="alert" testID={`identity-${key}-error`} style={[t.caption, { color: colors.destructive }]}>{errors[key]}</Text> : null;
  if (user?.role === "student") return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ width: "100%", maxWidth: readingWidth, alignSelf: "center", paddingHorizontal: gutter, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.huge, gap: space.lg }}>
    <ProgramBackControl testID="identity-back" label="Back to profile" onPress={() => router.replace("/(student)/profile")} />
    <View style={card}>
      <Feather name="shield" size={24} color={colors.primary} />
      <Text accessibilityRole="header" style={[t.title2, { color: colors.foreground }]}>No citizenship document needed</Text>
      <Text style={[t.body, { color: colors.mutedForeground }]}>Students can book classes without uploading their own or a parent’s citizenship document. Keep your required profile and email details up to date.</Text>
      <ProgramButton label="Return to profile" onPress={() => router.replace("/(student)/profile")} />
    </View>
  </ScrollView>;
  return <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ width: "100%", maxWidth: readingWidth, alignSelf: "center", paddingHorizontal: gutter, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.huge, gap: space.lg }}>
    <ProgramBackControl testID="identity-back" label="Back to profile" onPress={() => router.replace(teacher ? "/(teacher)/profile" : "/(student)/profile")} />
    <View style={{ gap: space.xs }}><Text accessibilityRole="header" style={[t.title1, { color: colors.foreground }]}>Private identity check</Text><Text style={[t.body, { color: colors.mutedForeground }]}>A separate, private step to help protect the Fadko community.</Text></View>
    {loading ? <ActivityIndicator accessibilityLabel="Loading verification status" color={colors.primary} /> : null}
    {!!error && <View accessibilityRole="alert" style={card}><Text style={[t.body, { color: colors.destructive }]}>{error}</Text>{!result && <ProgramButton label="Try again" onPress={() => setAttempt(value => value + 1)} />}</View>}
    {!loading && result && (!result.enabled || !result.available) ? <View style={card}><Feather name="lock" size={24} color={colors.primary} /><Text style={[t.bodyStrong, { color: colors.foreground }]}>Identity upload is not open yet</Text><Text style={[t.body, { color: colors.mutedForeground }]}>Please don’t send citizenship documents in messages, homework, profile photos or AI Support. Use only this private verification area when it becomes available.</Text></View> : null}
    {!loading && result?.enabled && result.available && (pending || approved) ? <View style={card} testID="identity-status">
      <ProgramChip label={approved ? "Identity approved" : "Waiting for operator review"} tone={approved ? "live" : "waiting"} />
      <Text style={[t.title3, { color: colors.foreground }]}>{approved ? "Your identity check is complete" : "Your document has been submitted"}</Text>
      <Text style={[t.body, { color: colors.mutedForeground }]}>{teacher ? approved ? "Identity approval is one step. Your teacher account must also be approved before students can book with you." : "You can prepare your classes while you wait. Students can book after your teacher account and identity are approved." : "You can book classes while your document is being reviewed, once your email and profile requirements are complete."}</Text>
      <ProgramButton label="Refresh status" onPress={() => setAttempt(value => value + 1)} />
    </View> : null}
    {!loading && result?.enabled && result.available && !pending && !approved ? <>
      {status === "rejected" && <View style={card}><ProgramChip label="Needs a correction" tone="waiting" /><Text style={[t.body, { color: colors.foreground }]}>{rejectionExplanation[result.verification?.rejectionCode ?? ""] ?? "Please check your document and submit a corrected copy."}</Text></View>}
      <View style={card}>
        <Text style={[t.title3, { color: colors.foreground }]}>Whose document are you submitting?</Text>
        <Text style={[t.body, { color: colors.mutedForeground }]}>{teacher ? "Teachers must submit their own citizenship document." : "If you don’t have citizenship, use one parent’s citizenship—with their permission. A school ID alone is not accepted."}</Text>
        {!teacher && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>{(["self", "parent"] as const).map(value => <ProgramButton key={value} testID={`identity-holder-${value}`} label={value === "self" ? "My citizenship" : "Parent’s citizenship"} emphasis={holder === value ? "primary" : "secondary"} disabled={busy} onPress={() => { setHolder(value); setValues({}); setConsent(false); setFile(null); setPreparedId(null); setErrors({}); }} />)}</View>}
        <Text style={[t.caption, { color: colors.mutedForeground }]}>{holder === "parent" ? "Enter your parent’s details below—not your own. Your student profile stays unchanged." : "Use the details on your document, not a nickname or display name."}</Text>
      </View>
      {[...fields, ...(holder === "parent" ? [["parentRelationship", "Relationship to student", "For example, mother or father", 60] as const] : [])].map(([key, label, placeholder, max]) => <View key={key} onLayout={event => { fieldY.current[key] = event.nativeEvent.layout.y; }} style={{ gap: space.xs }}>
        {key === "dateOfBirth" ? <DateOfBirthField key={`${user?.id}-${holder}`} testID="identity-dateOfBirth" label={holder === "parent" ? "Parent’s date of birth" : "Date of birth"} value={values.dateOfBirth ?? ""} onChange={value => change("dateOfBirth", value)} fieldError={errors.dateOfBirth} editable={!busy} inputRef={node => { fieldRefs.current.dateOfBirth = node; }} /> : <>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>{holder === "parent" && key !== "parentRelationship" ? `Parent’s ${label.toLowerCase()}` : label} *</Text>
        <TextInput ref={node => { fieldRefs.current[key] = node; }} testID={`identity-${key}`} accessibilityLabel={holder === "parent" ? `Parent’s ${label}` : label} editable={!busy} value={values[key] ?? ""} maxLength={max} placeholder={placeholder} placeholderTextColor={colors.inkFaint} autoCorrect={false} onChangeText={value => change(key, value)} style={[t.body, { minHeight: HIT_SLOP_MIN, padding: space.md, color: colors.foreground, borderWidth: 1, borderColor: errors[key] ? colors.destructive : colors.border, backgroundColor: colors.card, borderRadius: radius.sm }]} />
        {errorText(key)}
        </>}
      </View>)}
      <View style={card} onLayout={event => { fieldY.current.document = event.nativeEvent.layout.y; }}>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>Citizenship document *</Text><Text style={[t.body, { color: colors.mutedForeground }]}>Include both sides, clearly readable, in one PDF or image. JPEG, PNG or PDF · up to 8 MB.</Text>
        <ProgramButton label={file ? "Change document" : "Choose document"} testID="identity-file" icon="upload" disabled={busy} onPress={() => void choose()} />
        {file && <Text style={[t.caption, { color: colors.mutedForeground }]} numberOfLines={2}>{file.name}</Text>}{errorText("document")}
      </View>
      <View style={card}>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>Private by design</Text>
        <Text style={[t.callout, { color: colors.mutedForeground }]}>Only authorised identity reviewers may access these details. They are not shown in your public profile, classrooms or AI Support. Approved document files are deleted 90 days after approval; rejected submissions after 30 days. Private reference details are kept during your account’s lifetime and for one year after closure. Active fraud investigations can extend retention, with regular review.</Text>
      </View>
      <View onLayout={event => { fieldY.current.consent = event.nativeEvent.layout.y; }} style={{ gap: space.xs }}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} aria-checked={consent} testID="identity-consent" disabled={busy} onPress={() => { setConsent(value => !value); setPreparedId(null); setErrors(old => ({ ...old, consent: "" })); }} style={{ minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Feather name={consent ? "check-square" : "square"} size={24} color={errors.consent ? colors.destructive : colors.primary} /><Text style={[t.body, { flex: 1, color: colors.foreground }]}>{holder === "parent" ? "My parent has read this notice and agrees to submit their document and details." : "I have read this notice and agree to submit my document and details."}</Text>
        </Pressable>{errorText("consent")}
      </View>
      {!!preparedId && !!error && <Text style={[t.caption, { color: colors.mutedForeground }]}>Your form has been saved privately. Retry the upload without re-entering the details.</Text>}
      <ProgramButton testID="identity-submit" label={preparedId ? "Retry document upload" : "Submit for private review"} emphasis="primary" busy={busy} onPress={() => void submit()} />
    </> : null}
  </ScrollView>;
}
