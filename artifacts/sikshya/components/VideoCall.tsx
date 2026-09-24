import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import DailyEmbed from "@/components/DailyEmbed";
import LiveKitEmbed from "@/components/LiveKitEmbed";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

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
  /**
   * The instant this device's media connection comes up.
   *
   * Only a provider whose permissions the server can change mid-call has anything to do with it,
   * so Daily ignores it — and on Daily every participant may unmute themselves anyway, which is
   * why there is no grant to be waiting on. The classroom passes it to the floor.
   */
  onMediaReady?: () => void;
  /** Watch for one named participant leaving — how a student learns the teacher has gone. */
  watchUserName?: string;
  onWatchedParticipantLeft?: () => void;
  onWatchedParticipantReturned?: () => void;
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
  /**
   * The class's teacher, by account id, so their tile is never dropped for a talkative student.
   *
   * Only a provider that lays out its own tiles can use it. Daily brings its own interface and
   * ignores it, which is why it is optional rather than required — a prop no provider needs is a
   * prop that should not be in this contract at all.
   */
  teacherUserId?: string | null;
  /** Whoever the teacher has featured, from the classroom floor. */
  spotlightUserId?: string | null;
  /**
   * Whether provider controls fit in the app-owned call window.
   *
   * A compact call window is a preview, not a second toolbar. The classroom shell owns the
   * window size and tells a custom provider when there is enough room to draw controls. Daily
   * brings its own iframe UI and cannot use this hint; LiveKit can and must.
   */
  showProviderControls?: boolean;
  /** Teacher camera is available immediately; student camera is a teacher-granted capability. */
  isTeacher?: boolean;
  canUseMicrophone?: boolean;
  canUseCamera?: boolean;
  onLocalMediaChange?: (media: { micEnabled: boolean; cameraEnabled: boolean }) => void;
  onConnectionChange?: (connected: boolean) => void;
  /** Request a microphone toggle from the app-owned classroom control, even when video is hidden. */
  micToggleRequest?: number;
  cameraToggleRequest?: number;
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

    /**
     * Under trial, and browser-only.
     *
     * The two providers stay separate components rather than being merged behind one imperative
     * module, because merging would mean rewriting Daily — and Daily is what the class runs on
     * today. `lib/video` gives LiveKit the provider-agnostic verbs; this switch is what keeps
     * every screen from knowing either name. See VIDEO.md.
     *
     * On Android and iOS `LiveKitEmbed` resolves to a stub that says video is unavailable,
     * because both SDKs ship the same native WebRTC library and cannot share a build.
     */
    case "livekit":
      return (
        <LiveKitEmbed
          roomUrl={props.roomUrl}
          meetingToken={props.token}
          displayName={props.displayName}
          style={props.style}
          onLeft={props.onLeft}
          onMediaReady={props.onMediaReady}
          watchUserName={props.watchUserName}
          onWatchedParticipantLeft={props.onWatchedParticipantLeft}
          onWatchedParticipantReturned={props.onWatchedParticipantReturned}
          canScreenShare={props.canScreenShare}
          chatMessages={props.chatMessages}
          onSendChat={props.onSendChat}
          teacherUserId={props.teacherUserId}
          spotlightUserId={props.spotlightUserId}
          showControls={props.showProviderControls}
          isTeacher={props.isTeacher === true}
          canUseMicrophone={props.isTeacher === true || props.canUseMicrophone === true}
          canUseCamera={props.isTeacher === true || props.canUseCamera === true}
          onLocalMediaChange={props.onLocalMediaChange}
          onConnectionChange={props.onConnectionChange}
          micToggleRequest={props.micToggleRequest}
          cameraToggleRequest={props.cameraToggleRequest}
        />
      );

    case "echo":
      /**
       * Preview and automated journeys may deliberately use the no-media provider. It proves
       * room access, attendance, chat and the shared board without opening a paid video room.
       * Calling that an old app which needs an update was false and made a test class look
       * broken.
       */
      return <TestRoomVideo style={props.style} />;

    default:
      /**
       * A provider this build does not know.
       *
       * Only reachable if the server is set to something this app has not been updated for —
       * a half-finished migration, or an old app against a new server. It says so rather than
       * rendering a blank rectangle, because "the video area is black" is the least
       * diagnosable bug report there is.
       */
      return <UnknownProvider name={provider} style={props.style} />;
  }
}

function TestRoomVideo({ style }: { style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  const { t, space } = useLayout();
  return (
    <View
      style={[styles.unknown, { backgroundColor: colors.ink, padding: space.lg }, style]}
      testID="video-provider-test-room"
    >
      <Text style={[t.callout, { color: colors.onInverse, textAlign: "center" }]}>
        Video is off in this test room. Whiteboard and class chat are ready.
      </Text>
    </View>
  );
}

/**
 * The last file in the video path still writing its own colours, now that both embeds are
 * tokenized. Its own component because the tokens come from hooks, and a `switch` arm is not
 * a place a hook may be called.
 */
function UnknownProvider({ name, style }: { name: string; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  const { t, space } = useLayout();
  return (
    <View
      style={[styles.unknown, { backgroundColor: colors.ink, padding: space.xl }, style]}
      testID="video-provider-unknown"
    >
      <Text style={[t.callout, { color: colors.onInverse, textAlign: "center" }]}>
        This version of the app cannot open “{name}” video calls. Please update the app.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  unknown: { alignItems: "center", justifyContent: "center" },
});
