import React, { useCallback, useEffect, useRef, useState } from "react";
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

type RequestRow = {
  userId: number;
  name: string;
  role: string;
  version: number;
  requestedAt: string;
};
type Evidence = {
  commitments: {
    upcomingLessons: number;
    pendingPayments: number;
    openDisputes: number;
    pendingMakeups: number;
    complete: boolean;
  };
  blockers: string[];
  completionAvailable: boolean;
  request: { status: string; version: number };
  pendingMedia: number;
};
export default function AccountClosures() {
  const { user } = useAuth();
  return user?.role === "admin" ? <Workspace key={user.id} /> : null;
}
function Workspace() {
  const colors = useColors();
  const { t, space, radius, gutter } = useLayout();
  const [items, setItems] = useState<RequestRow[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [selected, setSelected] = useState<RequestRow | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async (after?: number) => {
    const stamp = ++generation.current;
    setBusy(true);
    setError("");
    setSelected(null);
    setEvidence(null);
    setConfirming(false);
    try {
      const data = await apiGet<{
        items: RequestRow[];
        nextCursor: number | null;
      }>(`/account-closure-review${after ? `?after=${after}` : ""}`);
      if (stamp !== generation.current) return;
      setItems((old) =>
        after
          ? [
              ...old,
              ...data.items.filter(
                (row) => !old.some((item) => item.userId === row.userId),
              ),
            ]
          : data.items,
      );
      setCursor(data.nextCursor);
    } catch (e) {
      if (stamp === generation.current)
        setError(e instanceof Error ? e.message : "Requests could not load.");
    } finally {
      if (stamp === generation.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  const open = async (row: RequestRow) => {
    const stamp = ++generation.current;
    setSelected(row);
    setEvidence(null);
    setBusy(true);
    setError("");
    setConfirming(false);
    setNotice("");
    try {
      const data = await apiGet<Evidence>(
        `/account-closure-review/${row.userId}`,
      );
      if (stamp === generation.current) setEvidence(data);
    } catch (e) {
      if (stamp === generation.current)
        setError(
          e instanceof Error ? e.message : "Commitments could not be checked.",
        );
    } finally {
      if (stamp === generation.current) setBusy(false);
    }
  };
  const complete = async () => {
    if (!selected || !evidence || busy || !confirming) return;
    const stamp = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await apiPost<{ closed: boolean; pendingMedia: number }>(
        `/account-closure-review/${selected.userId}/complete`,
        { version: evidence.request.version, confirmed: true },
      );
      if (stamp !== generation.current) return;
      setNotice(
        result.pendingMedia
          ? "Account sign-in is closed. Video disconnection is queued; verify it before considering access cleanup finished."
          : "Account closure completed.",
      );
      setItems((old) => old.filter((row) => row.userId !== selected.userId));
      setSelected(null);
      setEvidence(null);
    } catch (e) {
      if (stamp === generation.current) {
        setEvidence(null);
        setError(
          e instanceof Error
            ? e.message
            : "Closure was not confirmed. Reload the request.",
        );
      }
    } finally {
      if (stamp === generation.current) {
        setBusy(false);
        setConfirming(false);
      }
    }
  };
  const card = {
    padding: space.lg,
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
  };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: gutter,
        gap: space.lg,
        width: "100%",
        maxWidth: 960,
        alignSelf: "center",
        paddingBottom: space.huge * 3,
      }}
    >
      <ProgramBackControl
        testID="closure-review-back"
        label="Support desk"
        onPress={() => router.push("/(admin)")}
      />
      <Text style={[t.title1, { color: colors.foreground }]}>
        Account closure requests
      </Text>
      <Text style={[t.body, { color: colors.mutedForeground }]}>
        Resolve commitments before closing an account. Requesting closure does
        not stop sign-in, classes or Support access.
      </Text>
      {!!error && (
        <Text
          accessibilityRole="alert"
          style={[t.body, { color: colors.destructive }]}
        >
          {error}
        </Text>
      )}
      {!!notice && (
        <Text
          accessibilityRole="alert"
          style={[t.body, { color: colors.foreground }]}
        >
          {notice}
        </Text>
      )}
      <ProgramButton
        label={busy ? "Checking…" : "Refresh requests"}
        disabled={busy}
        onPress={() => void load()}
      />
      {!busy && !error && !items.length && (
        <Text style={[t.body, { color: colors.mutedForeground }]}>
          No open closure requests.
        </Text>
      )}
      {items.map((row) => (
        <View key={row.userId} style={card}>
          <Text style={[t.title3, { color: colors.foreground }]}>
            {row.name}
          </Text>
          <Text style={[t.caption, { color: colors.mutedForeground }]}>
            {row.role} · Account {row.userId}
          </Text>
          <ProgramButton
            label="Review commitments"
            disabled={busy}
            onPress={() => void open(row)}
          />
          {selected?.userId === row.userId && evidence && (
            <View style={{ gap: space.sm }}>
              {[
                [
                  "Lessons and published offers",
                  evidence.commitments.upcomingLessons,
                ],
                [
                  "Payment records to resolve",
                  evidence.commitments.pendingPayments,
                ],
                ["Open disputes", evidence.commitments.openDisputes],
                ["Make-up commitments", evidence.commitments.pendingMakeups],
              ].map(([label, count]) => (
                <Text
                  key={String(label)}
                  style={[t.body, { color: colors.foreground }]}
                >
                  {label}: {count}
                </Text>
              ))}
              {!evidence.commitments.complete && (
                <Text style={[t.body, { color: colors.warn }]}>
                  Some payment history needs reconciliation. These counts are
                  not an all-clear.
                </Text>
              )}
              {evidence.request?.status === "closed" && (
                <Text style={[t.body, { color: colors.warn }]}>
                  Account sign-in is closed. {evidence.pendingMedia} video
                  disconnection tasks remain. Refresh to verify completion.
                </Text>
              )}
              {!evidence.completionAvailable && (
                <Text style={[t.callout, { color: colors.mutedForeground }]}>
                  Final closure is not enabled yet. This review does not issue
                  refunds, cancel classes or start the retention clock.
                </Text>
              )}
              {evidence.completionAvailable &&
                evidence.blockers.length === 0 &&
                evidence.request.status === "requested" && (
                  <>
                    {confirming && (
                      <Text
                        accessibilityRole="alert"
                        style={[t.body, { color: colors.destructive }]}
                      >
                        Close this account permanently? Sign-in will stop and
                        the one-year identity-reference retention clock will
                        begin. No refund or financial settlement is made by this
                        action.
                      </Text>
                    )}
                    <ProgramButton
                      label={
                        confirming
                          ? "Confirm permanent closure"
                          : "Close reviewed account"
                      }
                      disabled={busy}
                      onPress={() =>
                        confirming ? void complete() : setConfirming(true)
                      }
                    />
                    {confirming && (
                      <ProgramButton
                        label="Keep account open"
                        disabled={busy}
                        onPress={() => setConfirming(false)}
                      />
                    )}
                  </>
                )}
            </View>
          )}
        </View>
      ))}
      {cursor !== null && (
        <ProgramButton
          label="Load more requests"
          disabled={busy}
          onPress={() => void load(cursor)}
        />
      )}
    </ScrollView>
  );
}
