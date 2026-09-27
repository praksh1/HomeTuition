import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, type StyleProp, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AudioSession, RoomContext, VideoTrack, isTrackReference, registerGlobals, useTracks } from "@livekit/react-native";
import { Room, RoomEvent, Track } from "livekit-client";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

// Metro selects LiveKitEmbed.web.tsx for browsers. Native WebRTC globals must be
// registered before a Room is constructed in this phone-only module.
registerGlobals();

export interface LiveKitEmbedProps {
  roomUrl: string;
  meetingToken?: string | null;
  displayName: string;
  onLeft?: () => void;
  onMediaReady?: () => void;
  watchUserName?: string;
  onWatchedParticipantLeft?: () => void;
  onWatchedParticipantReturned?: () => void;
  style?: StyleProp<ViewStyle>;
  canScreenShare?: boolean;
  chatMessages?: { id: string; senderName: string; text: string; time: string; isMe: boolean }[];
  onSendChat?: (text: string) => void;
  enableInCallChat?: boolean;
  teacherUserId?: string | null;
  spotlightUserId?: string | null;
  showControls?: boolean;
  isTeacher?: boolean;
  canUseMicrophone?: boolean;
  canUseCamera?: boolean;
  onLocalMediaChange?: (media: { micEnabled: boolean; cameraEnabled: boolean }) => void;
  onConnectionChange?: (connected: boolean) => void;
  micToggleRequest?: number;
  cameraToggleRequest?: number;
}

type Status = "connecting" | "connected" | "reconnecting" | "error";

