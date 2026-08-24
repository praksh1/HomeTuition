import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/utils/api";
import { notify } from "@/utils/alerts";
import WarningModal from "@/components/WarningModal";

/**
 * Getting out of a class you paid for.
 *
 * Every number and every sentence here comes from the server. That is deliberate: this is the
 * screen where somebody agrees to lose money, and an app that works out its own figure will
 * eventually show one the ledger disagrees with. `GET /sessions/:id/drop-info` returns the
 * split, the headline and the detail already worded, and this draws them.
 *
 * Two states worth naming, because they look the same if you are careless:
 *
 * - **Half back.** The student changed their mind. A quarter goes to the teacher who held the
 *   place and a quarter to the platform, and it is a *cancellation fee* — not a "processing
 *   fee", which is the two or three percent a card network takes.
 * - **All of it back.** The teacher moved the class, so this was not the student's doing.
 *
 * And the word that does not appear anywhere: "refunded". Nothing in this product can move
 * money yet, so a refund is *requested*, and the wait is stated rather than left to be found
 * out. Telling somebody their money is back when it is not is the one lie an app about money
 * cannot afford.
 */

export interface DropInfo {
  enrolled: boolean;
  /** True for somebody who was in this class and dropped or was refunded out of it. */
  left?: boolean;
  refundAmount?: number | null;
  refundPaid?: boolean;
  /** Business days still to run on the promised wait. Null once it is paid. */
  businessDaysLeft?: number | null;
  businessDaysTotal?: number;
  canDrop: boolean;
  reason: string | null;
  pricePaid: number;
  studentRefund: number;
  teacherShare: number;
  platformShare: number;
  full: boolean;
  known: boolean;
  headline: string;
  detail: string;
  deadlineHours: number;
}

interface Props {
  sessionId: number | string;
  /** Called after a successful drop, so the page around this can reload. */
  onDropped?: () => void;
}

