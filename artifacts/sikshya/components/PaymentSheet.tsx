import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

export type PaymentMethod = "esewa" | "khalti";

interface PaymentSheetProps {
  visible: boolean;
  amount: number;
  label?: string;
  initialMethod?: PaymentMethod;
  onClose: () => void;
  /** Ask the server to continue. This component never collects a wallet credential. */
  onSuccess: (method: PaymentMethod) => void | Promise<void>;
}

const METHOD_META: Record<PaymentMethod, { name: string; monogram: string }> = {
  esewa: { name: "eSewa", monogram: "e" },
  khalti: { name: "Khalti", monogram: "K" },
};

type Stage = "ready" | "processing" | "done";

/**
 * A provider-selection boundary, not a pretend wallet form.
 *
 * Wallet secrets belong only on the provider's hosted page or SDK. Until that integration
 * exists, this sheet can select a method and ask the server to continue, but cannot invent a
 * receipt or claim that money moved.
 */
export default function PaymentSheet({
  visible,
  amount,
  label = "Payment",
  initialMethod = "esewa",
  onClose,
  onSuccess,
}: PaymentSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, numeric, space, radius, elevation } = useLayout();
  const [method, setMethod] = useState<PaymentMethod>(initialMethod);
  const [stage, setStage] = useState<Stage>("ready");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    setMethod(initialMethod);
    setStage("ready");
    setError("");
  }, [visible, initialMethod]);

  const meta = METHOD_META[method];

  const handleContinue = async () => {
    setError("");
    setStage("processing");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    try {
      await onSuccess(method);
      setStage("done");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (reason) {
      setStage("ready");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const detail = reason instanceof Error ? reason.message : "Please try again.";
      setError(`Fadko did not confirm this booking. ${detail}`);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: colors.scrim }]}>
        <View
          style={[
            styles.sheet,
            elevation.modal,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              paddingHorizontal: space.lg,
              paddingTop: space.sm,
              paddingBottom: insets.bottom + space.lg,
              gap: space.md,
            },
          ]}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.grabber, { backgroundColor: colors.lineStrong, borderRadius: radius.pill }]}
          />

          {stage === "done" ? (
            <View style={[styles.center, { gap: space.sm, paddingVertical: space.xxl }]} testID="payment-done">
              <View
                style={[
                  styles.successCircle,
                  { backgroundColor: colors.successSoft, borderRadius: radius.pill },
                ]}
              >
                <Feather name="check" size={32} color={colors.success} />
              </View>
              <Text style={[t.title2, { color: colors.foreground }]}>Booking confirmed</Text>
              <Text style={[t.callout, numeric, styles.centerText, { color: colors.mutedForeground }]}>
                NPR {amount.toLocaleString()} · {meta.name} selected
              </Text>
              <Text style={[t.caption, styles.centerText, { color: colors.inkFaint }]}>
                This is a booking confirmation, not a wallet receipt. Check your provider before
                treating a payment as complete.
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                style={[
                  styles.primaryButton,
                  { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: space.xl },
                ]}
                onPress={onClose}
                activeOpacity={0.85}
              >
                <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <View style={[styles.headerCopy, { gap: space.xxs }]}>
                  <Text accessibilityRole="header" style={[t.title3, { color: colors.foreground }]}>
                    {label}
                  </Text>
                  <Text style={[t.caption, { color: colors.inkFaint }]}>Choose how you want to continue</Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Close payment"
                  disabled={stage === "processing"}
                  onPress={onClose}
                  style={styles.closeButton}
                >
                  <Feather name="x" size={22} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              <View
                style={[
                  styles.amountBox,
                  { backgroundColor: colors.surfaceSunk, borderRadius: radius.md, gap: space.xxs, padding: space.md },
                ]}
              >
                <Text style={[t.caption, { color: colors.mutedForeground }]}>Amount</Text>
                <Text style={[t.title1, numeric, { color: colors.foreground }]}>NPR {amount.toLocaleString()}</Text>
              </View>

              <View accessibilityRole="radiogroup" style={[styles.methodRow, { gap: space.sm }]}>
                {(Object.keys(METHOD_META) as PaymentMethod[]).map((candidate) => {
                  const option = METHOD_META[candidate];
                  const active = method === candidate;
                  return (
                    <TouchableOpacity
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active, disabled: stage === "processing" }}
                      key={candidate}
                      disabled={stage === "processing"}
                      style={[
                        styles.methodButton,
                        {
                          backgroundColor: active ? colors.actionSoft : colors.card,
                          borderColor: active ? colors.primary : colors.border,
                          borderRadius: radius.md,
                          gap: space.xs,
                          paddingHorizontal: space.sm,
                        },
                      ]}
                      onPress={() => setMethod(candidate)}
                      activeOpacity={0.75}
                      testID={`pay-method-${candidate}`}
                    >
                      <View
                        style={[
                          styles.methodBadge,
                          {
                            backgroundColor: active ? colors.primary : colors.surfaceSunk,
                            borderRadius: radius.xs,
                          },
                        ]}
                      >
                        <Text style={[t.bodyStrong, { color: active ? colors.primaryForeground : colors.foreground }]}>
                          {option.monogram}
                        </Text>
                      </View>
                      <Text style={[t.bodyStrong, { color: active ? colors.primary : colors.foreground }]}>
                        {option.name}
                      </Text>
                      {active ? <Feather name="check-circle" size={18} color={colors.primary} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View
                style={[
                  styles.safetyNote,
                  {
                    backgroundColor: colors.actionSoft,
                    borderColor: colors.primary,
                    borderRadius: radius.md,
                    gap: space.sm,
                    padding: space.md,
                  },
                ]}
              >
                <Feather name="shield" size={20} color={colors.primary} />
                <View style={[styles.safetyCopy, { gap: space.xxs }]}>
                  <Text style={[t.bodyStrong, { color: colors.foreground }]}>Keep your wallet PIN private</Text>
                  <Text style={[t.callout, { color: colors.mutedForeground }]}>
                    Fadko will never ask for your eSewa or Khalti MPIN. When live payments are
                    enabled, checkout must open securely with the selected provider.
                  </Text>
                </View>
              </View>

              {error ? (
                <View
                  accessibilityRole="alert"
                  style={[
                    styles.errorBox,
                    { backgroundColor: colors.destructiveSoft, borderRadius: radius.sm, padding: space.sm },
                  ]}
                >
                  <Feather name="alert-circle" size={18} color={colors.destructive} />
                  <Text style={[t.callout, styles.errorText, { color: colors.destructive }]}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Continue with ${meta.name}`}
                style={[
                  styles.primaryButton,
                  { backgroundColor: colors.primary, borderRadius: radius.sm, gap: space.xs },
                  stage === "processing" ? styles.processing : null,
                ]}
                onPress={handleContinue}
                disabled={stage === "processing"}
                activeOpacity={0.85}
                testID="pay-confirm"
              >
                <Feather name="arrow-right" size={18} color={colors.primaryForeground} />
                <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>
                  {stage === "processing" ? "Confirming…" : `Continue with ${meta.name}`}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: { width: "100%", borderTopWidth: StyleSheet.hairlineWidth },
  grabber: { width: 40, height: 4, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  headerCopy: { flex: 1 },
  closeButton: {
    width: HIT_SLOP_MIN,
    height: HIT_SLOP_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
  amountBox: { alignItems: "center" },
  methodRow: { flexDirection: "row" },
  methodButton: {
    minHeight: HIT_SLOP_MIN,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  methodBadge: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  safetyNote: { flexDirection: "row", alignItems: "flex-start", borderWidth: StyleSheet.hairlineWidth },
  safetyCopy: { flex: 1 },
  errorBox: { flexDirection: "row", alignItems: "flex-start" },
  errorText: { flex: 1 },
  primaryButton: {
    minHeight: HIT_SLOP_MIN,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  processing: { opacity: 0.7 },
  center: { alignItems: "center", justifyContent: "center" },
  centerText: { textAlign: "center" },
  successCircle: { width: 72, height: 72, alignItems: "center", justifyContent: "center" },
});