/** Trial adapter only. It does not enter the shipping phone build until device testing passes. */
export default function LiveKitEmbed(props: LiveKitEmbedProps) {
  const colors = useColors();
  const { t, space } = useLayout();
  const [retry, setRetry] = useState(0);
  // A retry gets a fresh Room: disconnecting the old one is asynchronous and must not
  // close a new connection to the same instance while it is still starting.
  const room = useMemo(() => new Room({ adaptiveStream: true, dynacast: true }), [retry]);
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const watchedSeen = useRef(false);
  const watchedAbsent = useRef(false);
  const leaving = useRef(false);
  const lastMicRequest = useRef(props.micToggleRequest ?? 0);
  const lastCameraRequest = useRef(props.cameraToggleRequest ?? 0);
  const styles = useMemo(() => makeStyles(colors, space), [colors, space]);

  const reportMedia = useCallback(() => {
    const me = room.localParticipant;
    callbacks.current.onLocalMediaChange?.({
      micEnabled: me.isMicrophoneEnabled,
      cameraEnabled: me.isCameraEnabled,
    });
  }, [room]);

  const refreshRoster = useCallback(() => {
    setRevision((value) => value + 1);
    reportMedia();
    const current = callbacks.current;
    if (!current.teacherUserId && !current.watchUserName) return;
    const teacherPresent = Array.from(room.remoteParticipants.values()).some((person) =>
      current.teacherUserId
        ? person.identity === current.teacherUserId
        : person.name === current.watchUserName,
    );
    if (teacherPresent) {
      if (watchedAbsent.current) current.onWatchedParticipantReturned?.();
      watchedSeen.current = true;
      watchedAbsent.current = false;
    } else if (watchedSeen.current && !watchedAbsent.current) {
      watchedAbsent.current = true;
      current.onWatchedParticipantLeft?.();
    }
  }, [room, reportMedia]);

  useEffect(() => {
    if (!props.roomUrl || !props.meetingToken) {
      setStatus("error");
      setError("Video access is missing. Reopen the class and try again.");
      return;
    }
    let cancelled = false;
    leaving.current = false;
    setStatus("connecting");
    setError(null);
    const connected = () => {
      if (cancelled) return;
      setStatus("connected");
      callbacks.current.onConnectionChange?.(true);
      callbacks.current.onMediaReady?.();
      refreshRoster();
    };
    const reconnecting = () => {
      if (cancelled) return;
      setStatus("reconnecting");
      callbacks.current.onConnectionChange?.(false);
    };
    const disconnected = () => {
      callbacks.current.onConnectionChange?.(false);
      if (cancelled || leaving.current) return;
      setStatus("error");
      setError("The video connection ended. Your whiteboard and class chat are still available.");
    };
    room.on(RoomEvent.Connected, connected)
      .on(RoomEvent.Reconnected, connected)
      .on(RoomEvent.Reconnecting, reconnecting)
      .on(RoomEvent.Disconnected, disconnected)
      .on(RoomEvent.ParticipantConnected, refreshRoster)
      .on(RoomEvent.ParticipantDisconnected, refreshRoster)
      .on(RoomEvent.TrackSubscribed, refreshRoster)
      .on(RoomEvent.TrackUnsubscribed, refreshRoster)
      .on(RoomEvent.TrackMuted, refreshRoster)
      .on(RoomEvent.TrackUnmuted, refreshRoster)
      .on(RoomEvent.LocalTrackPublished, refreshRoster)
      .on(RoomEvent.LocalTrackUnpublished, refreshRoster);

    void (async () => {
      try {
        await AudioSession.startAudioSession();
        if (cancelled) return;
        await room.connect(props.roomUrl, props.meetingToken!);
        if (cancelled) return;
        // Students begin muted/camera-off; publication requires a teacher grant.
        if (props.isTeacher) {
          await Promise.allSettled([
            room.localParticipant.setMicrophoneEnabled(true),
            room.localParticipant.setCameraEnabled(true),
          ]);
          refreshRoster();
        }
      } catch (cause) {
        if (cancelled) return;
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Could not join the video call.");
        callbacks.current.onConnectionChange?.(false);
      }
    })();

    return () => {
      cancelled = true;
      room.removeAllListeners();
      void room.disconnect().finally(() => AudioSession.stopAudioSession());
      callbacks.current.onConnectionChange?.(false);
    };
  }, [room, props.roomUrl, props.meetingToken, props.isTeacher, retry, refreshRoster]);

  const toggleMic = useCallback(async () => {
    const me = room.localParticipant;
    if (!me.isMicrophoneEnabled && !callbacks.current.isTeacher && !callbacks.current.canUseMicrophone) return;
    try {
      await me.setMicrophoneEnabled(!me.isMicrophoneEnabled);
      setActionError(null);
      reportMedia();
    } catch {
      setActionError("Microphone could not be changed. Check access or ask the teacher.");
    }
  }, [room, reportMedia]);

  const toggleCamera = useCallback(async () => {
    const me = room.localParticipant;
    if (!me.isCameraEnabled && !callbacks.current.isTeacher && !callbacks.current.canUseCamera) return;
    try {
      await me.setCameraEnabled(!me.isCameraEnabled);
      setActionError(null);
      reportMedia();
    } catch {
      setActionError("Camera could not be changed. Check access or ask the teacher.");
    }
  }, [room, reportMedia]);

  useEffect(() => {
    const next = props.micToggleRequest ?? 0;
    if (next <= lastMicRequest.current) return;
    lastMicRequest.current = next;
    if (status === "connected") void toggleMic();
  }, [props.micToggleRequest, status, toggleMic]);
  useEffect(() => {
    const next = props.cameraToggleRequest ?? 0;
    if (next <= lastCameraRequest.current) return;
    lastCameraRequest.current = next;
    if (status === "connected") void toggleCamera();
  }, [props.cameraToggleRequest, status, toggleCamera]);
  useEffect(() => {
    if (!props.isTeacher && !props.canUseMicrophone && room.localParticipant.isMicrophoneEnabled)
      void room.localParticipant.setMicrophoneEnabled(false).then(reportMedia);
    if (!props.isTeacher && !props.canUseCamera && room.localParticipant.isCameraEnabled)
      void room.localParticipant.setCameraEnabled(false).then(reportMedia);
  }, [props.isTeacher, props.canUseMicrophone, props.canUseCamera, room, reportMedia]);

  const leave = () => {
    if (leaving.current) return;
    leaving.current = true;
    void room.disconnect().finally(() => callbacks.current.onLeft?.());
  };
  const send = () => {
    const value = draft.trim();
    if (!value || !props.onSendChat) return;
    props.onSendChat(value);
    setDraft("");
  };

  return <RoomContext.Provider value={room}>
    <View style={[styles.root, props.style]} testID="livekit-native-room">
      {status === "connected"
        ? <NativeStage teacherUserId={props.teacherUserId} spotlightUserId={props.spotlightUserId} revision={revision} />
        : <View style={styles.center}>
            {status !== "error" && <ActivityIndicator color={colors.onInverse} />}
            <Text style={[t.caption, styles.hint]}>{status === "error" ? error : status === "reconnecting" ? "Reconnecting the call…" : "Joining the call…"}</Text>
            {status === "error" && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry video connection" style={styles.retry} onPress={() => setRetry((value) => value + 1)}><Text style={styles.retryText}>Try again</Text></TouchableOpacity>}
          </View>}
      {actionError && <Text accessibilityRole="alert" style={styles.actionError}>{actionError}</Text>}
      {chatOpen && props.onSendChat && <View style={styles.chatPanel} testID="call-chat-panel">
        <View style={styles.chatHeader}><Text style={styles.chatTitle}>Class chat</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close class chat" onPress={() => setChatOpen(false)}><Feather name="x" size={22} color={colors.onInverse} /></TouchableOpacity></View>
        <ScrollView style={styles.chatScroll} contentContainerStyle={styles.chatBody}>
          {(props.chatMessages ?? []).length === 0 ? <Text style={styles.hint}>No messages yet.</Text> : props.chatMessages?.map((message) =>
            <View key={message.id} style={[styles.message, message.isMe && styles.mine]}><Text style={styles.sender}>{message.senderName}</Text><Text style={styles.messageText}>{message.text}</Text></View>)}
        </ScrollView>
        <View style={styles.chatInputRow}><TextInput style={styles.chatInput} value={draft} onChangeText={setDraft} placeholder="Message everyone…" placeholderTextColor={colors.onInverseMuted} returnKeyType="send" onSubmitEditing={send} /><TouchableOpacity accessibilityRole="button" accessibilityLabel="Send class chat message" style={styles.control} onPress={send}><Feather name="send" size={18} color={colors.onInverse} /></TouchableOpacity></View>
      </View>}
      {props.showControls !== false && <View style={styles.controls}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={room.localParticipant.isMicrophoneEnabled ? "Mute microphone" : "Turn on microphone"} disabled={status !== "connected"} style={styles.control} onPress={() => void toggleMic()}><Feather name={room.localParticipant.isMicrophoneEnabled ? "mic" : "mic-off"} size={20} color={colors.onInverse} /></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={room.localParticipant.isCameraEnabled ? "Turn off camera" : "Turn on camera"} disabled={status !== "connected"} style={styles.control} onPress={() => void toggleCamera()}><Feather name={room.localParticipant.isCameraEnabled ? "video" : "video-off"} size={20} color={colors.onInverse} /></TouchableOpacity>
        {props.onSendChat && <TouchableOpacity accessibilityRole="button" accessibilityLabel={chatOpen ? "Close class chat" : "Open class chat"} style={styles.control} onPress={() => setChatOpen((value) => !value)}><Feather name="message-circle" size={20} color={colors.onInverse} /></TouchableOpacity>}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Leave video call" style={[styles.control, styles.leave]} onPress={leave}><Feather name="phone-off" size={20} color={colors.destructive} /></TouchableOpacity>
      </View>}
    </View>
  </RoomContext.Provider>;
}

function NativeStage({ teacherUserId, spotlightUserId, revision }: { teacherUserId?: string | null; spotlightUserId?: string | null; revision: number }) {
  const colors = useColors();
  const { t, space } = useLayout();
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);
  // The SDK hook updates on track events; revision also refreshes speaking/roster ordering.
  void revision;
  const score = (item: (typeof tracks)[number]) =>
    (item.source === Track.Source.ScreenShare ? 100 : 0) +
    (item.participant.identity === spotlightUserId ? 40 : 0) +
    (item.participant.identity === teacherUserId ? 20 : 0) +
    (item.participant.isSpeaking ? 5 : 0);
  const ordered = [...tracks].filter(isTrackReference).sort((a, b) => score(b) - score(a));
  const stage = ordered[0];
  return <View style={{ flex: 1, backgroundColor: colors.ink }}>
    {stage ? <VideoTrack trackRef={stage} style={{ flex: 1 }} objectFit="contain" /> :
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm }}><Feather name="users" size={28} color={colors.onInverseMuted} /><Text style={[t.caption, { color: colors.onInverseMuted }]}>Waiting for video. Audio may still be live.</Text></View>}
    {ordered.length > 1 && <ScrollView horizontal style={{ maxHeight: 78, flexGrow: 0 }} contentContainerStyle={{ gap: space.xs, paddingHorizontal: space.xs }}>
      {ordered.slice(1, 6).map((item) => <View key={item.participant.identity + item.source} style={{ width: 94, height: 66, borderRadius: 10, overflow: "hidden", backgroundColor: colors.secondary }}><VideoTrack trackRef={item} style={{ width: "100%", height: "100%" }} /><Text numberOfLines={1} style={{ position: "absolute", bottom: 2, left: 4, right: 4, color: colors.onInverse, fontSize: 10 }}>{item.participant.name || "Participant"}</Text></View>)}
    </ScrollView>}
  </View>;
}

