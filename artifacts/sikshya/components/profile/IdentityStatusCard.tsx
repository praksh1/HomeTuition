import React, { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { ProgramButton, ProgramChip } from "@/components/programs/ProgramPieces";
import { apiGet } from "@/utils/api";
import type { IdentityStatusResponse } from "@/utils/identityStatus";

export function IdentityStatusCard() {
  const colors = useColors(); const { t, space, radius } = useLayout();
  const [result, setResult] = useState<IdentityStatusResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    apiGet<IdentityStatusResponse>("/identity-verification/me").then(data => { if (active) { setResult(data); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []));
  if (!failed && !result?.enabled) return null;
  const status = result?.verification?.status;
  const label = failed ? "Status unavailable" : status === "approved" ? "Identity approved" : status === "submitted" ? "In review" : status === "rejected" ? "Needs a correction" : "Not yet submitted";
  return <View testID="profile-identity-status" style={{ padding: space.md, gap: space.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card }}>
    <Text style={[t.title3, { color: colors.foreground }]}>Private verification</Text>
    <ProgramChip label={label} tone={status === "approved" && !failed ? "live" : "waiting"} />
    <Text style={[t.callout, { color: colors.mutedForeground }]}>Citizenship details are kept separate from your public profile and AI Support.</Text>
    <ProgramButton label={failed ? "Check verification status" : status === "submitted" || status === "approved" ? "View verification" : "Complete private verification"} onPress={() => router.push("/identity-verification")} />
  </View>;
}
