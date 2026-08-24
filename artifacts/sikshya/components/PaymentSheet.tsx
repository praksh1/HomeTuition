import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export type PaymentMethod = "esewa" | "khalti";

interface PaymentSheetProps {
  visible: boolean;
  amount: number;
  label?: string;
  initialMethod?: PaymentMethod;
  onClose: () => void;
  /**
   * Actually take the booking. Resolve for success, **throw for failure**.
   *
   * This sheet used to claim the payment had gone through after a fixed delay and call this
   * afterwards, so a booking that failed — a class already started, a class now full, a server
   * that was down — landed on a student who had just been told "Payment Successful, NPR 500
   * paid via eSewa". Nothing had been paid and nothing had been booked.
   *
   * So the order is reversed: this runs first, and the success screen is only reached if it
   * resolves. A rejection is shown here, on the sheet, with the sheet still open.
   */
  onSuccess: (method: PaymentMethod) => void | Promise<void>;
}

const METHOD_META: Record<PaymentMethod, { name: string; color: string; hint: string; idLabel: string }> = {
  esewa: { name: "eSewa", color: "#60B246", hint: "98XXXXXXXX", idLabel: "eSewa ID / Mobile" },
  khalti: { name: "Khalti", color: "#5C2D91", hint: "98XXXXXXXX", idLabel: "Khalti Mobile" },
};

type Stage = "form" | "processing" | "done";

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
  const [method, setMethod] = useState<PaymentMethod>(initialMethod);
  const [mobile, setMobile] = useState("");
  const [pin, setPin] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [error, setError] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    if (visible) {
      setMethod(initialMethod);
      setMobile("");
      setPin("");
      setStage("form");
      setError("");
    } else {
      clearTimers();
    }
    return clearTimers;
  }, [visible, initialMethod]);

  const meta = METHOD_META[method];

  const handlePay = async () => {
    if (mobile.trim().replace(/\D/g, "").length < 10) {
      setError("Enter a valid 10-digit mobile number");
      return;
    }
    if (pin.trim().length < 4) {
      setError(`Enter your ${meta.name} MPIN`);
      return;
    }
    setError("");
    setStage("processing");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    /**
     * The booking is attempted **now**, and the success screen only appears if it worked.
     *
     * The old order was: pause, announce "Payment Successful", pause again, then try. Which
     * meant every possible failure arrived after the student had been told their money was
     * taken. On a product where no money moves yet, that was the app inventing a receipt.
     */
    try {
      await onSuccess(method);
      setStage("done");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      // Back to the form with the reason, rather than closing over it. Whatever went wrong,
      // they are not booked and nothing was taken — which the message says.
      setStage("form");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError(e instanceof Error ? e.message : "That did not go through. Nothing has been charged.");
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.kav}
        >
          <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 20 }]}>
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />

            {stage === "done" ? (
              <View style={styles.center} testID="payment-done">
                <View style={[styles.successCircle, { backgroundColor: colors.success + "20" }]}>
                  <Feather name="check" size={40} color={colors.success} />
                </View>
                <Text style={[styles.successTitle, { color: colors.foreground }]}>You're booked</Text>
                <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
                  NPR {amount.toLocaleString()} via {meta.name}
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.header}>
                  <Text style={[styles.headerTitle, { color: colors.foreground }]}>{label}</Text>
                  {stage === "form" && (
                    <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close payment">
                      <Feather name="x" size={22} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </View>

                <View style={[styles.amountBox, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.amountLabel, { color: colors.mutedForeground }]}>Amount to pay</Text>
                  <Text style={[styles.amount, { color: colors.foreground }]}>NPR {amount.toLocaleString()}</Text>
                </View>

                <View style={styles.methodRow}>
                  {(["esewa", "khalti"] as PaymentMethod[]).map((m) => {
                    const mm = METHOD_META[m];
                    const active = method === m;
                    return (
                      <TouchableOpacity
                        key={m}
                        disabled={stage !== "form"}
                        style={[
                          styles.methodBtn,
                          {
                            borderColor: active ? mm.color : colors.border,
                            backgroundColor: active ? mm.color + "12" : colors.muted,
                          },
                        ]}
                        onPress={() => setMethod(m)}
                        activeOpacity={0.7}
                        testID={`pay-method-${m}`}
                      >
                        <View style={[styles.methodBadge, { backgroundColor: mm.color }]}>
                          <Text style={styles.methodBadgeText}>{m === "esewa" ? "e" : "K"}</Text>
                        </View>
                        <Text style={[styles.methodName, { color: active ? mm.color : colors.mutedForeground }]}>
                          {mm.name}
                        </Text>
                        {active && <Feather name="check-circle" size={16} color={mm.color} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{meta.idLabel}</Text>
                  <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                    <Feather name="smartphone" size={16} color={colors.mutedForeground} />
                    <TextInput
                      style={[styles.input, { color: colors.foreground }]}
                      placeholder={meta.hint}
                      placeholderTextColor={colors.mutedForeground}
                      value={mobile}
                      onChangeText={setMobile}
                      keyboardType="phone-pad"
                      editable={stage === "form"}
                      maxLength={14}
                      testID="pay-mobile"
                    />
                  </View>
                </View>

                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{meta.name} MPIN</Text>
                  <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                    <Feather name="lock" size={16} color={colors.mutedForeground} />
                    <TextInput
                      style={[styles.input, { color: colors.foreground }]}
                      placeholder="••••"
                      placeholderTextColor={colors.mutedForeground}
                      value={pin}
                      onChangeText={setPin}
                      keyboardType="number-pad"
                      secureTextEntry
                      editable={stage === "form"}
                      maxLength={6}
                      testID="pay-pin"
                    />
                  </View>
                </View>

                {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

                <TouchableOpacity
                  style={[styles.payBtn, { backgroundColor: meta.color }, stage === "processing" && { opacity: 0.7 }]}
                  onPress={handlePay}
                  disabled={stage === "processing"}
                  activeOpacity={0.85}
                  testID="pay-confirm"
                >
                  {stage === "processing" ? (
                    <Text style={styles.payBtnText}>Processing…</Text>
                  ) : (
                    <>
                      <Feather name="lock" size={16} color="#fff" />
                      <Text style={styles.payBtnText}>Pay NPR {amount.toLocaleString()}</Text>
                    </>
                  )}
                </TouchableOpacity>

                <View style={styles.secureNote}>
                  <Feather name="shield" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.secureText, { color: colors.mutedForeground }]}>
                    Secured in-app · 256-bit SSL · No redirect
                  </Text>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  kav: { width: "100%" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, gap: 14 },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 6 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  closeBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  amountBox: { borderRadius: 14, padding: 16, alignItems: "center", gap: 4 },
  amountLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  amount: { fontSize: 28, fontFamily: "Inter_700Bold" },
  methodRow: { flexDirection: "row", gap: 12 },
  methodBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, borderWidth: 1.5, paddingVertical: 12 },
  methodBadge: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  methodBadgeText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  methodName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  field: { gap: 8 },
  fieldLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  error: { fontSize: 13, fontFamily: "Inter_500Medium" },
  payBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 16, marginTop: 2 },
  payBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  secureNote: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  secureText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: 30, gap: 12 },
  successCircle: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  successSub: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
