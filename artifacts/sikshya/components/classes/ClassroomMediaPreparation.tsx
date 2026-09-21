import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Text, TouchableOpacity, View } from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

interface Props {
  visible: boolean;
  onComplete: (result: { microphone: "granted" | "denied" | "unavailable"; camera: "granted" | "denied" | "unavailable" }) => void;
}

async function requestOne(kind: "microphone" | "camera"): Promise<"granted" | "denied" | "unavailable"> {
  if (Platform.OS !== "web" || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "unavailable";
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia(
      kind === "microphone" ? { audio: true, video: false } : { audio: false, video: true },
    );
    stream.getTracks().forEach((track) => track.stop());
    return "granted";
  } catch {
    return "denied";
  }
}

/** A single calm permission step before the student's LiveKit connection is created. */
export function ClassroomMediaPreparation({ visible, onComplete }: Props) {
  const colors = useColors();
  const { t, space, radius, elevation } = useLayout();
  const [busy, setBusy] = useState(false);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  useEffect(() => {
    if (!visible || Platform.OS !== "web" || typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let cancelled = false;
    // A returning student should not see another preparation modal when the browser has
    // already settled both decisions. Safari may not support these queries; the manual
    // Continue/skip choices remain available there.
    void Promise.all([
      navigator.permissions.query({ name: "microphone" as PermissionName }),
      navigator.permissions.query({ name: "camera" as PermissionName }),
    ]).then(([microphone, camera]) => {
      if (cancelled || microphone.state === "prompt" || camera.state === "prompt") return;
      completeRef.current({ microphone: microphone.state, camera: camera.state });
    }).catch(() => { /* Permission queries are optional in browsers. */ });
    return () => { cancelled = true; };
  }, [visible]);

  const prepare = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const microphone = await requestOne("microphone");
    const camera = await requestOne("camera");
    setBusy(false);
    onComplete({ microphone, camera });
  }, [busy, onComplete]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={[styles.scrim, { padding: space.lg, backgroundColor: colors.scrim }]}>
        <View
          testID="classroom-media-preparation"
          accessibilityViewIsModal
          style={[
            styles.card,
            elevation.modal,
            {
              gap: space.md,
              padding: space.xl,
              borderRadius: radius.lg,
              borderColor: colors.border,
              backgroundColor: colors.card,
            },
          ]}
        >
          <View style={[styles.icon, { borderRadius: radius.pill, backgroundColor: colors.actionSoft }]}>
            <Feather name="video" size={24} color={colors.primary} />
          </View>
          <View style={{ gap: space.xs }}>
            <Text style={[t.title2, { color: colors.foreground, textAlign: "center" }]}>Get ready for class</Text>
            <Text style={[t.callout, { color: colors.mutedForeground, textAlign: "center" }]}>
              Fadko will ask your browser for microphone and camera access. Granting access does not turn either one on.
            </Text>
          </View>

          <View style={[styles.promise, { gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceSunk }]}>
            <View style={[styles.promiseRow, { gap: space.sm }]}>
              <Feather name="mic-off" size={18} color={colors.primary} />
              <Text style={[t.body, { color: colors.foreground }]}>You enter with your microphone muted</Text>
            </View>
            <View style={[styles.promiseRow, { gap: space.sm }]}>
              <Feather name="video-off" size={18} color={colors.primary} />
              <Text style={[t.body, { color: colors.foreground }]}>Your camera stays off</Text>
            </View>
            <View style={[styles.promiseRow, { gap: space.sm }]}>
              <Feather name="shield" size={18} color={colors.primary} />
              <Text style={[t.body, { color: colors.foreground }]}>Your teacher controls student camera access</Text>
            </View>
          </View>

          <TouchableOpacity
            testID="classroom-media-continue"
            accessibilityRole="button"
            accessibilityLabel="Continue and choose camera and microphone permissions"
            disabled={busy}
            onPress={() => void prepare()}
            activeOpacity={0.84}
            style={[
              styles.continue,
              {
                minHeight: HIT_SLOP_MIN + 4,
                gap: space.xs,
                borderRadius: radius.md,
                backgroundColor: colors.primary,
                opacity: busy ? 0.72 : 1,
              },
            ]}
          >
            {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name="arrow-right" size={18} color={colors.primaryForeground} />}
            <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>{busy ? "Checking devices…" : "Continue"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="classroom-media-skip"
            accessibilityRole="button"
            accessibilityLabel="Join class without camera or microphone access"
            disabled={busy}
            onPress={() => onComplete({ microphone: "unavailable", camera: "unavailable" })}
            style={{ minHeight: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={[t.bodyStrong, { color: colors.primary }]}>Join without devices</Text>
          </TouchableOpacity>
          <Text style={[t.caption, { color: colors.inkFaint, textAlign: "center" }]}>
            If you deny access, you can still use the whiteboard and messages.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = {
  scrim: { flex: 1, alignItems: "center", justifyContent: "center" } as const,
  card: { width: "100%", maxWidth: 430, alignItems: "stretch", borderWidth: 1 } as const,
  icon: { width: 54, height: 54, alignItems: "center", justifyContent: "center", alignSelf: "center" } as const,
  promise: { alignItems: "stretch" } as const,
  promiseRow: { flexDirection: "row", alignItems: "center" } as const,
  continue: { flexDirection: "row", alignItems: "center", justifyContent: "center" } as const,
};
