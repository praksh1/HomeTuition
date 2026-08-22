import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Daily, {
  DailyMediaView,
  type DailyCall,
  type DailyParticipant,
} from "@daily-co/react-native-daily-js";

interface Props {
  roomUrl: string;
  /** Daily meeting token; owner rights for the session's teacher. */
  meetingToken?: string | null;
  displayName: string;
  style?: StyleProp<ViewStyle>;
  /** Called the instant the local user exits the call. */
  onLeft?: () => void;
  /** If set, fires `onWatchedParticipantLeft` when a remote participant with this
   * display name leaves the call — used to notify students if the teacher drops. */
  watchUserName?: string;
  onWatchedParticipantLeft?: () => void;
  /** Screen sharing is a presenter action; only the teacher gets the control. */
  canScreenShare?: boolean;
  /**
   * Chat, supplied by the classroom's own websocket.
   *
   * Daily Prebuilt carries a chat panel, but Prebuilt is the web experience — this native UI
   * exists precisely because a WebView cannot screen-share, and it has no Prebuilt to inherit
   * from. Feeding the app's own chat in here keeps everyone in a single conversation rather
   * than splitting the class between an in-call chat and an in-app one.
   */
  chatMessages?: { id: string; senderName: string; text: string; time: string; isMe: boolean }[];
  onSendChat?: (text: string) => void;
}

/**
 * Native video call built directly on Daily's React Native SDK.
 *
 * This deliberately does NOT use Daily Prebuilt in a WebView, which is what the web build
 * still does. A WebView cannot capture the device screen — iOS and Android only expose screen
 * capture to native code — so presenting from a phone is impossible through that route no
 * matter how it is configured. The cost of using the SDK is that Daily's ready-made call
 * interface disappears and every control below has to be provided by us.
 */

type ScreenShareState = "idle" | "starting" | "sharing";

/** Pulls the playable track off a participant, tolerating the not-yet-playable case. */
function trackOf(p: DailyParticipant | undefined, kind: "video" | "audio" | "screenVideo") {
  const state = p?.tracks?.[kind];
  return state?.persistentTrack ?? null;
}

function isSharingScreen(p: DailyParticipant): boolean {
  return p.tracks?.screenVideo?.state === "playable" || !!p.tracks?.screenVideo?.persistentTrack;
}

/**
 * Android needs camera and microphone granted before joining; the SDK will otherwise join
 * muted with no obvious explanation. POST_NOTIFICATIONS is requested because the in-call
 * foreground service posts a notification on Android 13+.
 */
async function ensureAndroidPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const wanted = [
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ];
    if (Number(Platform.Version) >= 33 && PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) {
      wanted.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
    const result = await PermissionsAndroid.requestMultiple(wanted);
    return (
      result[PermissionsAndroid.PERMISSIONS.CAMERA] === "granted" &&
      result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === "granted"
    );
  } catch {
    return false;
  }
}

