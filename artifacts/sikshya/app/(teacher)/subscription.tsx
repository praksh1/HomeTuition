import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { numeric } from "@/constants/typography";
import Skeleton from "@/components/Skeleton";
import { useNotifications } from "@/context/NotificationContext";
import { addInAppNotification } from "@/utils/notifications";
import PaymentSheet, { type PaymentMethod } from "@/components/PaymentSheet";
import type { Teacher } from "@/context/AuthContext";
import { apiGet, apiPost } from "@/utils/api";

export type SubscriptionTierKey = "base" | "tier1" | "tier2" | "tier3" | "tier4";

interface TierInfo {
  key: SubscriptionTierKey;
  label: string;
  sessions: number;
  price: number;
}

export const SUBSCRIPTION_TIERS: TierInfo[] = [
  { key: "base", label: "Base", sessions: 10, price: 2000 },
  { key: "tier1", label: "Tier 1", sessions: 15, price: 2800 },
  { key: "tier2", label: "Tier 2", sessions: 20, price: 3500 },
  { key: "tier3", label: "Tier 3", sessions: 25, price: 4220 },
  { key: "tier4", label: "Tier 4", sessions: 30, price: 4700 },
];

/**
 * What the plan actually gives you.
 *
 * The list this replaced promised six things, and **four of them were not true**: "session
 * recording included" and "cloud storage for recordings" describe a feature that does not exist
 * anywhere in this codebase — no route, no column, nothing — and "up to 20 students" and
 * "60-minute maximum" describe *defaults* on the create-class form, not limits. Nothing enforces
 * either; a teacher can set 200 students and three hours.
 *
 * Promising a feature that does not exist is bad on any screen. On the one where somebody hands
 * over money it is the worst place in the product for it. Everything below is either enforced by
 * the server or is a thing the class demonstrably does.
 */
function featuresFor(tier: TierInfo): string[] {
  return [
    `${tier.sessions} classes every 30 days`,
    "You set the price of every class",
    "Shared whiteboard in every class",
    "In-class chat with your students",
    "Attendance recorded automatically",
  ];
}

/**
 * A card, so the four on this screen cannot drift apart.
 *
 * At module scope, not inside the screen. A component defined inside a render is a *new
 * component type* on every render, so React unmounts and rebuilds the whole subtree — real
 * native views destroyed and recreated — every time a tier is tapped. It looks like a harmless
 * local helper and is a genuine cost on the phone this app is built for.
 */
