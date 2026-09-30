import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet } from "@/utils/api";
import {
  fadkoFeeAllocation,
  participantMoneyStatement,
  participantReceiptStatus,
  participantTestTotals,
  teacherReceiptBreakdown,
  testReceiptNepalTime,
  type ParticipantMoneyStatementRow,
  type ParticipantTestReceipt,
} from "@/utils/batchTestMoney";
import {
  ProgramButton,
  ProgramCardShell,
  ProgramNotice,
} from "../programs/ProgramPieces";

function MakeupReceiptEvidence({
  receipt,
  role,
}: {
  receipt: ParticipantTestReceipt;
  role: "student" | "teacher";
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const affected = receipt.allocations.filter(
    (allocation) => allocation.remedy,
  );
  if (!affected.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      {affected.map((allocation) => {
        const remedy = allocation.remedy!;
        const amount =
          role === "teacher" ? allocation.teacherNpr : allocation.grossNpr;
        return (
          <View
            key={allocation.position}
            testID={`receipt-remedy-${receipt.bookingId}-${allocation.position}`}
            style={{
              gap: space.xs,
              padding: space.sm,
              borderRadius: radius.sm,
              backgroundColor: colors.actionSoft,
            }}
          >
            <Text style={[t.bodyStrong, { color: colors.primary }]}>
              Lesson {allocation.position + 1} · Linked make-up
            </Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>
              {receipt.classTitle} · Original receipt {receipt.reference}
            </Text>
            <Text style={[t.caption, { color: colors.foreground }]}>
              {remedy.allocationHeld
                ? `Original ${role === "teacher" ? "earnings" : "lesson payment"} on hold${Number.isSafeInteger(amount) ? ` · NPR ${amount!.toLocaleString("en-NP")}` : ""}`
                : "See the original lesson allocation for its current settlement status"}
            </Text>
            {remedy.replacementStartsAt ? (
              <Text style={[t.caption, { color: colors.foreground }]}>
                Replacement · {testReceiptNepalTime(remedy.replacementStartsAt)}
              </Text>
            ) : null}
            {remedy.reviewClosesAt ? (
              <Text style={[t.caption, { color: colors.foreground }]}>
                Review closes · {testReceiptNepalTime(remedy.reviewClosesAt)}
              </Text>
            ) : null}
            <Text style={[t.caption, { color: colors.mutedForeground }]}>
              Additional tuition: NPR 0 · Not a second payment or earning
            </Text>
            <ProgramButton
              label="Open linked make-up record"
              onPress={() =>
                router.push({
                  pathname: "/makeups",
                  params: {
                    id: String(receipt.batchId),
                    sessionId: String(remedy.originalSessionId),
                  },
                })
              }
            />
          </View>
        );
      })}
    </View>
  );
}

function Money({ value }: { value: number }) {
  const colors = useColors();
  const { t, numeric } = useLayout();
  return (
    <Text style={[t.title3, numeric, { color: colors.foreground }]}>
      NPR {value.toLocaleString("en-NP")}
    </Text>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  const colors = useColors();
  const { t, space } = useLayout();
  return (
    <View style={{ flexBasis: "46%", flexGrow: 1, gap: space.xxs }}>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Money value={value} />
    </View>
  );
}

function StatementRow({ row }: { row: ParticipantMoneyStatementRow }) {
  const colors = useColors();
  const { t, space, numeric } = useLayout();
  const sign =
    row.direction === "credit" ? "+ " : row.direction === "debit" ? "− " : "";
  return (
    <View
      testID={`money-transaction-${row.id}`}
      accessibilityRole="summary"
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: space.md,
        paddingVertical: space.sm,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: space.xxs }}>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>
          {row.title}
        </Text>
        <Text style={[t.caption, { color: colors.mutedForeground }]}>
          {row.detail}
        </Text>
        <Text style={[t.caption, { color: colors.mutedForeground }]}>
          {testReceiptNepalTime(row.occurredAt)}
        </Text>
      </View>
      <View style={{ flexShrink: 0, alignItems: "flex-end", gap: space.xxs }}>
        <Text
          testID={`money-amount-${row.id}`}
          style={[
            t.bodyStrong,
            numeric,
            {
              color:
                row.direction === "credit"
                  ? colors.success
                  : row.section === "pending"
                    ? colors.mutedForeground
                    : colors.foreground,
              fontStyle: row.section === "pending" ? "italic" : "normal",
              textAlign: "right",
            },
          ]}
        >
          {sign}NPR {row.amountNpr.toLocaleString("en-NP")}
        </Text>
        <Text
          style={[
            t.caption,
            {
              color:
                row.section === "pending"
                  ? colors.mutedForeground
                  : colors.foreground,
              fontStyle: row.section === "pending" ? "italic" : "normal",
              textAlign: "right",
            },
          ]}
        >
          {row.status}
        </Text>
      </View>
    </View>
  );
}