export default function DailyEmbed({
  roomUrl,
  meetingToken,
  displayName,
  style,
  onLeft,
  watchUserName,
  onWatchedParticipantLeft,
  canScreenShare = false,
  chatMessages,
  onSendChat,
}: Props) {
  const [participants, setParticipants] = useState<DailyParticipant[]>([]);
  const [joining, setJoining] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenShare, setScreenShare] = useState<ScreenShareState>("idle");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  /** Unread badge on the chat button: messages that arrived while the panel was closed. */
  const [unseen, setUnseen] = useState(0);
  const lastSeenCount = useRef(0);

  const callRef = useRef<DailyCall | null>(null);

  // Event handlers read callbacks through a ref so they never capture a stale closure and
  // never force the call to be torn down and rejoined when a parent re-renders.
  const cbRef = useRef({ onLeft, watchUserName, onWatchedParticipantLeft });
  cbRef.current = { onLeft, watchUserName, onWatchedParticipantLeft };

  useEffect(() => {
    if (!roomUrl) return;
    let cancelled = false;
    let call: DailyCall | null = null;

    const sync = () => {
      if (cancelled || !call) return;
      setParticipants(Object.values(call.participants()) as DailyParticipant[]);
    };

    (async () => {
      const granted = await ensureAndroidPermissions();
      if (cancelled) return;
      if (!granted) {
        setError("Camera and microphone access are needed to join the class.");
        setJoining(false);
        return;
      }

      try {
        call = Daily.createCallObject();
        callRef.current = call;

        call.on("joined-meeting", () => {
          if (cancelled) return;
          setJoining(false);
          sync();
        });
        call.on("participant-joined", sync);
        call.on("participant-updated", sync);
        call.on("participant-left", (ev) => {
          sync();
          const { watchUserName: watched, onWatchedParticipantLeft: cb } = cbRef.current;
          if (watched && ev?.participant?.user_name === watched) cb?.();
        });
        call.on("left-meeting", () => {
          if (cancelled) return;
          cbRef.current.onLeft?.();
        });
        call.on("local-screen-share-started", () => !cancelled && setScreenShare("sharing"));
        call.on("local-screen-share-stopped", () => !cancelled && setScreenShare("idle"));
        call.on("local-screen-share-canceled", () => !cancelled && setScreenShare("idle"));
        call.on("error", (ev) => {
          if (cancelled) return;
          setError(ev?.errorMsg ?? "The video call ran into a problem.");
          setJoining(false);
        });
        call.on("camera-error", () => {
          if (cancelled) return;
          setError("Could not start the camera. Another app may be using it.");
        });

        await call.join({ url: roomUrl, userName: displayName, ...(meetingToken ? { token: meetingToken } : null) });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not join the video room.");
        setJoining(false);
      }
    })();

    return () => {
      cancelled = true;
      const c = callRef.current;
      callRef.current = null;
      // destroy() releases the camera and microphone. Leaving it out strands the devices
      // and the next join fails with the hardware already in use.
      if (c) {
        c.leave()
          .catch(() => {})
          .finally(() => {
            c.destroy().catch(() => {});
          });
      }
    };
  }, [roomUrl, displayName, meetingToken]);

  const toggleMic = useCallback(() => {
    const c = callRef.current;
    if (!c) return;
    const next = !c.localAudio();
    c.setLocalAudio(next);
    setMicOn(next);
  }, []);

  const toggleCam = useCallback(() => {
    const c = callRef.current;
    if (!c) return;
    const next = !c.localVideo();
    c.setLocalVideo(next);
    setCamOn(next);
  }, []);

  const toggleScreenShare = useCallback(() => {
    const c = callRef.current;
    if (!c) return;
    if (screenShare === "sharing") {
      c.stopScreenShare();
      setScreenShare("idle");
      return;
    }
    /**
     * The chat gets out of the way first.
     *
     * The other half of the reported problem: "the Daily.co chat/overlay windows are extremely
     * difficult to close on iOS/Android, blocking screen shares". Sharing a screen and reading
     * chat over the top of it are not things anybody is doing at once — the whole point of
     * sharing is that people look at what is shared — so the panel closes itself rather than
     * leaving somebody to find its close button while the thing they wanted to show is behind
     * it. It reopens with one tap, and unread messages still show on the badge meanwhile.
     */
    setChatOpen(false);

    // The OS now shows its own capture consent prompt. "starting" holds until Daily reports
    // back, so the button cannot be double-fired while that dialog is up.
    setScreenShare("starting");
    c.startScreenShare();
  }, [screenShare]);

  useEffect(() => {
    const total = chatMessages?.length ?? 0;
    if (chatOpen) {
      lastSeenCount.current = total;
      setUnseen(0);
    } else {
      setUnseen(Math.max(0, total - lastSeenCount.current));
    }
  }, [chatMessages, chatOpen]);

  const submitChat = useCallback(() => {
    const text = chatDraft.trim();
    if (!text) return;
    onSendChat?.(text);
    setChatDraft("");
  }, [chatDraft, onSendChat]);

  const leave = useCallback(() => {
    const c = callRef.current;
    if (!c) {
      cbRef.current.onLeft?.();
      return;
    }
    c.leave().catch(() => cbRef.current.onLeft?.());
  }, []);

  const local = participants.find((p) => p.local);
  const remotes = participants.filter((p) => !p.local);
  const presenter = participants.find(isSharingScreen);

  if (!roomUrl) return null;

  if (error) {
    return (
      <View style={[style, s.container, s.centre]}>
        <Feather name="video-off" size={28} color="#EF4444" />
        <Text style={s.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={[style, s.container]}>
      {joining ? (
        <View style={[StyleSheet.absoluteFill, s.centre]}>
          <ActivityIndicator color="#fff" />
          <Text style={s.hint}>Joining the class…</Text>
        </View>
      ) : (
        <>
          {presenter ? (
            // Someone is presenting: their screen takes the stage and faces move to a strip.
            <View style={s.stage}>
              <DailyMediaView
                videoTrack={trackOf(presenter, "screenVideo")}
                audioTrack={null}
                objectFit="contain"
                style={s.stageVideo}
              />
              <View style={s.presenterTag}>
                <Feather name="monitor" size={11} color="#fff" />
                <Text style={s.presenterTagText}>
                  {presenter.local ? "You are sharing" : `${presenter.user_name || "Teacher"} is sharing`}
                </Text>
              </View>
            </View>
          ) : (
            <View style={s.stage}>
              {remotes.length > 0 ? (
                <DailyMediaView
                  videoTrack={trackOf(remotes[0], "video")}
                  audioTrack={trackOf(remotes[0], "audio")}
                  objectFit="cover"
                  style={s.stageVideo}
                />
              ) : (
                <View style={[StyleSheet.absoluteFill, s.centre]}>
                  <Feather name="users" size={26} color="#555" />
                  <Text style={s.hint}>Waiting for others to join…</Text>
                </View>
              )}
            </View>
          )}

          {/* Face strip: everyone's camera, including the presenter's own. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.strip}
            contentContainerStyle={s.stripInner}
          >
            {[local, ...remotes].filter(Boolean).map((p) => {
              const person = p as DailyParticipant;
              return (
                <View key={person.session_id} style={s.tile}>
                  <DailyMediaView
                    videoTrack={trackOf(person, "video")}
                    // Local audio is never played back — it would echo.
                    audioTrack={person.local ? null : trackOf(person, "audio")}
                    mirror={person.local}
                    objectFit="cover"
                    style={s.tileVideo}
                  />
                  <Text style={s.tileName} numberOfLines={1}>
                    {person.local ? "You" : person.user_name || "Guest"}
                  </Text>
                </View>
              );
            })}
          </ScrollView>

          {/*
            Somewhere to tap to get out.

            Reported from a phone: "the Daily.co chat/overlay windows are extremely difficult
            to close on iOS/Android, blocking screen shares". They were. The panel had no close
            control of its own — the only way out was the small chat toggle in the bar
            *underneath* it, which on a phone means aiming at a 40-pixel target below a panel
            that is covering the thing you are trying to see. This backdrop closes it from
            anywhere, which is what people try first.
          */}
          {chatOpen && onSendChat && (
            <TouchableOpacity
              testID="call-chat-backdrop"
              style={s.chatBackdrop}
              activeOpacity={1}
              onPress={() => setChatOpen(false)}
            />
          )}

          {chatOpen && onSendChat && (
            <View style={s.chatPanel} testID="call-chat-panel">
              {/* An explicit way out, at the top of the panel, big enough to hit one-handed. */}
              <View style={s.chatHeader}>
                <Text style={s.chatTitle}>Class chat</Text>
                <TouchableOpacity
                  testID="call-chat-close"
                  onPress={() => setChatOpen(false)}
                  hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                  style={s.chatCloseBtn}
                  activeOpacity={0.7}
                >
                  <Feather name="x" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
              <ScrollView style={s.chatScroll} contentContainerStyle={s.chatScrollInner}>
                {(chatMessages ?? []).length === 0 ? (
                  <Text style={s.chatEmpty}>No messages yet.</Text>
                ) : (
                  (chatMessages ?? []).map((m) => (
                    <View key={m.id} style={[s.chatMsg, m.isMe && s.chatMsgMine]}>
                      {!m.isMe && <Text style={s.chatSender}>{m.senderName}</Text>}
                      <Text style={s.chatText}>{m.text}</Text>
                    </View>
                  ))
                )}
              </ScrollView>
              <View style={s.chatInputRow}>
                <TextInput
                  style={s.chatInput}
                  value={chatDraft}
                  onChangeText={setChatDraft}
                  placeholder="Message the class…"
                  placeholderTextColor="#777"
                  onSubmitEditing={submitChat}
                  returnKeyType="send"
                />
                <TouchableOpacity style={s.chatSend} onPress={submitChat} activeOpacity={0.8}>
                  <Feather name="send" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Controls — every one of these came free with Daily Prebuilt on web. */}
          <View style={s.bar}>
            <TouchableOpacity style={[s.btn, !micOn && s.btnOff]} onPress={toggleMic} activeOpacity={0.8}>
              <Feather name={micOn ? "mic" : "mic-off"} size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, !camOn && s.btnOff]} onPress={toggleCam} activeOpacity={0.8}>
              <Feather name={camOn ? "video" : "video-off"} size={18} color="#fff" />
            </TouchableOpacity>
            {onSendChat && (
              <TouchableOpacity style={[s.btn, chatOpen && s.btnActive]} onPress={() => setChatOpen((v) => !v)} activeOpacity={0.8}>
                <Feather name="message-circle" size={18} color="#fff" />
                {unseen > 0 && !chatOpen && (
                  <View style={s.unreadDot}>
                    <Text style={s.unreadDotText}>{unseen > 9 ? "9+" : unseen}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
            {canScreenShare && (
              <TouchableOpacity
                style={[s.btn, screenShare === "sharing" && s.btnActive]}
                onPress={toggleScreenShare}
                activeOpacity={0.8}
                disabled={screenShare === "starting"}
              >
                {screenShare === "starting" ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Feather name="monitor" size={18} color="#fff" />
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[s.btn, s.btnLeave]} onPress={leave} activeOpacity={0.8}>
              <Feather name="phone-off" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", backgroundColor: "#111" },
  centre: { alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 24 },
  hint: { color: "#999", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  errorText: { color: "#ccc", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  stage: { flex: 1, backgroundColor: "#000", position: "relative" },
  stageVideo: { flex: 1, backgroundColor: "#000" },
  presenterTag: {
    position: "absolute", top: 8, left: 8, flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4,
  },
  presenterTagText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  strip: { maxHeight: 78, flexGrow: 0 },
  stripInner: { gap: 6, paddingHorizontal: 8, paddingVertical: 6, alignItems: "center" },
  tile: { width: 92, height: 66, borderRadius: 8, overflow: "hidden", backgroundColor: "#1A1A1A" },
  tileVideo: { width: "100%", height: "100%" },
  tileName: {
    position: "absolute", bottom: 2, left: 4, right: 4, color: "#fff", fontSize: 9,
    fontFamily: "Inter_500Medium", textShadowColor: "#000", textShadowRadius: 3,
  },
  bar: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 12,
    paddingVertical: 10, backgroundColor: "#0A0A0A", borderTopWidth: 1, borderTopColor: "#1E1E1E",
  },
  btn: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#2A2A2A", alignItems: "center", justifyContent: "center" },
  unreadDot: { position: "absolute", top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: "#C41E3A", alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  unreadDotText: { color: "#fff", fontSize: 9, fontFamily: "Inter_700Bold" },
  /**
   * Covers the video, not the controls.
   *
   * Positioned above the bar rather than in the layout flow, so the buttons that mute, hang up
   * and stop a screen share stay reachable while the chat is open — which was half the
   * complaint: an overlay you cannot get out of is much worse when it is also sitting on the
   * button that would end the thing you are stuck in.
   */
  chatBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
  chatPanel: { maxHeight: 260, backgroundColor: "#111", borderTopWidth: 1, borderTopColor: "#222", zIndex: 21 },
  chatHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 14, paddingRight: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#222" },
  chatTitle: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  chatCloseBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  chatScroll: { maxHeight: 190 },
  chatScrollInner: { padding: 10, gap: 6 },
  chatEmpty: { color: "#777", fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 16 },
  chatMsg: { alignSelf: "flex-start", maxWidth: "85%", backgroundColor: "#1E1E1E", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7 },
  chatMsgMine: { alignSelf: "flex-end", backgroundColor: "#C41E3A" },
  chatSender: { color: "#9AA0A6", fontSize: 10, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  chatText: { color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular" },
  chatInputRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderTopWidth: 1, borderTopColor: "#222" },
  chatInput: { flex: 1, backgroundColor: "#1A1A1A", borderRadius: 18, paddingHorizontal: 12, paddingVertical: 9, color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular" },
  chatSend: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#C41E3A", alignItems: "center", justifyContent: "center" },
  btnOff: { backgroundColor: "#5A1F1F" },
  btnActive: { backgroundColor: "#16A34A" },
  btnLeave: { backgroundColor: "#C41E3A" },
});
