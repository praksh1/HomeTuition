import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiPost } from "@/utils/api";

export default function VerifyEmail() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const colors = useColors();
  const { t, gutter, space, radius } = useLayout();
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState("Checking your verification link…");

  useEffect(() => {
    let active = true;
    void apiPost<{ verified: boolean }>("/auth/verification/confirm", { token: token ?? "" })
      .then(() => { if (active) { setState("done"); setMessage("Your email is verified. You can continue securely."); } })
      .catch((error) => { if (active) { setState("failed"); setMessage(error instanceof Error ? error.message : "This link could not be verified."); } });
    return () => { active = false; };
  }, [token]);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: gutter, gap: space.md, backgroundColor: colors.background }}>
      {state === "working" ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <View style={{ padding: space.md, borderRadius: radius.pill, backgroundColor: state === "done" ? colors.successSoft : colors.destructiveSoft }}>
          <Feather name={state === "done" ? "check" : "alert-circle"} size={32} color={state === "done" ? colors.success : colors.destructive} />
        </View>
      )}
      <Text style={[t.title2, { color: colors.foreground, textAlign: "center" }]}>{state === "done" ? "Email verified" : state === "failed" ? "Link not accepted" : "Verifying"}</Text>
      <Text style={[t.body, { color: colors.mutedForeground, textAlign: "center" }]}>{message}</Text>
      {state !== "working" && (
        <TouchableOpacity onPress={() => router.replace((state === "done" ? "/" : "/check-email") as never)} activeOpacity={0.85} style={{ minHeight: 48, minWidth: 180, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}>
          <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>{state === "done" ? "Continue" : "Request a new link"}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
