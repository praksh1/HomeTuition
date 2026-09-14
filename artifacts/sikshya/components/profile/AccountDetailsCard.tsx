import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet } from "@/utils/api";
import { completeAccountDetails } from "@/utils/accountDetailsForm";

type AccountDetails = {
  phone: string | null;
  province: string | null;
  district: string | null;
  localLevel: string | null;
  locality: string | null;
  institutionName: string | null;
  affiliationStatus: string | null;
};

export function AccountDetailsCard({ email, role }: { email: string; role: "teacher" | "student" }) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const [details, setDetails] = useState<AccountDetails | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const result = await apiGet<{ onboarding: AccountDetails | null }>("/onboarding/me");
      setDetails(result.onboarding);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const complete = completeAccountDetails(details);
  const institution = !complete
    ? "Confirm in Account details"
    : details?.affiliationStatus === "independent"
    ? role === "teacher" ? "Independent teacher" : "Not applicable"
    : details?.institutionName || "School or institution not added";
  const place = complete
    ? [details?.locality, details?.localLevel, details?.district, details?.province].filter(Boolean).join(", ")
    : "Confirm your location";

  return <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: space.md, gap: space.md }} testID={`${role}-account-details`}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <View style={{ width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, borderRadius: radius.sm, backgroundColor: colors.actionSoft, alignItems: "center", justifyContent: "center" }}>
        <Feather name="user" size={19} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: space.xxs }}>
        <Text accessibilityRole="header" style={[t.title3, { color: colors.foreground }]}>Account details</Text>
        {state === "ready" && <View style={{ flexDirection: "row", alignItems: "center", gap: space.xxs }}>
          <Feather name={complete ? "check-circle" : "alert-circle"} size={14} color={complete ? colors.success : colors.warn} />
          <Text style={[t.caption, { color: complete ? colors.success : colors.warn }]}>{complete ? "Up to date" : "Needs your attention"}</Text>
        </View>}
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Edit account details"
        onPress={() => router.push({ pathname: "/onboarding", params: { edit: "1", role } } as never)}
        activeOpacity={0.75}
        style={{ minHeight: HIT_SLOP_MIN, minWidth: HIT_SLOP_MIN, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: colors.actionSoft, justifyContent: "center", alignItems: "center" }}
        testID={`${role}-edit-account-details`}
      >
        <Text style={[t.bodyStrong, { color: colors.primary }]}>{complete ? "Edit" : "Add details"}</Text>
      </TouchableOpacity>
    </View>

    <View style={{ borderRadius: radius.md, backgroundColor: colors.muted, paddingHorizontal: space.sm }}>
      <Detail icon="mail" label="Login email" value={email} />

      {state === "loading" ? <View style={{ minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.sm }}><ActivityIndicator color={colors.primary} /><Text style={[t.callout, { color: colors.mutedForeground }]}>Loading your details…</Text></View> : null}
      {state === "error" ? <View style={{ gap: space.xs, paddingVertical: space.xs }}><Text style={[t.callout, { color: colors.destructive }]}>We could not load these details. Nothing was changed.</Text><TouchableOpacity accessibilityRole="button" onPress={() => void load()} style={{ minHeight: HIT_SLOP_MIN, justifyContent: "center" }}><Text style={[t.bodyStrong, { color: colors.primary }]}>Try again</Text></TouchableOpacity></View> : null}
      {state === "ready" ? <>
        <Detail icon="phone" label="Phone" value={details?.phone || "Phone number not added"} />
        <Detail icon="map-pin" label="Location" value={place || "Location not added"} />
        <Detail icon="home" label={role === "teacher" ? "Affiliation" : "School or college"} value={institution} />
      </> : null}
    </View>

    {state === "ready" && !complete ? <Text style={[t.callout, { color: colors.mutedForeground }]}>Add the missing details so Fadko can send important account and class notices.</Text> : null}
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.xs }} testID={`${role}-account-privacy-note`}>
      <Feather name="lock" size={15} color={colors.mutedForeground} />
      <Text style={[t.caption, { flex: 1, color: colors.mutedForeground }]}>Your phone and precise account details stay private. Only you and Fadko Support can see them.</Text>
    </View>
  </View>;

  function Detail({ icon, label, value }: { icon: React.ComponentProps<typeof Feather>["name"]; label: string; value: string }) {
    return <View style={{ minHeight: HIT_SLOP_MIN + space.xs, flexDirection: "row", alignItems: "center", gap: space.sm, borderBottomWidth: label === (role === "teacher" ? "Affiliation" : "School or college") ? 0 : 1, borderBottomColor: colors.border }}>
      <Feather name={icon} size={17} color={colors.mutedForeground} />
      <View style={{ flex: 1 }}><Text style={[t.caption, { color: colors.mutedForeground }]}>{label}</Text><Text style={[t.callout, { color: colors.foreground }]}>{value}</Text></View>
    </View>;
  }
}
