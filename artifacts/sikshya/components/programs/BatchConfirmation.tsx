import React from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { readingWidth } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { ProgramButton } from "./ProgramPieces";

/** No fade-out: a dismissed decision must not linger over the next wizard step. */
export function BatchConfirmation({ visible, title, consequences, confirmLabel, destructive, busy, onCancel, onConfirm }: {
  visible: boolean; title: string; consequences: string[]; confirmLabel: string;
  destructive: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  return <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: space.md, backgroundColor: colors.scrim }}>
      <View testID="batch-confirmation" accessibilityViewIsModal style={{ width: "100%", maxWidth: readingWidth, maxHeight: "88%", backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
          <Text accessibilityRole="header" style={[t.title2, { color: colors.foreground }]}>{title}</Text>
          {consequences.map((line) => <Text key={line} style={[t.body, { color: colors.mutedForeground }]}>{line}</Text>)}
        </ScrollView>
        <View style={{ padding: space.md, gap: space.xs }}>
          <ProgramButton testID="warning-cancel" label="Keep editing" emphasis="quiet" disabled={busy} onPress={onCancel} />
          <ProgramButton testID="warning-confirm" label={confirmLabel} emphasis={destructive ? "danger" : "primary"} busy={busy} onPress={onConfirm} />
        </View>
      </View>
    </View>
  </Modal>;
}