function StatementSection({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: ParticipantMoneyStatementRow[];
  empty?: string;
}) {
  const colors = useColors();
  const { t, space } = useLayout();
  const [visible, setVisible] = useState(8);
  if (!rows.length && !empty) return null;
  return (
    <View
      testID={`money-statement-${title.toLowerCase()}`}
      style={{ gap: space.xs }}
    >
      <Text
        accessibilityRole="header"
        style={[t.bodyStrong, { color: colors.foreground }]}
      >
        {title}
      </Text>
      {rows.length ? (
        rows
          .slice(0, visible)
          .map((row) => <StatementRow key={row.id} row={row} />)
      ) : (
        <Text style={[t.caption, { color: colors.mutedForeground }]}>
          {empty}
        </Text>
      )}
      {rows.length > visible ? (
        <ProgramButton
          label={`Show more ${title.toLowerCase()} (${rows.length - visible})`}
          onPress={() => setVisible((count) => count + 8)}
        />
      ) : null}
    </View>
  );
}

function lessonEarningStatus(state: string): string {
  const labels: Record<string, string> = {
    future: "Scheduled",
    delivered_pending: "In lesson review",
    eligible: "Eligible for payout",
    disputed: "Under support review",
    replacement_pending: "Make-up or refund review",
    refund_owed: "Refund approved",
    refunded: "Refunded",
    paid_out: "Payout recorded",
  };
  return labels[state] ?? "Status unavailable";
}

