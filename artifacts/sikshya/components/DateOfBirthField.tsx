import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { HIT_SLOP_MIN } from "@/constants/layout";
import { birthDateInput, birthDateLabel, birthDateToAd, isFutureBirthDate } from "@/utils/birthDate";
import type { DateSystem } from "@/utils/nepaliDate";

interface Props {
  value: string; onChange: (ad: string) => void; label: string; testID?: string;
  fieldError?: string; editable?: boolean; focusRequest?: number;
  onInvalidFocus?: (input: TextInput) => void; inputRef?: (input: TextInput | null) => void;
}
/** BS-first entry, with an explicit AD alternative. The API still receives an unambiguous AD civil day. */
export function DateOfBirthField({ value, onChange, label, testID = "birth-date", fieldError, editable = true, focusRequest = 0, onInvalidFocus, inputRef }: Props) {
  const colors = useColors(); const { t, space, radius } = useLayout();
  const [system, setSystem] = useState<DateSystem>(value && !birthDateInput(value, "bs") ? "ad" : "bs");
  const [draft, setDraft] = useState(() => birthDateInput(value, system));
  const [touched, setTouched] = useState(false);
  const lastEmitted = useRef(value); const input = useRef<TextInput | null>(null);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    const next = value && !birthDateInput(value, system) ? "ad" : system;
    setSystem(next); setDraft(birthDateInput(value, next)); setTouched(false);
  }, [value, system]);
  useEffect(() => { if (focusRequest && input.current) { input.current.focus(); onInvalidFocus?.(input.current); } }, [focusRequest]);
  const parsed = birthDateToAd(draft, system);
  const invalid = draft && (!parsed || isFutureBirthDate(parsed));
  const issue = invalid && (touched || !!fieldError || draft.length === 10)
    ? `Enter a valid ${system.toUpperCase()} birth date, not in the future. ${system === "bs" ? "For dates outside the supported BS calendar, use AD instead." : "Use year-month-day."}` : fieldError;
  const change = (raw: string) => {
    setDraft(raw); const ad = birthDateToAd(raw, system);
    const canonical = ad && !isFutureBirthDate(ad) ? ad : "";
    lastEmitted.current = canonical; onChange(canonical);
  };
  return <View style={{ gap: space.xs }}>
    <Text style={[t.bodyStrong, { color: colors.foreground }]}>{label} *</Text>
    <View style={{ flexDirection: "row", gap: space.xs }}>
      {(["bs", "ad"] as const).map(mode => <Pressable key={mode} testID={`${testID}-${mode}`} accessibilityRole="radio" accessibilityState={{ checked: system === mode }} aria-checked={system === mode} disabled={!editable} onPress={() => {
        if (mode === system) return;
        const converted = birthDateInput(value, mode);
        if (value && !converted) { setTouched(true); return; }
        setSystem(mode); setDraft(converted); setTouched(false);
      }} style={{ minHeight: HIT_SLOP_MIN, flex: 1, justifyContent: "center", alignItems: "center", borderRadius: radius.sm, borderWidth: 1, borderColor: system === mode ? colors.primary : colors.border, backgroundColor: system === mode ? colors.actionSoft : colors.card }}><Text style={[t.callout, { color: system === mode ? colors.primary : colors.mutedForeground }]}>{mode === "bs" ? "Nepali (BS)" : "English (AD)"}</Text></Pressable>)}
    </View>
    <TextInput ref={node => { input.current = node; inputRef?.(node); }} testID={testID} accessibilityLabel={`${label} (${system.toUpperCase()})`} aria-invalid={!!issue} editable={editable} value={draft} maxLength={10} placeholder="YYYY-MM-DD" autoCorrect={false} autoCapitalize="none" onBlur={() => setTouched(true)} onChangeText={change} placeholderTextColor={colors.inkFaint} style={[t.body, { minHeight: HIT_SLOP_MIN, padding: space.md, color: colors.foreground, borderWidth: 1, borderColor: issue ? colors.destructive : colors.border, backgroundColor: colors.card, borderRadius: radius.sm }]} />
    <Text style={[t.caption, { color: colors.mutedForeground }]}>{system === "bs" ? "Bikram Sambat · year-month-day · English or Nepali digits" : "Gregorian · year-month-day"}</Text>
    {!!value && !birthDateInput(value, "bs") && <Text style={[t.caption, { color: colors.mutedForeground }]}>This date is outside the supported BS conversion range. Keep it in AD; we won’t guess a conversion.</Text>}
    {!!value && !invalid && <Text testID={`${testID}-equivalent`} style={[t.caption, { color: colors.mutedForeground }]}>{system === "bs" ? `Equivalent: ${value} AD` : birthDateLabel(value)}</Text>}
    {!!issue && <Text accessibilityRole="alert" testID={`${testID}-error`} style={[t.caption, { color: colors.destructive }]}>{issue}</Text>}
  </View>;
}
