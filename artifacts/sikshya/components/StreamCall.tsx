import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import {
  callControls,
  callReducer,
  callStatusLine,
  initialCallState,
  nextReactionExpiryMs,
  type CallParticipant,
} from "@/utils/streamCallState";
import {
  incomingVideoFor,
  parseStreamRoom,
  visibleParticipants,
  type CallWindowState,
} from "@/utils/streamRoom";
import type { StreamBridgeSession } from "./stream/streamBridge";
import { loadStreamSdk } from "./stream/streamSdk";

/**
 * A Stream call inside Sikshya's own window.
 *
 * One file for both platforms. The only thing that differs between a browser and a phone is
 * which SDK would be loaded, and that split already happened one import down — `streamSdk.ts`
 * and `streamSdk.web.ts`. Everything visible here is this app's: the controls, the strip, the
 * status line, the participant sheet. Stream supplies pictures and call state and nothing else.
 *
 * That division is the point of the experiment rather than an accident of it. Daily Prebuilt
 * brought its own interface and this project spent real time taking parts of it back off —
 * its chat, its fullscreen button, its leave button, each one competing with a Sikshya control
 * that meant something slightly different. Starting from components instead of an iframe means
 * that argument never happens.
 *
 * The window states — hidden, compact, normal, full — belong to the classroom screens, which
 * drag and resize this component's container. **This never remounts when they do.** A remount
 * costs seconds of lesson and, on some phones, a fresh round of permission prompts. Resizing
 * changes what is *received* instead: see `incomingVideoFor`.
 */

export interface StreamCallProps {
  /** `stream:call/<type>/<id>?api_key=<key>` — from the server, with the room. */
  roomUrl: string;
  token?: string | null;
  /** The identity the token was minted for. Sending a different one fails to authenticate. */
  identity?: string | null;
  displayName: string;
  /** From the server's membership check. The only thing that decides teacher-only controls. */
  isOwner?: boolean;
  windowState?: CallWindowState;
  style?: StyleProp<ViewStyle>;
  onLeft?: () => void;
  /** Watch for one named person leaving — how a student learns the teacher has gone. */
  watchUserName?: string;
  onWatchedParticipantLeft?: () => void;
  canScreenShare?: boolean;
}

/** Enough reactions to be useful and few enough to fit one row of real tap targets on a phone. */
const REACTIONS = ["👍", "👏", "🎉", "❓"];

