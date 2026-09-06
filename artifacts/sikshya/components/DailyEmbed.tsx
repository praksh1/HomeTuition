import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import {
  cameraActionLabel,
  chatActionLabel,
  firstRemoteParticipant,
  microphoneActionLabel,
  sharingPresenter,
  screenShareActionLabel,
  unseenChatCount,
  watchedParticipantLeft,
  type ScreenShareState,
} from "@/utils/dailyEmbedUi";

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

/** Pulls the playable track off a participant, tolerating the not-yet-playable case. */
function trackOf(p: DailyParticipant | undefined, kind: "video" | "audio" | "screenVideo") {
  const state = p?.tracks?.[kind];
  return state?.persistentTrack ?? null;
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
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const s = useMemo(
    () => createStyles(colors, t, space, radius),
    [
      colors.foreground,
      colors.onInverseMuted,
      colors.onInverse,
      colors.secondary,
      colors.secondaryForeground,
      colors.brand,
      colors.brandForeground,
      colors.lineStrong,
      colors.primary,
      colors.primaryForeground,
      colors.destructive,
      colors.destructiveSoft,
      colors.success,
      t,
      space,
      radius,
    ],
  );
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
  const leftAnnounced = useRef(false);

  const callRef = useRef<DailyCall | null>(null);

  // Event handlers read callbacks through a ref so they never capture a stale closure and
  // never force the call to be torn down and rejoined when a parent re-renders.
  const cbRef = useRef({ onLeft, watchUserName, onWatchedParticipantLeft });
  cbRef.current = { onLeft, watchUserName, onWatchedParticipantLeft };

  useEffect(() => {
    if (!roomUrl) return;
    leftAnnounced.current = false;
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
          if (watchedParticipantLeft(watched, ev?.participant?.user_name)) cb?.();
        });
        call.on("left-meeting", () => {
          if (cancelled || leftAnnounced.current) return;
          leftAnnounced.current = true;
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
      setUnseen(unseenChatCount(total, lastSeenCount.current, false));
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
      if (!leftAnnounced.current) {
        leftAnnounced.current = true;
        cbRef.current.onLeft?.();
      }
      return;
    }
    c.leave().catch(() => {
      if (leftAnnounced.current) return;
      leftAnnounced.current = true;
      cbRef.current.onLeft?.();
    });
  }, []);

  const local = participants.find((p) => p.local);
  const remotes = participants.filter((p) => !p.local);
  const stageRemote = firstRemoteParticipant(participants);
  const presenter = sharingPresenter(participants);

  if (!roomUrl) return null;

  if (error) {
    return (
      <View
        style={[style, s.container, s.centre]}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        <Feather name="video-off" size={28} color={colors.destructive} />
        <Text style={s.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={[style, s.container]}>
      {joining ? (
        <View
          style={[StyleSheet.absoluteFill, s.centre]}
          accessibilityRole="progressbar"
          accessibilityLabel="Joining the video class"
        >
          <ActivityIndicator color={colors.onInverse} />
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
                <Feather name="monitor" size={11} color={colors.onInverse} />
                <Text style={s.presenterTagText}>
                  {presenter.local ? "You are sharing" : `${presenter.user_name || "Teacher"} is sharing`}
                </Text>
              </View>
            </View>
          ) : (
            <View style={s.stage}>
              {stageRemote ? (
                <DailyMediaView
                  videoTrack={trackOf(stageRemote, "video")}
                  audioTrack={trackOf(stageRemote, "audio")}
                  objectFit="cover"
                  style={s.stageVideo}
                />
              ) : (
                <View style={[StyleSheet.absoluteFill, s.centre]}>
                  <Feather name="users" size={26} color={colors.onInverseMuted} />
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
              accessibilityRole="button"
              accessibilityLabel="Close class chat"
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
                  accessibilityRole="button"
                  accessibilityLabel="Close class chat"
                  hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                  style={s.chatCloseBtn}
                  activeOpacity={0.7}
                >
                  <Feather name="x" size={20} color={colors.onInverse} />
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
                  placeholderTextColor={colors.onInverseMuted}
                  accessibilityLabel="Class chat message"
                  onSubmitEditing={submitChat}
                  returnKeyType="send"
                />
                <TouchableOpacity
                  style={s.chatSend}
                  onPress={submitChat}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Send class chat message"
                >
                  <Feather name="send" size={16} color={colors.primaryForeground} />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Controls — every one of these came free with Daily Prebuilt on web. */}
          <View style={s.bar}>
            <TouchableOpacity
              style={[s.btn, !micOn && s.btnOff]}
              onPress={toggleMic}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={microphoneActionLabel(micOn)}
            >
              <Feather name={micOn ? "mic" : "mic-off"} size={18} color={colors.onInverse} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btn, !camOn && s.btnOff]}
              onPress={toggleCam}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={cameraActionLabel(camOn)}
            >
              <Feather name={camOn ? "video" : "video-off"} size={18} color={colors.onInverse} />
            </TouchableOpacity>
            {onSendChat && (
              <TouchableOpacity
                style={[s.btn, chatOpen && s.btnActive]}
                onPress={() => setChatOpen((v) => !v)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={chatActionLabel(chatOpen, unseen)}
                accessibilityState={{ expanded: chatOpen }}
              >
                <Feather name="message-circle" size={18} color={colors.onInverse} />
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
                accessibilityRole="button"
                accessibilityLabel={screenShareActionLabel(screenShare)}
                accessibilityState={{ disabled: screenShare === "starting", selected: screenShare === "sharing" }}
              >
                {screenShare === "starting" ? (
                  <ActivityIndicator size="small" color={colors.onInverse} />
                ) : (
                  <Feather name="monitor" size={18} color={colors.onInverse} />
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.btn, s.btnLeave]}
              onPress={leave}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Leave video call"
            >
              <Feather name="phone-off" size={18} color={colors.destructive} />
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useColors>,
  t: ReturnType<typeof useLayout>["t"],
  space: ReturnType<typeof useLayout>["space"],
  radius: ReturnType<typeof useLayout>["radius"],
) {
  return StyleSheet.create({
    container: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", backgroundColor: colors.foreground },
    centre: { alignItems: "center", justifyContent: "center", gap: space.sm, paddingHorizontal: space.xl },
    hint: { ...t.caption, color: colors.onInverseMuted, textAlign: "center" },
    errorText: { ...t.caption, color: colors.onInverseMuted, textAlign: "center" },
    stage: { flex: 1, backgroundColor: colors.foreground, position: "relative" },
    stageVideo: { flex: 1, backgroundColor: colors.foreground },
    presenterTag: {
      position: "absolute", top: space.xs, left: space.xs, flexDirection: "row", alignItems: "center", gap: space.xxs,
      backgroundColor: colors.secondary, borderRadius: radius.pill, paddingHorizontal: space.xs, paddingVertical: space.xxs,
    },
    presenterTagText: { ...t.overline, color: colors.secondaryForeground },
    strip: { maxHeight: 78, flexGrow: 0 },
    stripInner: { gap: space.xs, paddingHorizontal: space.xs, paddingVertical: space.xs, alignItems: "center" },
    tile: { width: 92, height: 66, borderRadius: radius.xs, overflow: "hidden", backgroundColor: colors.secondary },
    tileVideo: { width: "100%", height: "100%" },
    tileName: {
      ...t.overline, position: "absolute", bottom: space.xxs, left: space.xxs, right: space.xxs, color: colors.onInverse,
      textShadowColor: colors.foreground, textShadowRadius: space.xxs,
    },
    bar: {
      flexDirection: "row", justifyContent: "center", alignItems: "center", gap: space.sm,
      paddingVertical: space.sm, backgroundColor: colors.foreground, borderTopWidth: 1, borderTopColor: colors.secondary,
    },
    btn: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, borderRadius: radius.pill, backgroundColor: colors.secondary, alignItems: "center", justifyContent: "center" },
    unreadDot: { position: "absolute", top: space.xxs, right: space.xxs, minWidth: space.md, height: space.md, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xxs },
    unreadDotText: { ...t.overline, color: colors.brandForeground },
    chatBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
    chatPanel: { maxHeight: 260, backgroundColor: colors.foreground, borderTopWidth: 1, borderTopColor: colors.secondary, zIndex: 21 },
    chatHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: colors.secondary },
    chatTitle: { ...t.caption, color: colors.onInverse },
    chatCloseBtn: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center" },
    chatScroll: { maxHeight: 190 },
    chatScrollInner: { padding: space.sm, gap: space.xs },
    chatEmpty: { ...t.caption, color: colors.onInverseMuted, textAlign: "center", paddingVertical: space.md },
    chatMsg: { alignSelf: "flex-start", maxWidth: "85%", backgroundColor: colors.secondary, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: space.xs },
    chatMsgMine: { alignSelf: "flex-end", backgroundColor: colors.primary },
    chatSender: { ...t.overline, color: colors.onInverseMuted, marginBottom: space.xxs },
    chatText: { ...t.caption, color: colors.onInverse },
    chatInputRow: { flexDirection: "row", alignItems: "center", gap: space.xs, padding: space.xs, borderTopWidth: 1, borderTopColor: colors.secondary },
    chatInput: { ...t.caption, flex: 1, backgroundColor: colors.secondary, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: space.xs, color: colors.onInverse },
    chatSend: { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
    btnOff: { backgroundColor: colors.destructive },
    btnActive: { backgroundColor: colors.success },
    btnLeave: { backgroundColor: colors.destructiveSoft, borderWidth: 1, borderColor: colors.destructive },
  });
}