function Card({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const { space, radius, elevation } = useLayout();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm },
        elevation.card,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * The server's answer to "may this teacher buy a plan?".
 *
 * Mirrors `TeachingAccess` in `api-server/src/lib/teachingAccess.ts`. Only the verdict crosses
 * the wire — not the fields it was derived from — so the app cannot drift into keeping its own
 * version of the rule.
 */
type PlanRefusalCode = "EMAIL_UNVERIFIED" | "OPERATOR_REVIEW" | "PLAN_REQUIRED";

type PlanEligibility =
  | { allowed: true }
  | { allowed: false; code: PlanRefusalCode; message: string };

/** What a locked teacher should do next, and where. Null when there is nowhere useful to send them. */
function correctiveAction(code: PlanRefusalCode): { label: string; href: string } | null {
  switch (code) {
    case "EMAIL_UNVERIFIED":
      return { label: "Go to Profile to verify your email", href: "/(teacher)/profile" };
    case "OPERATOR_REVIEW":
      return { label: "Go to Profile to check your documents", href: "/(teacher)/profile" };
    default:
      return null;
  }
}

export default function Subscription() {
  const { user, updateUser } = useAuth();
  const colors = useColors();
  const { t, gutter, space, radius, elevation } = useLayout();
  const insets = useSafeAreaInsets();
  const teacher = user as Teacher;
  const [selectedMethod, setSelectedMethod] = useState<"esewa" | "khalti">("esewa");
  const [payVisible, setPayVisible] = useState(false);
  const { refresh: refreshNotifs } = useNotifications();
  const { from } = useLocalSearchParams<{ from?: string }>();

  const currentTierKey = (teacher?.subscriptionTier as SubscriptionTierKey) ?? "base";
  const [selectedTier, setSelectedTier] = useState<SubscriptionTierKey>(currentTierKey);
  const tierInfo = SUBSCRIPTION_TIERS.find((t) => t.key === selectedTier) ?? SUBSCRIPTION_TIERS[0];

  /**
   * The allowance comes from the server, which counts it off the teacher's actual classes.
   *
   * It used to come from `teacher.sessionsThisMonth`, a column nothing has ever written to — so
   * this screen told every teacher they had used none of their classes, whatever they had done.
   */
  const [allowance, setAllowance] = useState<{ used: number; limit: number } | null>(null);
  /**
   * Loading and unavailable are different claims and must look different.
   *
   * The old code read `allowance?.used ?? 0`, which turns "we have not heard back yet" into a
   * confident zero — the same fabrication as the counter it was brought in to replace, one layer
   * further down.
   */
  const [allowanceLoading, setAllowanceLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setAllowanceLoading(true);
    apiGet<{ used: number; limit: number }>("/teachers/me/allowance")
      .then((a) => { if (live) { setAllowance(a); setAllowanceLoading(false); } })
      .catch(() => { if (live) { setAllowance(null); setAllowanceLoading(false); } });
    return () => { live = false; };
  }, [teacher?.userId]);

  /**
   * Whether this teacher may buy a plan at all, answered by the server gate that enforces it.
   *
   * This screen used to decide for itself from `approvalStatus`, and it could not see email
   * verification at all. So an unverified teacher could pick a tier, choose eSewa, type a phone
   * number and a PIN, and only then be refused — a payment flow the screen already knew would
   * fail. `GET /teachers/me/plan-eligibility` returns `mayBuyTeacherPlan()`'s own verdict, so
   * there is one rule rather than the app's copy of it.
   */
  const [eligibility, setEligibility] = useState<PlanEligibility | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setEligibilityLoading(true);
    apiGet<PlanEligibility>("/teachers/me/plan-eligibility")
      .then((e) => { if (live) { setEligibility(e); setEligibilityLoading(false); } })
      .catch(() => { if (live) { setEligibility(null); setEligibilityLoading(false); } });
    return () => { live = false; };
  }, [teacher?.userId]);

  /*
    Locked unless the server has said yes.

    Deliberately fail-closed, in all three of the ways this can be uncertain: still checking,
    the check failed, and the check said no. The server refuses the purchase in every one of
    those cases anyway, so an unlocked button would only walk the teacher into a refusal — and
    on the one screen in the app that asks for money, guessing in the permissive direction is
    the wrong guess.
  */
  const planLocked = !eligibility?.allowed;

  const maxSessions = allowance?.limit ?? teacher?.maxSessionsPerMonth ?? 10;
  const sessionsUsed = allowance?.used ?? 0;
  const sessionsRemaining = Math.max(0, maxSessions - sessionsUsed);
  const progressPct = maxSessions > 0 ? Math.min(1, sessionsUsed / maxSessions) : 0;

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/notifications");
  };

  const handlePay = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setPayVisible(true);
  };

  const handlePaymentSuccess = async (method: PaymentMethod) => {

    // Phase 3 sandbox bypass: the local mock eSewa/Khalti UI already simulated the
    // charge (no OTP, no real gateway). We persist the result server-side here instead
    // of redirecting to any external SDK.
    /**
     * A failure here used to be swallowed, and the plan was then marked active locally
     * regardless — so a teacher whose subscription never reached the server was told their
     * Pro plan was live. It is rethrown now, and the payment sheet shows it instead of a
     * success screen it has not earned.
     */
    if (teacher?.id) {
      await apiPost(`/teachers/${teacher.id}/subscribe`, { tier: selectedTier });
    }
    setPayVisible(false);
    /**
     * Paying buys a plan. It does not approve the teacher.
     *
     * This used to set `approvalStatus: "approved"` here, matching a server that did the same —
     * and between them they let any teacher list themselves in Discover without an agent ever
     * seeing their credentials. The server no longer does it, so neither may this: claiming it
     * locally would only make the app disagree with the server about whether the teacher is
     * visible to students, which is worse than the honest answer.
     */
    await updateUser({
      subscriptionActive: true,
      subscriptionTier: selectedTier,
      maxSessionsPerMonth: tierInfo.sessions,
    });

    await addInAppNotification({
      title: "Subscription Payment Confirmed",
      body: `NPR ${tierInfo.price.toLocaleString()} paid via ${method === "esewa" ? "eSewa" : "Khalti"}. Your Sikshya Pro (${tierInfo.label}) plan is active.`,
      type: "payment",
    });
    await refreshNotifs();
    if (Platform.OS === "web") window.alert(`Payment Successful!\n\nYour Sikshya Pro ${tierInfo.label} plan (${tierInfo.sessions} sessions/month) is now active. Happy teaching!`);
    else Alert.alert("Payment Successful!", `Your Sikshya Pro ${tierInfo.label} plan (${tierInfo.sessions} sessions/month) is now active. Happy teaching!`);

    router.replace("/(teacher)");
  };

  const isActive = !!teacher?.subscriptionActive;
  const isPending = teacher?.approvalStatus === "pending";
  const isRejected = teacher?.approvalStatus === "rejected";
  const changingTier = selectedTier !== currentTierKey;

  // Ink for the navy card. Tokens rather than white at an opacity: an alpha over a gradient
  // lands on a different colour at each end, so it can pass contrast on one side and fail the
  // other. Both of these are measured against both ends.
  const onNavy = { color: colors.onInverse };
  const onNavyMuted = { color: colors.onInverseMuted };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingHorizontal: gutter,
        paddingTop: insets.top + space.md,
        paddingBottom: insets.bottom + 100,
        gap: space.md,
        width: "100%",
        maxWidth: 760,
        alignSelf: "center",
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* ------------------------------------------------------------------ header */}
      {from === "notif" ? (
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back to notifications"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[t.title1, { color: colors.foreground }]}>Subscription</Text>
        </View>
      ) : (
        <Text style={[t.title1, { color: colors.foreground }]}>Subscription</Text>
      )}

      {/* ------------------------------------------------------- the plan you hold */}
      <LinearGradient
        colors={[colors.secondary, colors.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: radius.lg, padding: space.lg, gap: space.md }}
      >
        <View style={styles.planHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[t.caption, onNavyMuted]}>Sikshya Pro — {tierInfo.label}</Text>
            <Text style={[t.display, numeric, onNavy, { marginTop: 2 }]}>
              NPR {tierInfo.price.toLocaleString()}
              <Text style={[t.body, onNavyMuted]}> /month</Text>
            </Text>
          </View>
          {/*
            Status at a glance, in the semantic colours: green means the plan is running, and
            anything else is deliberately not green. The dot repeats the state in shape as well
            as colour, so it still reads for somebody who cannot separate the two.
          */}
          <View
            style={[
              styles.statusPill,
              {
                backgroundColor: isActive ? colors.successSoft : colors.surfaceSunk,
                borderRadius: radius.pill,
                paddingHorizontal: space.sm,
              },
            ]}
          >
            <View
              style={[
                styles.dot,
                { backgroundColor: isActive ? colors.success : colors.inkFaint },
              ]}
            />
            <Text style={[t.caption, { color: isActive ? colors.success : colors.mutedForeground }]}>
              {isActive ? "Active" : "Not active"}
            </Text>
          </View>
        </View>

        <View style={{ gap: space.xs }}>
          {featuresFor(tierInfo).map((f) => (
            <View key={f} style={styles.featureRow}>
              <Feather name="check" size={14} color={colors.onInverseMuted} />
              <Text style={[t.callout, onNavy, { flex: 1 }]}>{f}</Text>
            </View>
          ))}
        </View>

        {/*
          There was a "Next billing: July 1, 2025" line here — hardcoded, and a date already in
          the past. There is no billing cycle stored for this plan anywhere, because the plan is
          not charged yet, so no honest date could replace it. This says the true thing instead.
        */}
        <View style={styles.footNote}>
          <Feather name="info" size={13} color={colors.onInverseMuted} />
          <Text style={[t.caption, onNavyMuted, { flex: 1 }]}>
            Billing dates appear here once online payment is live.
          </Text>
        </View>
      </LinearGradient>

      {/*
        Buying a plan is not the same as being listed, and this is where a teacher is most
        likely to assume otherwise — they have just paid. Surfaced here because the server
        stopped treating payment as approval.
      */}
      {/*
        Why the plan is locked, in the server's own words.

        Three separate pictures rather than one placeholder: still checking, could not check, and
        a definite refusal. The refusal carries the reason the gate actually gave and a link to
        the place the teacher can do something about it.
      */}
      {eligibilityLoading ? (
        <View
          style={[
            styles.banner,
            { backgroundColor: colors.surfaceSunk, borderColor: colors.border, borderRadius: radius.md, padding: space.sm },
          ]}
        >
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={[t.caption, { flex: 1, color: colors.mutedForeground }]}>
            Checking whether your account can choose a plan…
          </Text>
        </View>
      ) : !eligibility ? (
        <View
          style={[
            styles.banner,
            { backgroundColor: colors.warnSoft, borderColor: colors.warn, borderRadius: radius.md, padding: space.sm },
          ]}
        >
          <Feather name="wifi-off" size={16} color={colors.warn} />
          <Text style={[t.caption, { flex: 1, color: colors.warn }]}>
            We could not check your account just now, so plans stay locked. Pull down or reopen this
            screen to try again.
          </Text>
        </View>
      ) : !eligibility.allowed ? (
        <View
          style={[
            styles.banner,
            {
              backgroundColor: eligibility.code === "OPERATOR_REVIEW" && isRejected
                ? colors.destructiveSoft
                : colors.warnSoft,
              borderColor: eligibility.code === "OPERATOR_REVIEW" && isRejected ? colors.destructive : colors.warn,
              borderRadius: radius.md,
              padding: space.sm,
            },
          ]}
          testID="plan-locked-notice"
        >
          <Feather
            name={eligibility.code === "EMAIL_UNVERIFIED" ? "mail" : isRejected ? "x-circle" : "clock"}
            size={16}
            color={eligibility.code === "OPERATOR_REVIEW" && isRejected ? colors.destructive : colors.warn}
          />
          <View style={{ flex: 1, gap: space.xxs }}>
            <Text
              style={[
                t.caption,
                { color: eligibility.code === "OPERATOR_REVIEW" && isRejected ? colors.destructive : colors.warn },
              ]}
            >
              {eligibility.message}
            </Text>
            {(() => {
              const next = correctiveAction(eligibility.code);
              if (!next) return null;
              return (
                <TouchableOpacity
                  onPress={() => router.push(next.href as never)}
                  accessibilityRole="link"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[t.caption, { color: colors.primary, textDecorationLine: "underline" }]}>
                    {next.label}
                  </Text>
                </TouchableOpacity>
              );
            })()}
          </View>
        </View>
      ) : isPending || isRejected ? (
        /*
          Allowed to buy, but still not listed. A different fact from the lock above, and the
          place a teacher is most likely to assume otherwise — they have just paid.
        */
        <View
          style={[
            styles.banner,
            {
              backgroundColor: isRejected ? colors.destructiveSoft : colors.warnSoft,
              borderColor: isRejected ? colors.destructive : colors.warn,
              borderRadius: radius.md,
              padding: space.sm,
            },
          ]}
        >
          <Feather name={isRejected ? "x-circle" : "clock"} size={16} color={isRejected ? colors.destructive : colors.warn} />
          <Text style={[t.caption, { flex: 1, color: isRejected ? colors.destructive : colors.warn }]}>
            {isRejected
              ? "Your verification was rejected, so your classes are not listed. Re-upload your documents in Profile."
              : "A plan does not list you to students on its own — your verification is still being reviewed."}
          </Text>
        </View>
      ) : null}

      {/* -------------------------------------------------------------- where you are */}
      <Card>
        <Text style={[t.title3, { color: colors.foreground }]}>Your classes this month</Text>

        {allowanceLoading ? (
          <View style={{ gap: space.sm }}>
            <Skeleton width="55%" height={15} />
            <Skeleton width="100%" height={8} radius={4} />
          </View>
        ) : allowance ? (
          <>
            <View style={styles.usageRow}>
              <Text style={[t.body, numeric, { color: colors.foreground }]}>
                {sessionsUsed} of {maxSessions} used
              </Text>
              <Text
                style={[
                  t.bodyStrong,
                  numeric,
                  { color: sessionsRemaining === 0 ? colors.destructive : colors.success },
                ]}
              >
                {sessionsRemaining} left
              </Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: colors.muted, borderRadius: radius.xs }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(progressPct * 100, 100)}%` as `${number}%`,
                    backgroundColor: progressPct >= 0.8 ? colors.destructive : colors.primary,
                    borderRadius: radius.xs,
                  },
                ]}
              />
            </View>
            <Text style={[t.caption, { color: colors.inkFaint }]}>
              Counted over any 30 days, not a calendar month.
            </Text>
          </>
        ) : (
          <Text style={[t.callout, { color: colors.mutedForeground }]}>
            Could not reach the server. Pull down to try again.
          </Text>
        )}

        <View style={[styles.usageMeta, { borderTopColor: colors.border, paddingTop: space.sm, marginTop: space.xxs }]}>
          <View style={styles.usageItem}>
            <Text style={[t.title2, numeric, { color: colors.foreground }]}>{teacher?.totalStudents ?? 0}</Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>Students taught</Text>
          </View>
          <View style={[styles.dividerV, { backgroundColor: colors.border }]} />
          {/*
            Earnings are not tracked. `monthly_earnings` is written once, to zero, at
            registration and never again — so this tile has been reporting NPR 0 to every
            teacher since the app was built. A fabricated zero about money is indistinguishable
            from a real answer, which makes it the worst kind of placeholder to leave on the
            screen where somebody is deciding whether this platform is worth paying for.
          */}
          <View style={styles.usageItem}>
            <Text style={[t.title2, numeric, { color: colors.inkFaint }]}>—</Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>Earnings · soon</Text>
          </View>
        </View>
      </Card>

      {/* ------------------------------------------------------------- pick a plan */}
      <Card>
        <Text style={[t.title3, { color: colors.foreground }]}>Choose your plan</Text>
        <Text style={[t.callout, { color: colors.mutedForeground }]}>
          Pick a tier for how many classes you expect to teach in a month.
        </Text>

        <View style={{ gap: space.xs }}>
          {SUBSCRIPTION_TIERS.map((tier) => {
            const active = selectedTier === tier.key && !planLocked;
            const current = tier.key === currentTierKey;
            return (
              <TouchableOpacity
                key={tier.key}
                style={[
                  styles.tierRow,
                  {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: planLocked
                      ? colors.surfaceSunk
                      : active
                        ? colors.actionSoft
                        : colors.surface,
                    borderRadius: radius.sm,
                    paddingHorizontal: space.sm,
                    paddingVertical: space.sm,
                  },
                ]}
                // No handler at all when locked, rather than a handler that declines. A row that
                // still responds is a row a teacher will keep pressing.
                onPress={planLocked ? undefined : () => setSelectedTier(tier.key)}
                disabled={planLocked}
                activeOpacity={0.7}
                testID={`tier-${tier.key}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: active, disabled: planLocked }}
                accessibilityLabel={
                  `${tier.label}, ${tier.sessions} classes a month, NPR ${tier.price}` +
                  (planLocked ? ", unavailable until your account is approved" : "")
                }
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.tierLabelRow}>
                    {/*
                      Locked reads as muted ink on a sunk surface, never as reduced opacity on the
                      whole row: the tier's price has to stay legible while it is unavailable, and
                      an opacity that makes "disabled" obvious also makes NPR 4,700 hard to read.
                    */}
                    <Text
                      style={[
                        t.bodyStrong,
                        { color: planLocked ? colors.mutedForeground : active ? colors.primary : colors.foreground },
                      ]}
                    >
                      {tier.label}
                    </Text>
                    {current && (
                      <View style={[styles.currentChip, { backgroundColor: colors.surfaceSunk, borderRadius: radius.xs }]}>
                        <Text style={[t.overline, { color: colors.mutedForeground }]}>Current</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>
                    {tier.sessions} classes a month
                  </Text>
                </View>
                <View style={styles.tierRight}>
                  <Text
                    style={[
                      t.bodyStrong,
                      numeric,
                      { color: planLocked ? colors.mutedForeground : colors.foreground },
                    ]}
                  >
                    NPR {tier.price.toLocaleString()}
                  </Text>
                  {planLocked
                    ? <Feather name="lock" size={15} color={colors.inkFaint} />
                    : active && <Feather name="check-circle" size={17} color={colors.primary} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      {/* ------------------------------------------------------------------- pay */}
      <Card>
        <Text style={[t.title3, { color: colors.foreground }]}>
          {changingTier ? `Switch to ${tierInfo.label}` : "Pay this month"}
        </Text>
        <Text style={[t.callout, { color: colors.mutedForeground }]}>
          Pay with eSewa or Khalti.
        </Text>

        <View style={{ flexDirection: "row", gap: space.xs }}>
          {(["esewa", "khalti"] as const).map((method) => {
            const on = selectedMethod === method;
            return (
              <TouchableOpacity
                key={method}
                style={[
                  styles.methodBtn,
                  {
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.actionSoft : colors.surface,
                    borderRadius: radius.sm,
                    paddingVertical: space.sm,
                  },
                ]}
                onPress={planLocked ? undefined : () => setSelectedMethod(method)}
                disabled={planLocked}
                activeOpacity={0.7}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, disabled: planLocked }}
              >
                <Text style={[t.bodyStrong, { color: on ? colors.primary : colors.mutedForeground }]}>
                  {method === "esewa" ? "eSewa" : "Khalti"}
                </Text>
                {on && <Feather name="check" size={14} color={colors.primary} />}
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[
            styles.payBtn,
            {
              backgroundColor: planLocked ? colors.surfaceSunk : colors.primary,
              borderRadius: radius.sm,
              paddingVertical: space.sm,
              gap: space.xs,
            },
            planLocked ? undefined : elevation.card,
          ]}
          // `handlePay` only opens the sheet, so this is the one place that has to stop it. The
          // server refuses anyway, but a teacher who has entered a phone number and a PIN before
          // being told no has already been misled.
          onPress={planLocked ? undefined : handlePay}
          disabled={planLocked}
          activeOpacity={0.85}
          testID="pay-button"
          accessibilityRole="button"
          accessibilityState={{ disabled: planLocked }}
          accessibilityLabel={
            planLocked
              ? "Payment unavailable until your teacher account is approved"
              : `Pay NPR ${tierInfo.price} via ${selectedMethod === "esewa" ? "eSewa" : "Khalti"}`
          }
        >
          <Feather name="lock" size={16} color={planLocked ? colors.inkFaint : colors.primaryForeground} />
          <Text
            style={[
              t.bodyStrong,
              numeric,
              { color: planLocked ? colors.mutedForeground : colors.primaryForeground },
            ]}
          >
            {planLocked ? "Payment locked" : `Pay NPR ${tierInfo.price.toLocaleString()}`}
          </Text>
        </TouchableOpacity>
      </Card>

      {/* -------------------------------------------------------------- history */}
      <View style={{ gap: space.xs }}>
        <Text style={[t.title3, { color: colors.foreground }]}>Payment history</Text>
        {/*
          There is no payment history, and until recently this screen invented three: NPR 2,000
          in May, April and March 2025, via eSewa and Khalti, all marked paid — to every teacher,
          including one who registered this morning.

          Nothing on the server records a subscription payment. There is no route to ask, and no
          table to ask it of. So this says so, rather than showing rows that would tell a teacher
          they had already paid for months they had not.
        */}
        <View
          style={[
            styles.emptyHistory,
            {
              backgroundColor: colors.muted,
              borderColor: colors.border,
              borderRadius: radius.md,
              padding: space.lg,
              gap: space.xs,
            },
          ]}
        >
          <Feather name="file-text" size={22} color={colors.inkFaint} />
          <Text style={[t.body, { color: colors.foreground }]}>No payments yet</Text>
          <Text style={[t.callout, { color: colors.mutedForeground, textAlign: "center" }]}>
            Every subscription payment will be listed here, with its date, method and amount,
            once online payment is live.
          </Text>
        </View>
      </View>

      {/*
        The last gate, and the one that matters if any of the others is ever bypassed — a stale
        `payVisible` from before the eligibility answer arrived, or a future edit that forgets to
        disable a button. The sheet is where a phone number and a PIN get typed, so it stays shut
        unless the server has said yes.
      */}
      <PaymentSheet
        visible={payVisible && !planLocked}
        amount={tierInfo.price}
        label={`Sikshya Pro · ${tierInfo.label}`}
        initialMethod={selectedMethod}
        onClose={() => setPayVisible(false)}
        onSuccess={handlePaymentSuccess}
      />
    </ScrollView>
  );
}

/**
 * Only what does not depend on a token or the screen size.
 *
 * Colours, spacing, radii and type arrive from `useColors()` and `useLayout()` at render time,
 * so they cannot live in a StyleSheet built once at module load. What is left is structure.
 */
const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  backBtn: { width: 40, height: 40, justifyContent: "center", marginLeft: -10 },

  card: { borderWidth: StyleSheet.hairlineWidth },

  planHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 26 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  footNote: { flexDirection: "row", alignItems: "center", gap: 8 },

  banner: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1 },

  usageRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  progressTrack: { height: 8, overflow: "hidden" },
  progressFill: { height: "100%" },
  usageMeta: { flexDirection: "row", justifyContent: "space-around", borderTopWidth: StyleSheet.hairlineWidth },
  usageItem: { flex: 1, alignItems: "center", gap: 2 },
  dividerV: { width: StyleSheet.hairlineWidth, marginVertical: 4 },

  tierRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1.5, gap: 12, minHeight: 56 },
  tierLabelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  currentChip: { paddingHorizontal: 6, paddingVertical: 2 },
  tierRight: { flexDirection: "row", alignItems: "center", gap: 8 },

  methodBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, minHeight: 48 },
  payBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", minHeight: 52 },

  emptyHistory: { alignItems: "center", borderWidth: StyleSheet.hairlineWidth },
});
