import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPost } from "@/utils/api";
import {
  ProgramBackControl,
  ProgramButton,
} from "@/components/programs/ProgramPieces";
type Closure = { status: string; version: number };
export default function AccountClosure() {
  const { user } = useAuth();
  return user && ["student", "teacher"].includes(user.role) ? (
    <Workspace key={user.id} />
  ) : null;
}
function Workspace() {
  const { user } = useAuth();
  const colors = useColors();
  const { t, space, radius, gutter } = useLayout();
  const [request, setRequest] = useState<Closure | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void apiGet<{ request: Closure | null }>("/account-closure")
      .then((data) => {
        if (active) {
          setRequest(data.request);
          setReady(true);
        }
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not load your request.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const save = async (cancel = false) => {
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    try {
      if (cancel) {
        await apiPost("/account-closure/cancel", { version: request?.version });
        setRequest(null);
      } else {
        const result = await apiPost<{ request: Closure }>("/account-closure", {
          confirmed: true,
        });
        setRequest(result.request);
      }
      setConfirm(false);
    } catch (e) {
      setReady(false);
      setError(
        e instanceof Error
          ? e.message
          : "The request could not be saved. Reopen this screen to check its status.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: gutter,
        gap: space.lg,
        width: "100%",
        maxWidth: 720,
        alignSelf: "center",
        paddingBottom: space.huge * 3,
      }}
    >
      <ProgramBackControl
        testID="closure-back"
        label="Back"
        onPress={() => router.back()}
      />
      <Text style={[t.title1, { color: colors.foreground }]}>
        Close your account
      </Text>
      <View
        style={{
          padding: space.lg,
          gap: space.md,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.lg,
        }}
      >
        <Text style={[t.title3, { color: colors.foreground }]}>
          {request?.status === "requested"
            ? "Your request is with Support"
            : "Your commitments come first"}
        </Text>
        <Text style={[t.body, { color: colors.mutedForeground }]}>
          You can still sign in and use your account while Support resolves
          lessons, payments, refunds, make-ups and disputes. Requesting closure
          does not cancel a booking or issue a refund.
        </Text>
        <Text style={[t.callout, { color: colors.mutedForeground }]}>
          Private identity reference details are retained for one year after
          closure is completed. Document images follow their separate deletion
          deadlines. An active fraud investigation may require longer
          preservation.
        </Text>
      </View>
      {!!error && (
        <Text
          accessibilityRole="alert"
          style={[t.body, { color: colors.destructive }]}
        >
          {error}
        </Text>
      )}
      {!!error && (
        <ProgramButton
          label="Contact Fadko Support"
          onPress={() =>
            router.push(
              user?.role === "teacher"
                ? "/(teacher)/support"
                : "/(student)/support",
            )
          }
        />
      )}
      {ready && request?.status === "requested" ? (
        <ProgramButton
          label="Keep my account — cancel request"
          disabled={busy}
          onPress={() => void save(true)}
        />
      ) : (
        ready && (
          <>
            {confirm && (
              <Text
                accessibilityRole="alert"
                style={[t.body, { color: colors.foreground }]}
              >
                Send a closure request to Support? Your account stays open
                during review. You can cancel this request.
              </Text>
            )}
            <ProgramButton
              label={
                busy
                  ? "Saving…"
                  : confirm
                    ? "Confirm closure request"
                    : "Request account closure"
              }
              disabled={busy}
              onPress={() => (confirm ? void save() : setConfirm(true))}
            />
            {confirm && (
              <ProgramButton
                label="Not now"
                disabled={busy}
                onPress={() => setConfirm(false)}
              />
            )}
          </>
        )
      )}
    </ScrollView>
  );
}