export default function StreamCall({
  roomUrl,
  token,
  identity,
  displayName,
  isOwner = false,
  windowState = "normal",
  style,
  onLeft,
  watchUserName,
  onWatchedParticipantLeft,
  canScreenShare = false,
}: StreamCallProps) {
  const colors = useColors();
  const { t, space, radius } = useLayout();

  const [state, dispatch] = useReducer(callReducer, undefined, initialCallState);
  const [sessionReady, setSessionReady] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [showReactions, setShowReactions] = useState(false);

  const sessionRef = useRef<StreamBridgeSession | null>(null);

  // Callbacks are read through a ref so a parent re-render never tears the call down and
  // rejoins it. The same guard the Daily paths carry, for the same reason.
  const cbRef = useRef({ onLeft, watchUserName, onWatchedParticipantLeft });
  cbRef.current = { onLeft, watchUserName, onWatchedParticipantLeft };

  /** Who was here last time, so one named person leaving can be noticed. */
  const seenNames = useRef<Set<string>>(new Set());

  const room = useMemo(() => parseStreamRoom(roomUrl), [roomUrl]);

  /**
   * Connect once, and only on the things that really identify the call.
   *
   * `windowState` is deliberately not in the dependencies — that is the whole "does not remount
   * when resized" requirement, and leaving it in would make hiding the window rejoin the class.
   */
  useEffect(() => {
    let cancelled = false;

    if (!room) {
      dispatch({
        type: "failed",
        error: "The video room address could not be read. Please rejoin the class.",
      });
      return;
    }
    if (!token) {
      // Unlike Daily, a Stream call cannot be joined without one. Saying so beats a black square.
      dispatch({ type: "failed", error: "No permission to join this call was issued." });
      return;
    }

    (async () => {
      const sdk = await loadStreamSdk();
      if (cancelled) return;

      if (!sdk.ok) {
        // The honest state this branch actually ships in. `reason` names what is missing and
        // points at STREAM.md; it never pretends the call is starting.
        dispatch({ type: "failed", error: sdk.reason });
        return;
      }

      try {
        const session = await sdk.connect({
          apiKey: room.apiKey,
          callType: room.callType,
          callId: room.callId,
          token,
          userId: String(identity ?? ""),
          userName: displayName,
          teacherName: watchUserName,
          events: {
            onJoined: () => !cancelled && dispatch({ type: "joined" }),
            onReconnecting: () => !cancelled && dispatch({ type: "reconnecting" }),
            onRejoined: () => !cancelled && dispatch({ type: "rejoined" }),
            onLeft: () => {
              if (cancelled) return;
              dispatch({ type: "left" });
              cbRef.current.onLeft?.();
            },
            onError: (message) => !cancelled && dispatch({ type: "failed", error: message }),
            onPermissionDenied: (device, message) =>
              !cancelled && dispatch({ type: "permission-denied", device, error: message }),
            onPermissionGranted: (device) =>
              !cancelled && dispatch({ type: "permission-granted", device }),
            onParticipants: (participants) => {
              if (cancelled) return;
              dispatch({ type: "participants", participants });
              noticeDepartures(participants, seenNames, cbRef);
            },
            onReaction: (reaction) =>
              !cancelled && dispatch({ type: "reaction", ...reaction, at: Date.now() }),
            onScreenShare: (phase) => !cancelled && dispatch({ type: "screen-share", phase }),
          },
        });

        if (cancelled) {
          // Joined after the classroom moved on. Leave rather than strand a call holding the
          // camera — the exact failure the web Daily path had to be fixed for.
          await session.leave().catch(() => {});
          return;
        }

        sessionRef.current = session;
        setSessionReady(true);
        session.setIncomingVideo(incomingVideoFor(windowState));
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: "failed",
            error: err instanceof Error ? err.message : "The class could not be joined.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      const session = sessionRef.current;
      sessionRef.current = null;
      setSessionReady(false);
      // Releases the camera and microphone. Without it the next join finds the hardware busy.
      session?.leave().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.apiKey, room?.callType, room?.callId, token, identity, displayName]);

  /**
   * Follow the window with what is received, not with a rejoin.
   *
   * Hidden means no video at all — the call keeps its audio, which is the lesson. Everything
   * else asks for roughly what the window can actually show. This is the one lever that
   * decides both the bill and the battery: Stream bills by received resolution.
   */
  useEffect(() => {
    if (!sessionReady) return;
    sessionRef.current?.setIncomingVideo(incomingVideoFor(windowState));
  }, [windowState, sessionReady]);

  /**
   * One timer, only while something is on screen.
   *
   * A reaction is a moment, not a status — five seconds and it stops being drawn. This is a
   * single `setTimeout` scheduled for the next thing that expires rather than an interval
   * ticking behind a call nobody is reacting in, and the arithmetic behind it is
   * `nextReactionExpiryMs`, which is tested with a pinned clock. It is cleared on every change
   * and on unmount, so a class that ends mid-reaction leaves nothing running.
   */
  useEffect(() => {
    const wait = nextReactionExpiryMs(state.reactions, Date.now());
    if (wait === null) return;
    const timer = setTimeout(() => dispatch({ type: "reactions-expired", now: Date.now() }), wait);
    return () => clearTimeout(timer);
  }, [state.reactions]);

  const controls = callControls({ state, isOwner, canScreenShare });
  const status = callStatusLine(state);

  const setMic = useCallback(
    (on: boolean) => {
      dispatch({ type: "mic", on });
      sessionRef.current?.setMicrophone(on).catch(() => dispatch({ type: "mic", on: !on }));
    },
    [dispatch],
  );

  const setCam = useCallback(
    (on: boolean) => {
      dispatch({ type: "camera", on });
      sessionRef.current?.setCamera(on).catch(() => dispatch({ type: "camera", on: !on }));
    },
    [dispatch],
  );

  const toggleHand = useCallback(() => {
    const raised = !state.handRaised;
    dispatch({ type: "hand", raised });
    sessionRef.current?.raiseHand(raised).catch(() => dispatch({ type: "hand", raised: !raised }));
  }, [state.handRaised]);

  const toggleScreenShare = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (state.screenShare === "sharing") {
      dispatch({ type: "screen-share", phase: "idle" });
      session.stopScreenShare().catch(() => {});
      return;
    }
    // The OS now shows its own capture consent prompt. "starting" holds until the provider
    // reports back, so the button cannot be double-fired while that dialog is up.
    dispatch({ type: "screen-share", phase: "starting" });
    session.startScreenShare().catch(() => dispatch({ type: "screen-share", phase: "idle" }));
  }, [state.screenShare]);

  const leave = useCallback(() => {
    const session = sessionRef.current;
    if (!session) {
      cbRef.current.onLeft?.();
      return;
    }
    session.leave().catch(() => cbRef.current.onLeft?.());
  }, []);

  const presenter = state.participants.find((p) => p.sharingScreen);
  const shown = visibleParticipants(state.participants, windowState);
  const VideoView = sessionRef.current?.VideoView;
  const hiddenCount = Math.max(0, state.participants.length - shown.length);

  const s = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.secondary, overflow: "hidden" },
        centre: {
          alignItems: "center",
          justifyContent: "center",
          gap: space.sm,
          paddingHorizontal: space.xl,
        },
        stage: { flex: 1, backgroundColor: colors.secondary },
        tag: {
          position: "absolute",
          top: space.xs,
          left: space.xs,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xxs,
          backgroundColor: colors.secondary,
          borderRadius: radius.pill,
          paddingHorizontal: space.xs,
          paddingVertical: space.xxs,
        },
        strip: { maxHeight: HIT_SLOP_MIN + space.xxl, flexGrow: 0 },
        stripInner: {
          gap: space.xxs,
          paddingHorizontal: space.xs,
          paddingVertical: space.xxs,
          alignItems: "center",
        },
        tile: {
          width: HIT_SLOP_MIN * 2,
          height: HIT_SLOP_MIN + space.lg,
          borderRadius: radius.xs,
          overflow: "hidden",
          backgroundColor: colors.surfaceSunk,
          justifyContent: "flex-end",
        },
        tileName: { paddingHorizontal: space.xxs, paddingBottom: space.xxs },
        bar: {
          flexDirection: "row",
          justifyContent: "center",
          alignItems: "center",
          gap: space.xs,
          paddingVertical: space.xs,
          backgroundColor: colors.secondary,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.lineStrong,
          flexWrap: "wrap",
        },
        btn: {
          width: HIT_SLOP_MIN,
          height: HIT_SLOP_MIN,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.surfaceSunk,
        },
        btnOn: { backgroundColor: colors.actionSoft },
        btnLeave: { backgroundColor: colors.destructiveSoft },
        sheet: {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: "70%",
          backgroundColor: colors.card,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
        },
        sheetRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          paddingHorizontal: space.md,
          minHeight: HIT_SLOP_MIN,
        },
        sheetAction: {
          minWidth: HIT_SLOP_MIN,
          height: HIT_SLOP_MIN,
          alignItems: "center",
          justifyContent: "center",
        },
        reactionRow: {
          flexDirection: "row",
          justifyContent: "center",
          gap: space.xs,
          paddingVertical: space.xs,
          backgroundColor: colors.card,
        },
        reactionBtn: {
          width: HIT_SLOP_MIN,
          height: HIT_SLOP_MIN,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceSunk,
        },
        /**
         * Where a reaction somebody else sent appears.
         *
         * Above the control bar and below the drag handle, so it covers video rather than
         * anything anybody has to press — and `pointerEvents="none"` so a chip can never take a
         * tap meant for the button behind it.
         */
        incoming: {
          position: "absolute",
          left: space.xs,
          right: space.xs,
          bottom: HIT_SLOP_MIN + space.md,
          flexDirection: "row",
          flexWrap: "wrap",
          gap: space.xxs,
        },
        incomingChip: {
          flexDirection: "row",
          alignItems: "center",
          gap: space.xxs,
          maxWidth: "100%",
          borderRadius: radius.pill,
          paddingHorizontal: space.xs,
          paddingVertical: space.xxs,
          backgroundColor: colors.secondary,
        },
      }),
    [colors, space, radius],
  );

  /**
   * The state this branch ships in, and it says so plainly.
   *
   * No SDK is installed — see `stream/streamSdk.ts` — so rather than a black rectangle or a row
   * of buttons that do nothing, the reason is on the screen with a way out of the call. This is
   * the same rule payments and email already follow here: when something is not configured, the
   * app says which thing.
   */
  if (state.phase === "failed") {
    return (
      <View style={[style, s.container, s.centre]} testID="stream-call-unavailable">
        <Feather name="video-off" size={space.xl} color={colors.onInverseMuted} />
        <Text style={[t.callout, { color: colors.onInverse, textAlign: "center" }]}>
          {state.error}
        </Text>
        <TouchableOpacity
          onPress={leave}
          style={[s.btn, s.btnLeave]}
          accessibilityLabel="Leave call"
          testID="stream-leave"
        >
          <Feather name="phone-off" size={space.lg} color={colors.destructive} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[style, s.container]} testID="stream-call">
      <View style={s.stage}>
        {presenter && VideoView ? (
          <>
            <VideoView
              sessionId={presenter.sessionId}
              kind="screen"
              style={StyleSheet.absoluteFill}
            />
            <View style={s.tag}>
              <Feather name="monitor" size={space.sm} color={colors.onInverse} />
              <Text style={[t.caption, { color: colors.onInverse }]}>
                {presenter.isLocal ? "You are sharing" : `${presenter.name} is sharing`}
              </Text>
            </View>
          </>
        ) : shown.length > 0 && VideoView ? (
          <VideoView
            sessionId={(shown.find((p) => !p.isLocal) ?? shown[0]).sessionId}
            kind="camera"
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, s.centre]}>
            {state.phase === "connecting" ? (
              <ActivityIndicator color={colors.onInverse} />
            ) : (
              <Feather name="users" size={space.lg} color={colors.onInverseMuted} />
            )}
            <Text style={[t.caption, { color: colors.onInverseMuted, textAlign: "center" }]}>
              {status ?? "Waiting for others to join…"}
            </Text>
          </View>
        )}

        {status && shown.length > 0 ? (
          <View style={[s.tag, { top: undefined, bottom: space.xs }]}>
            <Text style={[t.caption, { color: colors.onInverse }]}>{status}</Text>
          </View>
        ) : null}
      </View>

      {/* Bounded on purpose. Forty-five decoded videos is a phone that gets hot and drops the
          call, not a layout that needs scrolling — see VISIBLE_PARTICIPANT_CAP. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.strip}
        contentContainerStyle={s.stripInner}
      >
        {shown.map((p) => (
          // A tile is one connection, so it is keyed and drawn by session id. Somebody signed
          // in on a laptop and a phone at once really is two tiles.
          <View key={p.sessionId} style={s.tile}>
            {VideoView && p.camOn ? (
              <VideoView
                sessionId={p.sessionId}
                kind="camera"
                mirror={p.isLocal}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <View style={s.tileName}>
              <Text style={[t.caption, { color: colors.onInverse }]} numberOfLines={1}>
                {p.isLocal ? "You" : p.name}
                {p.handRaised ? " ✋" : ""}
                {p.micOn ? "" : " 🔇"}
              </Text>
            </View>
          </View>
        ))}
        {hiddenCount > 0 ? (
          <Text style={[t.caption, { color: colors.onInverseMuted }]}>
            +{hiddenCount} more listening
          </Text>
        ) : null}
      </ScrollView>

      {/*
        Reactions other people sent.

        They were being collected into state and never drawn, which made "reactions" a capability
        the app claimed and did not have. This is deliberately the cheapest thing that is real: no
        animation, no timers, at most three chips, one per person — somebody's newer reaction
        replaces their own older one — and a name beside each emoji so a class of forty-five knows
        who said it. They stay until replaced rather than fading, which on a budget Android is a
        feature: a fade is a frame budget nobody here has spare.
      */}
      {state.reactions.length > 0 ? (
        <View style={s.incoming} pointerEvents="none" testID="stream-incoming-reactions">
          {state.reactions.map((r) => (
            <View key={r.userId} style={s.incomingChip}>
              <Text style={t.callout}>{r.emoji}</Text>
              <Text
                style={[t.caption, { color: colors.onInverse, flexShrink: 1 }]}
                numberOfLines={1}
              >
                {r.name}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {showReactions && controls.reactions ? (
        <View style={s.reactionRow} testID="stream-reactions">
          {REACTIONS.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              style={s.reactionBtn}
              accessibilityLabel={`Send ${emoji}`}
              onPress={() => {
                setShowReactions(false);
                sessionRef.current?.sendReaction(emoji).catch(() => {});
              }}
            >
              <Text style={t.title3}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {showPeople ? (
        <View style={s.sheet} testID="stream-people">
          <ScrollView>
            {state.participants.map((p) => (
              <PersonRow
                key={p.sessionId}
                person={p}
                canModerate={controls.moderate && !p.isLocal}
                styles={s}
                // Both by **user** id. Stream's muteUser and kickUser match a person, not a
                // connection, and a session id passed here matches nobody and says nothing.
                onMute={() => sessionRef.current?.muteParticipant(p.userId).catch(() => {})}
                onRemove={() => sessionRef.current?.removeParticipant(p.userId).catch(() => {})}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={s.bar}>
        <ControlButton
          icon={state.micOn ? "mic" : "mic-off"}
          label={state.micOn ? "Mute microphone" : "Unmute microphone"}
          enabled={controls.mic}
          active={state.micOn}
          onPress={() => setMic(!state.micOn)}
          styles={s}
          testID="stream-mic"
        />
        <ControlButton
          icon={state.camOn ? "video" : "video-off"}
          label={state.camOn ? "Turn camera off" : "Turn camera on"}
          enabled={controls.camera}
          active={state.camOn}
          onPress={() => setCam(!state.camOn)}
          styles={s}
          testID="stream-camera"
        />
        <ControlButton
          // Feather has no hand. "chevrons-up" reads as raising something and, unlike a generic
          // bell or flag, does not also mean "notification" somewhere else in this app.
          icon="chevrons-up"
          label={state.handRaised ? "Lower hand" : "Raise hand"}
          enabled={controls.hand}
          active={state.handRaised}
          onPress={toggleHand}
          styles={s}
          testID="stream-hand"
        />
        <ControlButton
          icon="smile"
          label="Send a reaction"
          enabled={controls.reactions}
          active={showReactions}
          onPress={() => setShowReactions((v) => !v)}
          styles={s}
          testID="stream-reaction-toggle"
        />
        <ControlButton
          icon="users"
          label="Who is here"
          enabled={controls.participants}
          active={showPeople}
          onPress={() => setShowPeople((v) => !v)}
          styles={s}
          testID="stream-people-toggle"
        />
        {/* Drawn only for the teacher, and only where the provider can actually do it. A
            control that does nothing is the class of thing this project has removed before. */}
        {controls.screenShare ? (
          <ControlButton
            icon="monitor"
            label={state.screenShare === "sharing" ? "Stop sharing" : "Share screen"}
            enabled={state.screenShare !== "starting"}
            active={state.screenShare === "sharing"}
            onPress={toggleScreenShare}
            styles={s}
            testID="stream-screenshare"
          />
        ) : null}
        {/*
          There is no "end the class for everyone" here, for the teacher or for anybody.

          It was here, and it called the provider's `endCall()` and nothing else — so the video
          stopped while Sikshya went on believing the lesson was running: no completed status, no
          cancelled reminder, no closed attendance, and none of the confirmation the teacher's own
          End Session button asks for. The classroom HUD owns ending a class; clearing the room
          unmounts this component, which leaves the call. The provider's media stops as part of
          that lifecycle rather than starting a competing one.
        */}
        <ControlButton
          icon="phone-off"
          label="Leave call"
          enabled={controls.leave}
          active={false}
          onPress={leave}
          styles={s}
          leave
          testID="stream-leave"
        />
      </View>
    </View>
  );
}

/**
 * One named person leaving, noticed.
 *
 * The classroom uses this to tell a student their teacher has gone. Stream reports the whole
 * participant list rather than a departure event, so the departure is the difference between
 * two lists — which is also more robust: a list that arrives after a reconnect still gives the
 * right answer, where a missed event would not.
 */
function noticeDepartures(
  participants: CallParticipant[],
  seen: React.MutableRefObject<Set<string>>,
  cbRef: React.MutableRefObject<{
    watchUserName?: string;
    onWatchedParticipantLeft?: () => void;
  }>,
) {
  const names = new Set(participants.map((p) => p.name));
  const watched = cbRef.current.watchUserName;
  if (watched && seen.current.has(watched) && !names.has(watched)) {
    cbRef.current.onWatchedParticipantLeft?.();
  }
  seen.current = names;
}

function ControlButton({
  icon,
  label,
  enabled,
  active,
  onPress,
  styles,
  leave,
  testID,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  enabled: boolean;
  active: boolean;
  onPress: () => void;
  styles: ReturnType<typeof StyleSheet.create> & Record<string, ViewStyle>;
  leave?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  const { space } = useLayout();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled, selected: active }}
      testID={testID}
      // Every control is a full tap target. People miss below 44, and miss more on a bumpy bus.
      style={[styles.btn, active && styles.btnOn, leave && styles.btnLeave, !enabled && { opacity: 0.4 }]}
    >
      <Feather
        name={icon}
        size={space.lg}
        color={leave ? colors.destructive : active ? colors.primary : colors.onInverse}
      />
    </TouchableOpacity>
  );
}

function PersonRow({
  person,
  canModerate,
  styles,
  onMute,
  onRemove,
}: {
  person: CallParticipant;
  canModerate: boolean;
  styles: ReturnType<typeof StyleSheet.create> & Record<string, ViewStyle>;
  onMute: () => void;
  onRemove: () => void;
}) {
  const colors = useColors();
  const { t, space } = useLayout();
  return (
    <View style={styles.sheetRow}>
      <Text style={[t.body, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>
        {person.isLocal ? "You" : person.name}
        {person.isTeacher ? " · teacher" : ""}
      </Text>
      {person.handRaised ? (
        <Text style={t.body} accessibilityLabel="Hand raised">
          ✋
        </Text>
      ) : null}
      <Feather
        name={person.micOn ? "mic" : "mic-off"}
        size={space.md}
        color={person.micOn ? colors.online : colors.inkFaint}
      />
      {canModerate ? (
        <>
          <TouchableOpacity
            style={styles.sheetAction}
            onPress={onMute}
            accessibilityLabel={`Mute ${person.name}`}
          >
            <Feather name="mic-off" size={space.md} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sheetAction}
            onPress={onRemove}
            accessibilityLabel={`Remove ${person.name} from the class`}
          >
            <Feather name="user-x" size={space.md} color={colors.destructive} />
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  );
}
