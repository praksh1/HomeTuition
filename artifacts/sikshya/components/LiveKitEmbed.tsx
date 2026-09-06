import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

/**
 * LiveKit on a phone: deliberately not built, and saying so.
 *
 * ## Why there is no native implementation
 *
 * Daily and LiveKit each ship their own fork of the same native WebRTC library. Counted rather
 * than assumed: 33 Android classes and 47 iOS classes appear in both, and both declare the
 * Android namespace `com.oney.WebRTCModule` and register the React Native module under the name
 * `WebRTCModule`. One app build cannot contain both, and neither SDK can be installed without
 * its fork — each requires it as a peer dependency.
 *
 * So the trial is web only. Android and iOS stay on Daily, which works today, and this file
 * exists so that a phone build never imports `lib/video` and never pulls `livekit-client` into
 * its bundle. Metro resolves `.web.tsx` before `.tsx`, so the browser gets the real component
 * and the phone gets this.
 *
 * ## What this means in practice
 *
 * A deployment with `VIDEO_PROVIDER=livekit` serves LiveKit rooms to every client, including
 * phones — which would land here and show this message instead of a lesson. Point the phone
 * builds at a deployment left on Daily for the duration of the trial. See VIDEO.md.
 *
 * Switching a whole deployment back is the one environment variable and no rebuild.
 */

export interface LiveKitEmbedProps {
  roomUrl: string;
  meetingToken?: string | null;
  displayName: string;
  onLeft?: () => void;
  watchUserName?: string;
  onWatchedParticipantLeft?: () => void;
  style?: StyleProp<ViewStyle>;
  canScreenShare?: boolean;
  chatMessages?: { id: string; senderName: string; text: string; time: string; isMe: boolean }[];
  onSendChat?: (text: string) => void;
  enableInCallChat?: boolean;
}

export default function LiveKitEmbed({ style }: LiveKitEmbedProps) {
  const colors = useColors();
  const { t, space } = useLayout();

  return (
    <View
      testID="livekit-unavailable-native"
      style={[styles.box, { backgroundColor: colors.ink, padding: space.xl, gap: space.sm }, style]}
    >
      <Text style={[t.bodyStrong, { color: colors.onInverse, textAlign: "center" }]}>
        Video is not available in the app for this class.
      </Text>
      <Text style={[t.caption, { color: colors.onInverseMuted, textAlign: "center" }]}>
        Open the class in a web browser to join the call. The whiteboard and the class chat work
        here as normal.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, alignItems: "center", justifyContent: "center" },
});
