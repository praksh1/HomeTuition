import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import DailyEmbed from "@/components/DailyEmbed";
import StreamCall from "@/components/StreamCall";
import type { CallWindowState } from "@/utils/streamRoom";

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
  /**
   * Who the token says you are, when the provider uses identities.
   *
   * Comes from the room grant beside the token, and is null for Daily, which has none. Not a
   * Stream detail: LiveKit and Jitsi both bind a token to an identity too, and a client that
   * sent back a different one would fail to authenticate rather than joining as somebody else.
   */
  identity?: string | null;
  /**
   * Whether the server decided this person is the session's teacher.
   *
   * Passed so a provider's own controls — end the class for everyone, mute somebody, remove
   * them — can be drawn for the right person. It is not what *authorises* them: the token does
   * that, server-side. This only decides what appears on screen.
   */
  isOwner?: boolean;
  /**
   * How big the classroom's window currently is, in provider-neutral words.
   *
   * Sikshya owns the window and always has; this tells the call about it so a provider that can
   * act on it does. Hidden is the one that matters — a call nobody can see should not be
   * carrying video — and the classroom screens map their own sizes onto these four names.
   */
  windowState?: CallWindowState;
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
    /**
     * An experiment, off by default and only reachable when the server names it.
     *
     * Daily is still what every class runs on. This exists so Stream can be evaluated behind the
     * same seam rather than in a fork of the classroom — see STREAM.md — and it refuses honestly
     * when the SDK or the credentials are not there.
     */
    case "stream":
      return (
        <StreamCall
          roomUrl={props.roomUrl}
          token={props.token}
          identity={props.identity}
          displayName={props.displayName}
          isOwner={props.isOwner}
          windowState={props.windowState}
          style={props.style}
          onLeft={props.onLeft}
          watchUserName={props.watchUserName}
          onWatchedParticipantLeft={props.onWatchedParticipantLeft}
          canScreenShare={props.canScreenShare}
        />
      );

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