function makeStyles(colors: ReturnType<typeof useColors>, space: ReturnType<typeof useLayout>["space"]) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.ink, overflow: "hidden" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.md },
    hint: { color: colors.onInverseMuted, textAlign: "center" },
    retry: { backgroundColor: colors.primary, borderRadius: 22, paddingHorizontal: space.lg, paddingVertical: space.sm },
    retryText: { color: colors.primaryForeground, fontWeight: "700" },
    actionError: { color: colors.onInverse, textAlign: "center", padding: space.xs },
    controls: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: space.sm, padding: space.xs },
    control: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary },
    leave: { backgroundColor: colors.destructiveSoft, borderWidth: 1, borderColor: colors.destructive },
    chatPanel: { maxHeight: 270, backgroundColor: colors.ink, borderTopWidth: 1, borderColor: colors.secondary },
    chatHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md, paddingVertical: space.xs },
    chatTitle: { color: colors.onInverse, fontWeight: "700" },
    chatScroll: { maxHeight: 180 },
    chatBody: { gap: space.xs, padding: space.sm },
    message: { alignSelf: "flex-start", maxWidth: "85%", backgroundColor: colors.secondary, borderRadius: 12, padding: space.xs },
    mine: { alignSelf: "flex-end", backgroundColor: colors.primary },
    sender: { color: colors.onInverseMuted, fontSize: 11, marginBottom: 3 },
    messageText: { color: colors.onInverse },
    chatInputRow: { flexDirection: "row", alignItems: "center", gap: space.xs, padding: space.xs },
    chatInput: { flex: 1, color: colors.onInverse, backgroundColor: colors.secondary, borderRadius: 20, paddingHorizontal: space.sm, minHeight: 44 },
  });
}
