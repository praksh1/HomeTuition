import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet } from "@/utils/api";

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

  const affiliationComplete = details?.affiliationStatus === "independent" || Boolean(details?.institutionName);
  const complete = Boolean(details?.phone && details.province && details.district && details.localLevel && affiliationComplete);
  const institution = details?.affiliationStatus === "independent"
    ? role === "teacher" ? "Independent teacher" : "Not applicable"
    : details?.institutionName || "School or institution not added";
  const place = [details?.locality, details?.localLevel, details?.district, details?.province].filter(Boolean).join(", ");

  return <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: space.md, gap: space.sm }} testID={`${role}-account-details`}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <View style={{ flex: 1, gap: space.xxs }}>
        <Text accessibilityRole="header" style={[t.title3, { color: colors.foreground }]}>Account details</Text>
        {state === "ready" && <Text style={[t.caption, { color: complete ? colors.success : colors.warn }]}>{complete ? "Up to date" : "Needs your attention"}</Text>}
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Edit account details"
        onPress={() => router.push({ pathname: "/onboarding", params: { edit: "1", role } } as never)}
        activeOpacity={0.75}
        style={{ minHeight: HIT_SLOP_MIN, minWidth: HIT_SLOP_MIN, paddingHorizontal: space.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary, justifyContent: "center", alignItems: "center" }}
        testID={`${role}-edit-account-details`}
      >
        <Text style={[t.bodyStrong, { color: colors.primary }]}>{complete ? "Edit" : "Add details"}</Text>
      </TouchableOpacity>
    </View>

    <View style={{ minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <Feather name="mail" size={17} color={colors.mutedForeground} />
      <View style={{ flex: 1 }}>
        <Text style={[t.caption, { color: colors.mutedForeground }]}>Login email</Text>
        <Text style={[t.callout, { color: colors.foreground }]} numberOfLines={2}>{email}</Text>
      </View>
    </View>

    {state === "loading" ? <View style={{ minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.sm }}><ActivityIndicator color={colors.primary} /><Text style={[t.callout, { color: colors.mutedForeground }]}>Loading your details…</Text></View> : null}
    {state === "error" ? <View style={{ gap: space.xs }}><Text style={[t.callout, { color: colors.destructive }]}>We could not load these details. Nothing was changed.</Text><TouchableOpacity accessibilityRole="button" onPress={() => void load()} style={{ minHeight: HIT_SLOP_MIN, justifyContent: "center" }}><Text style={[t.bodyStrong, { color: colors.primary }]}>Try again</Text></TouchableOpacity></View> : null}
    {state === "ready" ? <>
      <Detail icon="phone" label="Phone" value={details?.phone || "Phone number not added"} />
      <Detail icon="map-pin" label="Location" value={place || "Location not added"} />
      <Detail icon="home" label={role === "teacher" ? "Affiliation" : "School or college"} value={institution} />
      {!complete ? <Text style={[t.callout, { color: colors.mutedForeground }]}>Add the missing details so Fadko can send important account and class notices.</Text> : null}
    </> : null}
  </View>;

  function Detail({ icon, label, value }: { icon: React.ComponentProps<typeof Feather>["name"]; label: string; value: string }) {
    return <View style={{ minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <Feather name={icon} size={17} color={colors.mutedForeground} />
      <View style={{ flex: 1 }}><Text style={[t.caption, { color: colors.mutedForeground }]}>{label}</Text><Text style={[t.callout, { color: colors.foreground }]}>{value}</Text></View>
    </View>;
  }
}