/** A read-only, participant-scoped summary of simulated payments. */
export function BatchTestMoneySummary({
  role,
}: {
  role: "student" | "teacher";
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const [receipts, setReceipts] = useState<ParticipantTestReceipt[] | null>(
    null,
  );
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [makeupsEnabled, setMakeupsEnabled] = useState(false);
  const [receiptQuery, setReceiptQuery] = useState("");
  const [visibleReceipts, setVisibleReceipts] = useState(8);
  const [expandedReceiptIds, setExpandedReceiptIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [expandedFeeIds, setExpandedFeeIds] = useState<Set<number>>(
    () => new Set(),
  );

  function toggleReceipt(bookingId: number) {
    setExpandedReceiptIds((current) => {
      const next = new Set(current);
      if (next.has(bookingId)) next.delete(bookingId);
      else next.add(bookingId);
      return next;
    });
  }

  function toggleFee(bookingId: number) {
    setExpandedFeeIds((current) => {
      const next = new Set(current);
      if (next.has(bookingId)) next.delete(bookingId);
      else next.add(bookingId);
      return next;
    });
  }

  async function load(cursor?: number) {
    setBusy(true);
    setError("");
    try {
      const result = await apiGet<{
        receipts: ParticipantTestReceipt[];
        nextCursor?: number | null;
        makeupsEnabled?: boolean;
      }>(`/batch-tests/me/payments${cursor ? `?cursor=${cursor}` : ""}`);
      setReceipts((current) =>
        cursor ? [...(current ?? []), ...result.receipts] : result.receipts,
      );
      setNextCursor(result.nextCursor ?? null);
      setMakeupsEnabled(result.makeupsEnabled === true);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load test payment details.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);
  const totals = useMemo(
    () => participantTestTotals(receipts ?? []),
    [receipts],
  );
  const statement = useMemo(
    () => participantMoneyStatement(receipts ?? [], role),
    [receipts, role],
  );
  const matchingReceipts = useMemo(() => {
    const query = receiptQuery.trim().toLocaleLowerCase();
    const ordered = [...(receipts ?? [])].sort(
      (a, b) =>
        Date.parse(b.recordedAt) - Date.parse(a.recordedAt) ||
        b.bookingId - a.bookingId,
    );
    return query
      ? ordered.filter((receipt) =>
          `${receipt.classTitle} ${receipt.studentName ?? ""} ${receipt.reference}`
            .toLocaleLowerCase()
            .includes(query),
        )
      : ordered;
  }, [receipts, receiptQuery]);
  if (!busy && !error && receipts?.length === 0) return null;

  return (
    <ProgramCardShell testID={`participant-test-money-${role}`}>
      <View style={{ gap: space.xxs }}>
        <Text
          accessibilityRole="header"
          style={[t.title3, { color: colors.foreground }]}
        >
          {role === "teacher"
            ? "Test earnings summary"
            : "Test payment summary"}
        </Text>
        <Text style={[t.caption, { color: colors.mutedForeground }]}>
          Practice records only · no real money moved
        </Text>
      </View>
      {error ? (
        <ProgramNotice
          title="Test totals could not be loaded"
          body={error}
          tone="stopped"
        >
          <ProgramButton
            label="Try again"
            busy={busy}
            onPress={() =>
              void load(
                receipts?.length ? (nextCursor ?? undefined) : undefined,
              )
            }
          />
        </ProgramNotice>
      ) : null}
      {receipts?.length ? (
        <>
          {nextCursor !== null ? (
            <Text style={[t.caption, { color: colors.mutedForeground }]}>
              Older receipts are available. Amounts and search below cover
              loaded records only; load older receipts for more history.
            </Text>
          ) : null}
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: space.md,
              padding: space.sm,
              borderRadius: radius.sm,
              backgroundColor: colors.surfaceSunk,
            }}
          >
            {role === "teacher" ? (
              <>
                <Metric
                  label="Pending test earnings"
                  value={totals.teacherHeldNpr}
                />
                <Metric
                  label="Recorded test payout"
                  value={totals.teacherPaidOutNpr}
                />
                {totals.teacherRefundedNpr > 0 ? (
                  <Metric
                    label="Reversed after test refund"
                    value={totals.teacherRefundedNpr}
                  />
                ) : null}
              </>
            ) : (
              <>
                <Metric
                  label="Net test payments"
                  value={Math.max(0, totals.grossNpr - totals.refundedGrossNpr)}
                />
                <Metric label="Test payments" value={totals.grossNpr} />
                <Metric label="Test refunded" value={totals.refundedGrossNpr} />
              </>
            )}
          </View>
          <ProgramNotice
            title="Testing only"
            body={`These records show how payments and earnings will look. No real money was ${role === "teacher" ? "paid to you" : "charged"}.`}
            tone="neutral"
          />
          <ProgramNotice
            title={
              role === "teacher"
                ? "Why an amount may be on hold"
                : "How lesson reviews work"
            }
            body={
              role === "teacher"
                ? makeupsEnabled
                  ? "A make-up or dispute keeps the original lesson's share on hold. Confirmed replacement delivery starts a fresh 48-hour review window. The replacement does not earn a second payment. Eligibility is not a bank transfer."
                  : "A delivered lesson is reviewed for 48 hours after its scheduled end. A dispute holds the affected lesson's share for human review. Contact Support for make-up requests while the in-app process is unavailable. Eligibility is not a bank transfer."
                : makeupsEnabled
                  ? "Each lesson is tracked separately. Make-ups use the original lesson payment, with no additional tuition. Confirmed replacement delivery starts a fresh 48-hour review window. Refund decisions remain human-reviewed."
                  : "Each lesson is tracked separately. You can raise a concern during its 48-hour review window. Fadko reviews disputed lessons before deciding a refund or teacher payout. Contact Support to request a make-up."
            }
            tone="neutral"
          />
          {makeupsEnabled ? (
            <ProgramButton
              label={
                role === "teacher"
                  ? "Manage make-up lessons"
                  : "My make-up lessons"
              }
              icon="repeat"
              onPress={() => router.push("/makeups")}
            />
          ) : null}
          {role === "student"
            ? receipts
                .filter((receipt) =>
                  receipt.allocations.some((allocation) => allocation.remedy),
                )
                .map((receipt) => (
                  <MakeupReceiptEvidence
                    key={receipt.bookingId}
                    receipt={receipt}
                    role={role}
                  />
                ))
            : null}
          {role === "teacher" ? (
            <View style={{ gap: space.sm }}>
              <Text
                accessibilityRole="header"
                style={[t.title3, { color: colors.foreground }]}
              >
                Receipts by student and class
              </Text>
              <TextInput
                accessibilityLabel="Search receipts by class, student or reference"
                placeholder="Search class, student or receipt"
                placeholderTextColor={colors.mutedForeground}
                value={receiptQuery}
                onChangeText={(value) => {
                  setReceiptQuery(value);
                  setVisibleReceipts(8);
                }}
                style={[
                  t.body,
                  {
                    color: colors.foreground,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.sm,
                    padding: space.md,
                  },
                ]}
              />
              <Text style={[t.caption, { color: colors.mutedForeground }]}>
                Showing {Math.min(visibleReceipts, matchingReceipts.length)} of{" "}
                {matchingReceipts.length} matching loaded receipts
                {nextCursor ? " · Older receipts available" : ""}
              </Text>
              {matchingReceipts.slice(0, visibleReceipts).map((receipt) => {
                const breakdown = teacherReceiptBreakdown(receipt);
                const feeAllocation = breakdown
                  ? fadkoFeeAllocation(breakdown.fadkoFeeNpr)
                  : null;
                const expanded = expandedReceiptIds.has(receipt.bookingId);
                const feeExpanded = expandedFeeIds.has(receipt.bookingId);
                return (
                  <View
                    key={receipt.bookingId}
                    testID={`teacher-receipt-${receipt.bookingId}`}
                    style={{
                      padding: space.md,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      gap: space.xxs,
                    }}
                  >
                    <Text style={[t.bodyStrong, { color: colors.foreground }]}>
                      {receipt.classTitle}
                    </Text>
                    <Text style={[t.body, { color: colors.foreground }]}>
                      {receipt.studentName ?? "Student name unavailable"}
                    </Text>
                    <Text
                      style={[t.caption, { color: colors.mutedForeground }]}
                    >
                      Receipt {receipt.reference} ·{" "}
                      {testReceiptNepalTime(receipt.recordedAt)}
                    </Text>
                    {breakdown ? (
                      <>
                        <Text style={[t.body, { color: colors.foreground }]}>
                          Class price: NPR{" "}
                          {breakdown.tuitionNpr.toLocaleString("en-NP")}
                        </Text>
                        <Text style={[t.body, { color: colors.foreground }]}>
                          Less Fadko fee: − NPR{" "}
                          {breakdown.fadkoFeeNpr.toLocaleString("en-NP")}
                        </Text>
                        <Text style={[t.body, { color: colors.foreground }]}>
                          Less government tax: NPR 0
                        </Text>
                        <Text
                          style={[t.bodyStrong, { color: colors.foreground }]}
                        >
                          Estimated teacher earnings: NPR{" "}
                          {breakdown.teacherShareNpr.toLocaleString("en-NP")}
                        </Text>
                        <Text
                          style={[t.caption, { color: colors.mutedForeground }]}
                        >
                          This is a practice receipt. Live tax rules are not
                          configured.
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={
                            feeExpanded
                              ? "Hide Fadko fee details"
                              : "Show Fadko fee details"
                          }
                          onPress={() => toggleFee(receipt.bookingId)}
                          style={{
                            minHeight: 44,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: space.xs,
                          }}
                        >
                          <Feather
                            name="info"
                            size={17}
                            color={colors.primary}
                          />
                          <Text
                            style={[
                              t.bodyStrong,
                              { color: colors.primary, flex: 1 },
                            ]}
                          >
                            What does the Fadko fee cover?
                          </Text>
                          <Feather
                            name={feeExpanded ? "chevron-up" : "chevron-down"}
                            size={17}
                            color={colors.primary}
                          />
                        </Pressable>
                        {feeExpanded ? (
                          <View
                            style={{
                              padding: space.sm,
                              borderRadius: radius.sm,
                              backgroundColor: colors.surfaceSunk,
                              gap: space.xxs,
                            }}
                          >
                            {feeAllocation ? (
                              <>
                                <Text
                                  style={[t.body, { color: colors.foreground }]}
                                >
                                  Platform fee: NPR{" "}
                                  {feeAllocation.platformNpr.toLocaleString(
                                    "en-NP",
                                  )}
                                </Text>
                                <Text
                                  style={[t.body, { color: colors.foreground }]}
                                >
                                  Video and server fee: NPR{" "}
                                  {feeAllocation.serverNpr.toLocaleString(
                                    "en-NP",
                                  )}
                                </Text>
                                <Text
                                  style={[t.body, { color: colors.foreground }]}
                                >
                                  Maintenance fee: NPR{" "}
                                  {feeAllocation.maintenanceNpr.toLocaleString(
                                    "en-NP",
                                  )}
                                </Text>
                              </>
                            ) : (
                              <Text
                                style={[t.body, { color: colors.foreground }]}
                              >
                                Fee details are unavailable for this receipt.
                              </Text>
                            )}
                            <Text
                              style={[
                                t.caption,
                                { color: colors.mutedForeground },
                              ]}
                            >
                              These parts allocate the recorded Fadko fee. They
                              are not extra deductions or measured vendor
                              expenses.
                            </Text>
                          </View>
                        ) : null}
                        <ProgramButton
                          label={`${expanded ? "Hide" : "View"} lesson breakdown (${receipt.allocations.length})`}
                          onPress={() => toggleReceipt(receipt.bookingId)}
                        />
                        {expanded
                          ? receipt.allocations.map((allocation) => {
                              const gross = allocation.grossNpr;
                              const fadko = allocation.fadkoNpr;
                              const teacher = allocation.teacherNpr;
                              const balanced =
                                Number.isSafeInteger(gross) &&
                                Number.isSafeInteger(fadko) &&
                                Number.isSafeInteger(teacher) &&
                                gross! >= 0 &&
                                fadko! >= 0 &&
                                teacher! >= 0 &&
                                gross === fadko! + teacher!;
                              return (
                                <View
                                  key={allocation.position}
                                  style={{
                                    borderTopWidth: 1,
                                    borderTopColor: colors.border,
                                    paddingVertical: space.xs,
                                    gap: space.xxs,
                                  }}
                                >
                                  <Text
                                    style={[
                                      t.bodyStrong,
                                      { color: colors.foreground },
                                    ]}
                                  >
                                    Lesson {allocation.position + 1}
                                  </Text>
                                  {balanced ? (
                                    <Text
                                      style={[
                                        t.caption,
                                        { color: colors.mutedForeground },
                                      ]}
                                    >
                                      Price NPR {gross!.toLocaleString("en-NP")}{" "}
                                      · Fadko fee − NPR{" "}
                                      {fadko!.toLocaleString("en-NP")} · Teacher
                                      earnings NPR{" "}
                                      {teacher!.toLocaleString("en-NP")}
                                    </Text>
                                  ) : (
                                    <Text
                                      style={[
                                        t.caption,
                                        { color: colors.mutedForeground },
                                      ]}
                                    >
                                      Lesson amounts unavailable. Contact
                                      Support before relying on this receipt.
                                    </Text>
                                  )}
                                  <Text
                                    style={[
                                      t.caption,
                                      { color: colors.mutedForeground },
                                    ]}
                                  >
                                    Status:{" "}
                                    {lessonEarningStatus(allocation.state)}
                                  </Text>
                                </View>
                              );
                            })
                          : null}
                      </>
                    ) : (
                      <Text
                        style={[t.caption, { color: colors.mutedForeground }]}
                      >
                        Breakdown unavailable. Contact Support before relying on
                        this receipt.
                      </Text>
                    )}
                    <Text
                      style={[t.caption, { color: colors.mutedForeground }]}
                    >
                      {participantReceiptStatus(receipt, "teacher")} · Practice
                      record, not a bank transfer
                    </Text>
                    <MakeupReceiptEvidence receipt={receipt} role={role} />
                  </View>
                );
              })}
              {matchingReceipts.length === 0 ? (
                <Text style={[t.body, { color: colors.mutedForeground }]}>
                  No loaded receipts match that search.
                  {nextCursor
                    ? " Load older receipts to continue searching."
                    : ""}
                </Text>
              ) : null}
              {matchingReceipts.length > visibleReceipts ? (
                <ProgramButton
                  label={`Show more receipts (${matchingReceipts.length - visibleReceipts})`}
                  onPress={() => setVisibleReceipts((count) => count + 8)}
                />
              ) : null}
            </View>
          ) : null}
          <View style={{ gap: space.sm }}>
            <Text
              accessibilityRole="header"
              style={[t.title3, { color: colors.foreground }]}
            >
              Transaction history
            </Text>
            <StatementSection title="Pending" rows={statement.pending} />
            <StatementSection
              title="Posted"
              rows={statement.posted}
              empty={
                role === "teacher"
                  ? "No test earnings have been posted yet."
                  : "No test payments have been posted yet."
              }
            />
            {nextCursor !== null ? (
              <ProgramButton
                label="Load older receipts"
                busy={busy}
                onPress={() => void load(nextCursor)}
              />
            ) : null}
          </View>
        </>
      ) : busy ? (
        <Text style={[t.callout, { color: colors.mutedForeground }]}>
          Loading test totals…
        </Text>
      ) : null}
    </ProgramCardShell>
  );
}
