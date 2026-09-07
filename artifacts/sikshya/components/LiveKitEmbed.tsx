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
 * ## This should now be unreachable
 *
 * It was written when `VIDEO_PROVIDER=livekit` served LiveKit rooms to every client, phones
 * included — so turning the trial on for the browser took video away from every phone on the
 * platform. The server now decides per client: the app sends an `X-Fadko-Platform` header,
 * a browser gets the configured provider and a phone gets Daily. A phone should therefore never
 * be handed a LiveKit room and never reach this screen.
 *
 * It stays anyway. "Should be unreachable" is a claim about today's routing, and the cost of
 * being wrong is a black rectangle with no explanation during somebody's lesson. A message that
 * says what happened and what still works is the right thing to find there instead.
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
  /**
   * Accepted and unused, exactly like the chat props above.
   *
   * The web build lays out its own tiles and uses these to decide who keeps one; this build lays
   * out nothing at all. They stay in the contract so `VideoCall.tsx` passes the same props to
   * both and needs no special case for a platform.
   */
  teacherUserId?: string | null;
  spotlightUserId?: string | null;
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
