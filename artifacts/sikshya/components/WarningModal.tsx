import { Feather } from "@expo/vector-icons";
import React from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";

/**
 * Asking someone to agree to something they cannot undo.
 *
 * This replaces `confirm()` for the two decisions that cost money — dropping a class and moving
 * one. The owner asked for these to be "a little bigger and bold" with "simpler word choices to
 * make sure they understand the results of their action", and the browser's own confirm box
 * cannot be made either: it is a small system dialog with one type size and no emphasis, and on
 * a cheap Android phone it is a grey strip most people tap through without reading.
 *
 * The shape is deliberate:
 *
 * - **One big number or fact**, not a paragraph. The thing they are agreeing to, in the largest
 *   type on the screen, before anything explains it.
 * - **Consequences as a short list**, each one line, each starting with what happens rather
 *   than why. Somebody skimming reads the first three words of each line and should still come
 *   away right.
 * - **The confirm button says what it does** — "Drop the class", never "OK". A button labelled
 *   OK is agreed to without being read.
 * - **Cancel first, and plainly styled.** The dangerous option should never be the easy one.
 *
 * Nothing here is a substitute for the server's rules. Every one of these decisions is checked
 * again when the request lands.
 */

export interface WarningModalProps {
  visible: boolean;
  /** Short, plain, and about them: "Drop this class?" */
  title: string;
  /** The single fact they are agreeing to, shown large. A number, a date. */
  headline?: string;
  /** One line under the headline, saying what the headline is. */
  headlineNote?: string;
  /** What will happen, one short sentence each. */
  consequences: string[];
  /** What the confirm button says. Never "OK". */
  confirmLabel: string;
  /** True when the action takes something away, which colours the confirm button. */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}

export default function WarningModal({
  visible, title, headline, headlineNote, consequences,
  confirmLabel, destructive = true, busy = false, onConfirm, onCancel, testID,
}: WarningModalProps) {
  const colors = useColors();
  const accent = destructive ? colors.destructive : colors.primary;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View
          testID={testID ?? "warning-modal"}
          style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <ScrollView bounces={false} contentContainerStyle={styles.body}>
            <View style={[styles.iconWrap, { backgroundColor: accent + "18" }]}>
              <Feather name="alert-triangle" size={26} color={accent} />
            </View>

            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>

            {headline ? (
              <View style={[styles.headlineBox, { borderColor: colors.border, backgroundColor: colors.muted }]}>
                <Text testID="warning-headline" style={[styles.headline, { color: colors.foreground }]}>
                  {headline}
                </Text>
                {headlineNote ? (
                  <Text style={[styles.headlineNote, { color: colors.mutedForeground }]}>{headlineNote}</Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.consequences}>
              {consequences.map((line, i) => (
                <View key={i} style={styles.consequenceRow}>
                  <Feather name="chevron-right" size={16} color={accent} style={{ marginTop: 2 }} />
                  <Text style={[styles.consequenceText, { color: colors.foreground }]}>{line}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={styles.actions}>
            {/* Cancel first, and the plain one. The costly option must never be the easy one. */}
            <TouchableOpacity
              testID="warning-cancel"
              onPress={onCancel}
              disabled={busy}
              activeOpacity={0.85}
              style={[styles.btn, { borderColor: colors.border }]}
            >
              <Text style={[styles.btnText, { color: colors.foreground }]}>Go back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="warning-confirm"
              onPress={onConfirm}
              disabled={busy}
              activeOpacity={0.85}
              style={[styles.btn, { backgroundColor: accent, borderColor: accent, opacity: busy ? 0.6 : 1 }]}
            >
              <Text style={[styles.btnText, { color: "#fff" }]}>{busy ? "Please wait…" : confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center", padding: 20,
  },
  sheet: { width: "100%", maxWidth: 460, maxHeight: "88%", borderRadius: 20, borderWidth: 1, overflow: "hidden" },
  body: { padding: 22, gap: 14 },
  iconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontFamily: "Inter_600SemiBold", lineHeight: 29 },
  headlineBox: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 2 },
  headline: { fontSize: 26, fontFamily: "Inter_600SemiBold", lineHeight: 33 },
  headlineNote: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  consequences: { gap: 10 },
  consequenceRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  consequenceText: { flex: 1, fontSize: 16, fontFamily: "Inter_500Medium", lineHeight: 23 },
  actions: { flexDirection: "row", gap: 10, padding: 16, paddingTop: 4 },
  btn: {
    flex: 1, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderRadius: 12, paddingVertical: 15,
  },
  btnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
