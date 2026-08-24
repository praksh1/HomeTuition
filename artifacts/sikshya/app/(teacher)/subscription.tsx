import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useNotifications } from "@/context/NotificationContext";
import { addInAppNotification } from "@/utils/notifications";
import PaymentSheet, { type PaymentMethod } from "@/components/PaymentSheet";
import type { Teacher } from "@/context/AuthContext";
import { apiPost } from "@/utils/api";

const PAYMENT_HISTORY = [
  { id: "p1", amount: 2000, date: "May 2025", method: "eSewa", status: "paid" },
  { id: "p2", amount: 2000, date: "Apr 2025", method: "Khalti", status: "paid" },
  { id: "p3", amount: 2000, date: "Mar 2025", method: "eSewa", status: "paid" },
];

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

export default function Subscription() {
  const { user, updateUser } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const teacher = user as Teacher;
  const [selectedMethod, setSelectedMethod] = useState<"esewa" | "khalti">("esewa");
  const [payVisible, setPayVisible] = useState(false);
  const { refresh: refreshNotifs } = useNotifications();
  const { from } = useLocalSearchParams<{ from?: string }>();

  const currentTierKey = (teacher?.subscriptionTier as SubscriptionTierKey) ?? "base";
  const [selectedTier, setSelectedTier] = useState<SubscriptionTierKey>(currentTierKey);
  const tierInfo = SUBSCRIPTION_TIERS.find((t) => t.key === selectedTier) ?? SUBSCRIPTION_TIERS[0];

  const maxSessions = teacher?.maxSessionsPerMonth ?? 10;
  const sessionsUsed = teacher?.sessionsThisMonth ?? 0;
  const sessionsRemaining = maxSessions - sessionsUsed;
  const progressPct = maxSessions > 0 ? sessionsUsed / maxSessions : 0;

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
    await updateUser({
      subscriptionActive: true,
      approvalStatus: "approved",
      subscriptionTier: selectedTier,
      maxSessionsPerMonth: tierInfo.sessions,
    });

    await addInAppNotification({
      title: "Subscription Payment Confirmed",
      body: `NPR ${tierInfo.price.toLocaleString()} paid via ${method === "esewa" ? "eSewa" : "Khalti"}. Your Sikshya Pro (${tierInfo.label}) plan is active for July 2025.`,
      type: "payment",
    });
    await refreshNotifs();
    if (Platform.OS === "web") window.alert(`Payment Successful!\n\nYour Sikshya Pro ${tierInfo.label} plan (${tierInfo.sessions} sessions/month) is now active. Happy teaching!`);
    else Alert.alert("Payment Successful!", `Your Sikshya Pro ${tierInfo.label} plan (${tierInfo.sessions} sessions/month) is now active. Happy teaching!`);

    router.replace("/(teacher)");
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}
    >
      {from === "notif" ? (
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn} accessibilityLabel="Back to notifications">
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Subscription</Text>
        </View>
      ) : (
        <Text style={[styles.title, { color: colors.foreground }]}>Subscription</Text>
      )}

      <LinearGradient
        colors={["#1A365D", "#2D4A7A"]}
        style={styles.planCard}
      >
        <View style={styles.planHeader}>
          <View>
            <Text style={styles.planName}>Sikshya Pro — {tierInfo.label}</Text>
            <Text style={styles.planPrice}>NPR {tierInfo.price.toLocaleString()} <Text style={styles.planPeriod}>/month</Text></Text>
          </View>
          <View style={[styles.activeBadge, { backgroundColor: teacher?.subscriptionActive ? "#22C55E30" : "#EF444430" }]}>
            <View style={[styles.dot, { backgroundColor: teacher?.subscriptionActive ? "#22C55E" : "#EF4444" }]} />
            <Text style={[styles.activeText, { color: teacher?.subscriptionActive ? "#22C55E" : "#EF4444" }]}>
              {teacher?.subscriptionActive ? "Active" : "Inactive"}
            </Text>
          </View>
        </View>

        <View style={styles.planFeatures}>
          {[
            `${tierInfo.sessions} sessions per month`,
            "Up to 20 students per session",
            "60-minute maximum per session",
            "Session recording included",
            "Cloud storage for recordings",
            "Student payment processing",
          ].map((f) => (
            <View key={f} style={styles.featureRow}>
              <Feather name="check-circle" size={15} color="#22C55E" />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        <View style={styles.nextBilling}>
          <Feather name="calendar" size={14} color="#ffffff66" />
          <Text style={styles.nextBillingText}>Next billing: July 1, 2025</Text>
        </View>
      </LinearGradient>

      <View style={[styles.paySection, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.payTitle, { color: colors.foreground }]}>Choose Your Plan</Text>
        <Text style={[styles.paySubtitle, { color: colors.mutedForeground }]}>
          Select a tier based on how many sessions you plan to teach per month
        </Text>
        <View style={styles.tierList}>
          {SUBSCRIPTION_TIERS.map((t) => {
            const active = selectedTier === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[
                  styles.tierRow,
                  { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary + "10" : colors.muted },
                ]}
                onPress={() => setSelectedTier(t.key)}
                activeOpacity={0.7}
                testID={`tier-${t.key}`}
              >
                <View style={styles.tierInfo}>
                  <Text style={[styles.tierLabel, { color: active ? colors.primary : colors.foreground }]}>{t.label}</Text>
                  <Text style={[styles.tierMeta, { color: colors.mutedForeground }]}>{t.sessions} sessions/month</Text>
                </View>
                <View style={styles.tierRight}>
                  <Text style={[styles.tierPrice, { color: colors.foreground }]}>NPR {t.price.toLocaleString()}</Text>
                  {active && <Feather name="check-circle" size={16} color={colors.primary} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={[styles.usageCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.usageTitle, { color: colors.foreground }]}>Usage This Month</Text>
        <View style={styles.usageRow}>
          <Text style={[styles.usageStat, { color: colors.foreground }]}>{sessionsUsed}/{maxSessions} sessions used</Text>
          <Text style={[styles.usageRemaining, { color: colors.success }]}>{sessionsRemaining} remaining</Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
          <View
            style={[styles.progressFill, {
              width: `${Math.min(progressPct * 100, 100)}%` as `${number}%`,
              backgroundColor: progressPct >= 0.8 ? colors.destructive : colors.primary,
            }]}
          />
        </View>
        <View style={styles.usageMeta}>
          <View style={styles.usageItem}>
            <Text style={[styles.usageNum, { color: colors.foreground }]}>{teacher?.totalStudents ?? 0}</Text>
            <Text style={[styles.usageLabel, { color: colors.mutedForeground }]}>Total Students</Text>
          </View>
          <View style={[styles.dividerV, { backgroundColor: colors.border }]} />
          <View style={styles.usageItem}>
            <Text style={[styles.usageNum, { color: colors.foreground }]}>NPR {(teacher?.monthlyEarnings ?? 0).toLocaleString()}</Text>
            <Text style={[styles.usageLabel, { color: colors.mutedForeground }]}>Earned This Month</Text>
          </View>
        </View>
      </View>

      <View style={[styles.paySection, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.payTitle, { color: colors.foreground }]}>Pay Monthly Subscription</Text>
        <Text style={[styles.paySubtitle, { color: colors.mutedForeground }]}>
          Secure payment via Nepali payment gateways · {tierInfo.label} plan
        </Text>

        <View style={styles.methodRow}>
          {(["esewa", "khalti"] as const).map((method) => (
            <TouchableOpacity
              key={method}
              style={[
                styles.methodBtn,
                { borderColor: selectedMethod === method ? colors.primary : colors.border, backgroundColor: selectedMethod === method ? colors.primary + "10" : colors.muted },
              ]}
              onPress={() => setSelectedMethod(method)}
              activeOpacity={0.7}
            >
              <Text style={[styles.methodIcon, { color: selectedMethod === method ? colors.primary : colors.mutedForeground }]}>
                {method === "esewa" ? "eSewa" : "Khalti"}
              </Text>
              {selectedMethod === method && <Feather name="check" size={14} color={colors.primary} />}
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={[styles.payBtn, { backgroundColor: colors.primary }]} onPress={handlePay} activeOpacity={0.85}>
          <Feather name="lock" size={16} color="#fff" />
          <Text style={styles.payBtnText}>Pay NPR {tierInfo.price.toLocaleString()} via {selectedMethod === "esewa" ? "eSewa" : "Khalti"}</Text>
        </TouchableOpacity>

        <View style={styles.secureNote}>
          <Feather name="shield" size={13} color={colors.mutedForeground} />
          <Text style={[styles.secureText, { color: colors.mutedForeground }]}>
            Payments are secured with 256-bit SSL encryption
          </Text>
        </View>
      </View>

      <Text style={[styles.historyTitle, { color: colors.foreground }]}>Payment History</Text>
      {PAYMENT_HISTORY.map((p) => (
        <View key={p.id} style={[styles.historyRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.historyIcon, { backgroundColor: colors.success + "15" }]}>
            <Feather name="check" size={15} color={colors.success} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.historyDate, { color: colors.foreground }]}>{p.date} Subscription</Text>
            <Text style={[styles.historyMethod, { color: colors.mutedForeground }]}>via {p.method}</Text>
          </View>
          <Text style={[styles.historyAmount, { color: colors.success }]}>NPR {p.amount.toLocaleString()}</Text>
        </View>
      ))}

      <PaymentSheet
        visible={payVisible}
        amount={tierInfo.price}
        label={`Sikshya Pro · ${tierInfo.label}`}
        initialMethod={selectedMethod}
        onClose={() => setPayVisible(false)}
        onSuccess={handlePaymentSuccess}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  backBtn: { width: 36, height: 36, justifyContent: "center", marginLeft: -8 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  planCard: { borderRadius: 20, padding: 22, gap: 16 },
  planHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  planName: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#ffffff99", marginBottom: 4 },
  planPrice: { fontSize: 30, fontFamily: "Inter_700Bold", color: "#fff" },
  planPeriod: { fontSize: 16, fontFamily: "Inter_400Regular", color: "#ffffff80" },
  activeBadge: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  activeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  planFeatures: { gap: 8 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  featureText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#ffffffdd" },
  nextBilling: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4 },
  nextBillingText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#ffffff66" },
  usageCard: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 12 },
  usageTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  usageRow: { flexDirection: "row", justifyContent: "space-between" },
  usageStat: { fontSize: 14, fontFamily: "Inter_500Medium" },
  usageRemaining: { fontSize: 14, fontFamily: "Inter_500Medium" },
  progressTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4 },
  usageMeta: { flexDirection: "row", justifyContent: "space-around", paddingTop: 4 },
  usageItem: { alignItems: "center", gap: 4 },
  usageNum: { fontSize: 18, fontFamily: "Inter_700Bold" },
  usageLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  dividerV: { width: 1, marginVertical: 4 },
  paySection: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 14 },
  payTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  paySubtitle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  tierList: { gap: 10 },
  tierRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12 },
  tierInfo: { gap: 2 },
  tierLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  tierMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  tierRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  tierPrice: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  methodRow: { flexDirection: "row", gap: 12 },
  methodBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, borderWidth: 1.5, paddingVertical: 14 },
  methodIcon: { fontSize: 16, fontFamily: "Inter_700Bold" },
  payBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 16 },
  payBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  secureNote: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  secureText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  historyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  historyIcon: { width: 38, height: 38, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  historyDate: { fontSize: 14, fontFamily: "Inter_500Medium" },
  historyMethod: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  historyAmount: { fontSize: 15, fontFamily: "Inter_700Bold" },
});