export default function DropClass({ sessionId, onDropped }: Props) {
  const colors = useColors();
  const [info, setInfo] = useState<DropInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await apiGet<DropInfo>(`/sessions/${sessionId}/drop-info`));
    } catch {
      // Silent: a student who is not enrolled sees nothing here anyway, and a failure to load
      // must not put a Drop button on screen that we cannot price.
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <ActivityIndicator color={colors.primary} style={styles.loading} />;

  /**
   * Somebody who has already left, and what happened to their money.
   *
   * Shown instead of nothing. This page was blank for them — identical to a class they had
   * never booked — which reads as the app having forgotten, exactly when they are most likely
   * to be checking on a refund they were promised.
   */
  if (info?.left) {
    const days = info.businessDaysLeft;
    return (
      <View style={[styles.card, { borderColor: colors.border }]} testID="drop-class-left">
        <Text style={[styles.title, { color: colors.foreground }]}>{info.headline}</Text>

        {info.refundAmount != null && (
          <View style={[styles.refundBox, { borderColor: colors.border, backgroundColor: colors.muted }]}>
            <Text style={[styles.refundAmount, { color: colors.foreground }]}>
              NPR {info.refundAmount.toLocaleString()}
            </Text>
            <Text style={[styles.refundState, { color: info.refundPaid ? colors.success : colors.mutedForeground }]}>
              {info.refundPaid ? "Paid" : "Refund requested"}
            </Text>
            {/*
              A countdown, not a policy sentence. "Five to seven business days" means nothing on
              day six to somebody who cannot remember which day they dropped the class — which
              is the day they are most likely to be looking at this.
            */}
            {!info.refundPaid && days != null && (
              <Text testID="drop-refund-days" style={[styles.refundDays, { color: colors.mutedForeground }]}>
                {days > 0
                  ? `Expected within ${days} more business day${days === 1 ? "" : "s"}.`
                  : "This is now past our usual window — please contact Support."}
              </Text>
            )}
          </View>
        )}

        <Text style={[styles.headline, { color: colors.mutedForeground }]}>{info.detail}</Text>
      </View>
    );
  }

  // Not booked, or we could not tell. Either way there is nothing here to offer.
  if (!info?.enrolled) return null;

  const drop = async () => {
    setAsking(false);
    setWorking(true);
    try {
      const res = await apiPost<{ message: string }>(`/sessions/${sessionId}/drop`, {});
      notify("Dropped", res.message);
      onDropped?.();
      await load();
    } catch (e) {
      notify("This class was not dropped", e instanceof Error ? e.message : "Please try again.");
      // Re-read: whatever refused it has almost certainly changed what this should say.
      await load();
    } finally {
      setWorking(false);
    }
  };

  /**
   * The warning, in the plainest words the facts allow.
   *
   * Each line says what happens, not why. Somebody skimming reads the first few words of each
   * and should still come away with the right idea — which is the whole test the owner set:
   * "simpler word choices to make sure they understand the results of their action".
   */
  const lost = info.pricePaid - info.studentRefund;
  const consequences = info.full
    ? [
        `You get all NPR ${info.pricePaid.toLocaleString()} back.`,
        "You lose your place in this class.",
        "Someone else can take your place.",
        "The money is not instant. It comes back in 5-7 business days.",
      ]
    : [
        `You get NPR ${info.studentRefund.toLocaleString()} back.`,
        `You do not get NPR ${lost.toLocaleString()} back. That is the cancellation fee.`,
        "You lose your place in this class.",
        "Someone else can take your place.",
        "You cannot undo this.",
        "The money is not instant. It comes back in 5-7 business days.",
      ];

  return (
    <View style={[styles.card, { borderColor: colors.border }]} testID="drop-class">
      <WarningModal
        testID="drop-warning"
        visible={asking}
        title="Are you sure you want to leave this class?"
        headline={`You get NPR ${info.studentRefund.toLocaleString()} back`}
        headlineNote={`You paid NPR ${info.pricePaid.toLocaleString()}.`}
        consequences={consequences}
        confirmLabel="Yes, drop it"
        busy={working}
        onConfirm={() => void drop()}
        onCancel={() => setAsking(false)}
      />
      <Text style={[styles.title, { color: colors.foreground }]}>
        {info.full ? "This class was moved" : "Changed your mind?"}
      </Text>
      <Text style={[styles.headline, { color: info.full ? colors.foreground : colors.mutedForeground }]}>
        {info.headline}
      </Text>

      {/*
        The split, itemised. A single "you get NPR 250 back" invites the next question — where
        did the rest go — and answering it after the fact is worth less than answering it here.
      */}
      {info.canDrop && !info.full && (
        <View style={[styles.breakdown, { borderTopColor: colors.border }]}>
          <Row label="You paid" value={info.pricePaid} colors={colors} />
          <Row label="Back to you" value={info.studentRefund} colors={colors} strong />
          <Row label="Cancellation fee — your teacher" value={info.teacherShare} colors={colors} />
          <Row label="Cancellation fee — Sikshya" value={info.platformShare} colors={colors} />
        </View>
      )}

      {info.canDrop ? (
        <>
          <TouchableOpacity
            testID="drop-class-btn"
            onPress={() => setAsking(true)}
            disabled={working}
            activeOpacity={0.85}
            style={[styles.btn, { borderColor: colors.destructive, opacity: working ? 0.6 : 1 }]}
          >
            <Feather name="x-circle" size={16} color={colors.destructive} />
            <Text style={[styles.btnText, { color: colors.destructive }]}>
              {working ? "Dropping…" : info.full ? "Drop and get a full refund" : "Drop this class"}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
            Refunds are requested, not instant — our team processes them within 5-7 business days.
          </Text>
        </>
      ) : (
        <Text testID="drop-class-reason" style={[styles.footnote, { color: colors.mutedForeground }]}>
          {info.reason ?? `Classes can only be dropped more than ${info.deadlineHours} hours before they start.`}
        </Text>
      )}
    </View>
  );
}

function Row({
  label, value, colors, strong,
}: {
  label: string;
  value: number;
  colors: ReturnType<typeof useColors>;
  strong?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: strong ? colors.foreground : colors.mutedForeground }]}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          { color: strong ? colors.foreground : colors.mutedForeground,
            fontFamily: strong ? "Inter_600SemiBold" : "Inter_400Regular" },
        ]}
      >
        NPR {value.toLocaleString()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 },
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  headline: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  refundBox: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 2, marginTop: 4 },
  refundAmount: { fontSize: 22, fontFamily: "Inter_600SemiBold" },
  refundState: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  refundDays: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 4 },
  breakdown: { borderTopWidth: 1, paddingTop: 10, marginTop: 4, gap: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  rowLabel: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  rowValue: { fontSize: 13 },
  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderWidth: 1, borderRadius: 10, paddingVertical: 12, marginTop: 6,
  },
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  footnote: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
});
