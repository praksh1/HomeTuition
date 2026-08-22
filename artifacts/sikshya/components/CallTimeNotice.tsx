import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";

/**
 * What a class is told as it runs out of time.
 *
 * Two notices, one component, because they are the same thing at two moments and should look
 * it: five minutes left, and time is up.
 *
 * Drawn as a banner near the top rather than as a modal, deliberately. A modal over a video
 * call blocks the thing people are there for, and this app already has a complaint about
 * exactly that — overlays on a phone that are hard to get out of. This one covers nothing that
 * matters, has a close button big enough to hit on a phone, and goes away on its own.
 */

interface Props {
  kind: "warning" | "overtime";
  minutesLeft: number;
  /** Only the warning can be closed. The overtime notice is the last thing anybody sees. */
  onClose?: () => void;
}

export default function CallTimeNotice({ kind, minutesLeft, onClose }: Props) {
  const colors = useColors();
  const overtime = kind === "overtime";

  return (
    <View
      testID={overtime ? "call-overtime-notice" : "call-warning-notice"}
      pointerEvents="box-none"
      style={styles.wrap}
    >
      <View
        style={[
          styles.banner,
          {
            backgroundColor: overtime ? colors.destructive : colors.accent,
            // A shadow so it reads as sitting above the video rather than painted on it.
            shadowColor: "#000",
          },
        ]}
      >
        <Feather name={overtime ? "alert-octagon" : "clock"} size={18} color="#fff" />
        <Text style={styles.text}>
          {overtime
            ? "This class has run past its finish time. The call is ending now."
            : `${minutesLeft} minute${minutesLeft === 1 ? "" : "s"} left in this class.`}
        </Text>
        {!overtime && onClose && (
          <TouchableOpacity
            testID="call-warning-close"
            onPress={onClose}
            // A generous target: this is dismissed one-handed, on a phone, mid-sentence.
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            style={styles.close}
            activeOpacity={0.7}
          >
            <Feather name="x" size={18} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: Platform.OS === "web" ? 12 : 52,
    left: 12,
    right: 12,
    alignItems: "center",
    // Above the video and any of Daily's own furniture.
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
  text: { flex: 1, color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  close: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
});
