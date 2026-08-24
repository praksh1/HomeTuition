import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import DailyEmbed from "@/components/DailyEmbed";

/**
 * The call, whoever is carrying it.
 *
 * Every classroom screen mounts this rather than a named provider. Daily.co is the only
 * implementation today and behaves exactly as it did; the seam exists because replacing it is
 * decided future work — forty-five people in a daily ninety-minute call does not survive
 * per-participant-minute pricing — and a swap should be one new file rather than an edit to
 * every screen that shows a lesson.
 *
 * The props are the ones any provider needs: where to join, a token, who you are, and the
 * handful of things this app does around the edges of a call. Nothing Daily-shaped is in the
 * contract. See lib/video/types.ts on the server and VIDEO.md for what a replacement owes.
 */

export interface VideoCallProps {
  /** Which implementation to mount. Comes from the server with the room. */
  provider?: string;
  roomUrl: string;
  token?: string | null;
  displayName: string;
  style?: StyleProp<ViewStyle>;
  /** The instant the local person leaves the call. */
  onLeft?: () => void;
  /** Watch for one named participant leaving — how a student learns the teacher has gone. */
  watchUserName?: string;
  onWatchedParticipantLeft?: () => void;
  /** Presenter action, so only the teacher gets it. */
  canScreenShare?: boolean;
  /**
   * The class's own chat, carried on our WebSocket rather than the provider's.
   *
   * Deliberately ours: it survives the call ending, it reaches people who have not joined yet,
   * and it does not split a class between two conversations. A provider that brings its own
   * chat does not change this.
   */
  chatMessages?: { id: string; senderName: string; text: string; time: string; isMe: boolean }[];
  onSendChat?: (text: string) => void;
}

export default function VideoCall({ provider = "daily", ...props }: VideoCallProps) {
  switch (provider) {
    case "daily":
      return (
        <DailyEmbed
          roomUrl={props.roomUrl}
          meetingToken={props.token}
          displayName={props.displayName}
          style={props.style}
          onLeft={props.onLeft}
          watchUserName={props.watchUserName}
          onWatchedParticipantLeft={props.onWatchedParticipantLeft}
          canScreenShare={props.canScreenShare}
          chatMessages={props.chatMessages}
          onSendChat={props.onSendChat}
        />
      );

    default:
      /**
       * A provider this build does not know.
       *
       * Only reachable if the server is set to something this app has not been updated for —
       * a half-finished migration, or an old app against a new server. It says so rather than
       * rendering a blank rectangle, because "the video area is black" is the least
       * diagnosable bug report there is.
       */
      return (
        <View style={[styles.unknown, props.style]} testID="video-provider-unknown">
          <Text style={styles.unknownText}>
            This version of the app cannot open “{provider}” video calls. Please update the app.
          </Text>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  unknown: { alignItems: "center", justifyContent: "center", backgroundColor: "#111", padding: 24 },
  unknownText: { color: "#fff", fontSize: 14, textAlign: "center", lineHeight: 20 },
});
