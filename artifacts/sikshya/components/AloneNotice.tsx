import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { aloneMessage } from "@/utils/aloneInCall";

/**
 * What a call says when the other side has not come back.
 *
 * A banner, not a dialog, and that is the point of it. The old behaviour was an alert box the
 * instant the teacher's video went — "they may rejoin shortly", OK — immediately contradicted
 * by a second alert throwing the student out. A banner interrupts nothing, says how long is
 * left, and offers the two things there are to do.
 *
 * The five silent minutes before this appears are in `utils/aloneInCall.ts`; by the time
 * anybody reads this, waiting has already been tried.
 */

interface Props {
  waitingFor: "teacher" | "students";
  minutesLeft: number;
  /** End the call now rather than waiting it out. */
  onLeave: () => void;
}

export default function AloneNotice({ waitingFor, minutesLeft, onLeave }: Props) {
  const colors = useColors();

  return (
    <View testID="alone-notice" pointerEvents="box-none" style={styles.wrap}>
      <View style={[styles.banner, { backgroundColor: colors.accent, shadowColor: "#000" }]}>
        <Feather name="user-x" size={18} color="#fff" />
        <Text style={styles.text}>{aloneMessage(waitingFor, minutesLeft)}</Text>
        <TouchableOpacity
          testID="alone-notice-leave"
          onPress={onLeave}
          // Generous, because this is pressed one-handed on a phone.
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          style={styles.action}
          activeOpacity={0.75}
        >
          <Text style={styles.actionText}>{waitingFor === "teacher" ? "Leave" : "End"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    // Below the time-limit banner, so the two never sit on top of each other when a class is
    // both running out of time and missing somebody.
    top: Platform.OS === "web" ? 68 : 108,
    left: 12,
    // The same clear gutter CallTimeNotice keeps, so Daily's own corner controls stay reachable.
    right: 64,
    alignItems: "center",
    zIndex: 40,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    maxWidth: 520,
    width: "100%",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { flex: 1, color: "#fff", fontSize: 13.5, fontFamily: "Inter_500Medium", lineHeight: 19 },
  action: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.22)" },
  actionText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
