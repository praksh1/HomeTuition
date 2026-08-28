import { Feather } from "@expo/vector-icons";
import * as ScreenOrientation from "expo-screen-orientation";
import { router, useLocalSearchParams } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import type { Student } from "@/context/AuthContext";
import { ApiError, apiGet } from "@/utils/api";
import { useClassroomSocket } from "@/hooks/useClassroomSocket";
import VideoCall from "@/components/VideoCall";
import SmartBoard from "@/components/SmartBoard";
import { useCallTimeLimit } from "@/hooks/useCallTimeLimit";
import { useAloneInCall } from "@/hooks/useAloneInCall";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { HIT_SLOP_MIN } from "@/constants/layout";
import { aloneMessage } from "@/utils/aloneInCall";

type Mode = "board" | "chat";

interface SessionData {
  id: number;
  topic: string;
  subject: string;
  teacherName: string;
  duration: number;
  maxStudents: number;
  enrolledCount: number;
  status: string;
  /** The booked start. The whole call clock is measured from this and the duration. */
  date: string;
}

type NoticeTone = "warning" | "destructive";

interface FloatingNoticeProps {
  tone: NoticeTone;
  icon: keyof typeof Feather.glyphMap;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
}

/** Mirrors the verified teacher notice: transform-only, above the board, never in its flow. */
function FloatingNotice({
  tone,
  icon,
  text,
  actionLabel,
  onAction,
  onClose,
}: FloatingNoticeProps) {
  const colors = useColors();
  const { t, space, radius, elevation } = useLayout();
  const entrance = useRef(new Animated.Value(-space.huge)).current;
  const toneColor = tone === "destructive" ? colors.destructive : colors.warn;
  const toneFill =
    tone === "destructive" ? colors.destructiveSoft : colors.warnSoft;

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  return (
    <Animated.View
      pointerEvents="auto"
      style={[
        s.noticeCard,
        elevation.sheet,
        {
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.md,
          backgroundColor: toneFill,
          borderColor: toneColor,
          transform: [{ translateY: entrance }],
        },
      ]}
    >
      <Feather name={icon} size={18} color={toneColor} />
      <Text style={[t.callout, s.noticeText, { color: colors.foreground }]}>
        {text}
      </Text>
      {actionLabel && onAction ? (
        <TouchableOpacity
          style={[
            s.noticeAction,
            {
              minHeight: HIT_SLOP_MIN,
              paddingHorizontal: space.sm,
              borderRadius: radius.sm,
              borderColor: toneColor,
            },
          ]}
          onPress={onAction}
          activeOpacity={0.75}
        >
          <Text style={[t.caption, { color: toneColor }]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
      {onClose ? (
        <TouchableOpacity
          style={[s.noticeClose, { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN }]}
          onPress={onClose}
          activeOpacity={0.7}
          accessibilityLabel="Dismiss notice"
        >
          <Feather name="x" size={18} color={toneColor} />
        </TouchableOpacity>
      ) : null}
    </Animated.View>
  );
}

export default function StudentClassroom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const { t, numeric, width, height, isCompact, space, radius, elevation } =
    useLayout();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const student = user as Student;
  if (!student || student.role !== "student") return null;

  const studentName = student.name ?? "Student";

  const {
    connected,
    accessDenied,
    presenceCount,
    messages,
    sessionStatus,
    sendChat,
    sceneUpdates,
    consumeSceneUpdates,
    boardClearedAt,
    boardView,
  } = useClassroomSocket({
    sessionId: id ?? "",
    name: studentName,
    role: "student",
  });

  const [session, setSession] = useState<SessionData | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [chatMsg, setChatMsg] = useState("");
  const [mode, setMode] = useState<Mode>("board");
  /** The board taking the whole pane. The call is hidden, never unmounted — see the video pane. */
  const [boardExpanded, setBoardExpanded] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [meetingToken, setMeetingToken] = useState<string | null>(null);
  /** Which implementation carries this call. The server decides; the app just mounts it. */
  const [videoProvider, setVideoProvider] = useState<string>("daily");
  const [roomError, setRoomError] = useState(false);
  /** Set when the server refuses a room because the class is over. */
  const [roomExpired, setRoomExpired] = useState<string | null>(null);
  /**
   * Set the moment this student leaves.
   *
   * Leaving calls `router.back()`, but a navigation stack often keeps the screen mounted — so
   * the classroom socket stayed connected and, when the teacher later ended the class, this
   * screen popped up "The teacher has ended this session" over whatever the student was doing,
   * sometimes many minutes after they had gone.
   */
  const hasLeft = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const chatProgress = useRef(new Animated.Value(0)).current;
  const pipDrag = useRef(new Animated.ValueXY()).current;
  const pipOffset = useRef({ x: 0, y: 0 });

  // Large enough to keep the provider's real native controls usable on a budget phone.
  const pipWidth = Math.min(width - space.xxl, space.huge * 7);
  const pipHeight = isCompact ? space.huge * 4 : space.huge * 5;
  const pipTop = insets.top + space.huge + space.sm;
  const pipBaseLeft = Math.max(space.md, width - pipWidth - space.md);

  const pipPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > space.xxs || Math.abs(gesture.dy) > space.xxs,
        onPanResponderGrant: () => {
          pipDrag.setOffset(pipOffset.current);
          pipDrag.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: Animated.event(
          [null, { dx: pipDrag.x, dy: pipDrag.y }],
          {
            useNativeDriver: false,
          },
        ),
        onPanResponderRelease: (_, gesture) => {
          const next = {
            x: Math.max(
              space.md - pipBaseLeft,
              Math.min(
                pipOffset.current.x + gesture.dx,
                width - pipWidth - space.md - pipBaseLeft,
              ),
            ),
            y: Math.max(
              0,
              Math.min(
                pipOffset.current.y + gesture.dy,
                height - pipTop - pipHeight - space.xxxl - HIT_SLOP_MIN,
              ),
            ),
          };
          pipDrag.flattenOffset();
          pipDrag.setValue(next);
          pipOffset.current = next;
        },
        onPanResponderTerminate: (_, gesture) => {
          pipDrag.flattenOffset();
          const next = {
            x: Math.max(
              space.md - pipBaseLeft,
              Math.min(
                pipOffset.current.x + gesture.dx,
                width - pipWidth - space.md - pipBaseLeft,
              ),
            ),
            y: Math.max(
              0,
              Math.min(
                pipOffset.current.y + gesture.dy,
                height - pipTop - pipHeight - space.xxxl - HIT_SLOP_MIN,
              ),
            ),
          };
          pipDrag.setValue(next);
          pipOffset.current = next;
        },
      }),
    [
      height,
      pipBaseLeft,
      pipDrag,
      pipHeight,
      pipTop,
      pipWidth,
      space.md,
      space.xxxl,
      space.xxs,
      width,
    ],
  );

  useEffect(() => {
    const next = {
      x: Math.max(
        space.md - pipBaseLeft,
        Math.min(
          pipOffset.current.x,
          width - pipWidth - space.md - pipBaseLeft,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          pipOffset.current.y,
          height - pipTop - pipHeight - space.xxxl - HIT_SLOP_MIN,
        ),
      ),
    };
    pipOffset.current = next;
    pipDrag.setOffset({ x: 0, y: 0 });
    pipDrag.setValue(next);
  }, [
    height,
    pipBaseLeft,
    pipDrag,
    pipHeight,
    pipTop,
    pipWidth,
    space.md,
    space.xxxl,
    width,
  ]);

  useEffect(() => {
    Animated.timing(chatProgress, {
      toValue: mode === "chat" ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [chatProgress, mode]);

  /**
   * Get out of this screen, whatever route brought us here.
   *
   * `router.back()` alone was not enough: a student who reached the classroom from a link, a
   * notification, or a monthly class's own page has nothing behind them on the stack, so Leave
   * did nothing at all and they were stuck in the call. The owner hit exactly that — "several
   * attempts, a student could not end a live session call".
   */
  const leaveNow = useCallback(() => {
    hasLeft.current = true;
    setRoomUrl(null);
    setMeetingToken(null); // release camera/mic before navigating away
    if (router.canGoBack()) router.back();
    else router.replace("/(student)/sessions");
  }, []);

  useEffect(() => {
    loadSession();
    loadRoom();
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => {});
    };
  }, [id]);

  const loadSession = async () => {
    try {
      setSession(await apiGet<SessionData>(`/sessions/${id}`));
    } catch {}
  };

  // Daily.co rooms must be created server-side via their REST API before anyone can
  // join them — this also covers the case where a student joins before the teacher's
  // own "start session" call has run, since the room is created idempotently either way.
  const loadRoom = async () => {
    try {
      const {
        roomUrl: url,
        token,
        provider,
      } = await apiGet<{
        roomUrl: string;
        token?: string | null;
        provider?: string;
      }>(`/sessions/${id}/room`);
      if (provider) setVideoProvider(provider);
      setRoomUrl(url);
      setMeetingToken(token ?? null);
      setRoomError(false);
    } catch (err) {
      // A class that is over is refused by the server rather than given a room. Say that,
      // instead of "couldn't set up the video room", which sounds like a fault to retry.
      if (err instanceof ApiError && err.status === 409) {
        setRoomExpired(err.message || "This class has finished.");
        return;
      }
      setRoomError(true);
    }
  };

  /**
   * The class has been marked over — which is not the same as everybody having to go.
   *
   * This used to eject the student the instant the status changed: an alert, then out. The
   * owner asked for the opposite, and they are right about why. **A teacher can press End by
   * accident, and this app already lets them walk straight back in** — that is the whole point
   * of the three-hour window in the teacher's classroom. Throwing thirty students out a second
   * later destroys the recovery path the app already has.
   *
   * So an ended class is treated as exactly what it looks like from a student's chair: the
   * teacher is not here. Same five quiet minutes, same ten with a way out, same automatic
   * close at fifteen — and if the teacher comes back the status returns to live, this goes
   * false, and the countdown disappears without anybody having been told anything.
   *
   * The room is deliberately *not* torn down here. Keeping it is what lets the video simply
   * resume when they return.
   */
  const classEnded =
    sessionStatus === "completed" || sessionStatus === "cancelled";

  /**
   * The class is open to this student but the teacher has not pressed start.
   *
   * Students are let in up to five minutes early so the room is populated when the lesson
   * begins; without a clear signal that everyone is simply waiting, an empty call looks like a
   * broken one. `sessionStatus` arrives over the socket the moment the teacher starts, so this
   * clears itself with no polling.
   */
  const liveStatus = sessionStatus ?? session?.status ?? null;
  const classIsLive = liveStatus === "live";
  const waitingForTeacher =
    !!liveStatus &&
    liveStatus !== "live" &&
    liveStatus !== "completed" &&
    liveStatus !== "cancelled";

  const fmt = (s: number) =>
    `${Math.floor(s / 60)
      .toString()
      .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const toggleLandscape = async () => {
    try {
      if (isLandscape) {
        await ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.PORTRAIT_UP,
        );
      } else {
        await ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.LANDSCAPE,
        );
      }
      setIsLandscape((v) => !v);
    } catch {}
  };

  const sendMessage = () => {
    if (!chatMsg.trim()) return;
    sendChat(chatMsg.trim());
    setChatMsg("");
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  // Called when the student clicks Daily's native Leave button — no confirmation needed
  // since the user already made an explicit in-call gesture. Redirect instantly.
  const handleDailyLeft = useCallback(() => {
    leaveNow();
  }, [leaveNow]);

  /**
   * The same clock the teacher's screen runs on.
   *
   * Five minutes before the booked finish everybody is told; ten minutes past it the call
   * ends. Both screens read utils/sessionWindow.ts, because a call that stopped for one person
   * and not the other would be worse than no limit at all.
   */
  const timeLimit = useCallTimeLimit({
    session: session
      ? {
          date: session.date,
          duration: session.duration,
          status: session.status,
          startedAt: null,
          endedAt: null,
        }
      : null,
    active: !!roomUrl,
    onCutoff: handleDailyLeft,
  });

  const leaveSession = () => {
    const doLeave = leaveNow;
    if (Platform.OS === "web") {
      if (window.confirm("Leave Session?\n\nAre you sure?")) doLeave();
    } else {
      Alert.alert("Leave Session", "Are you sure you want to leave?", [
        { text: "Stay", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: doLeave },
      ]);
    }
  };

  // Presence starts at 0 the instant the server clears stale entries on session start;
  // don't fall back to enrolledCount before the socket connects, or a ghost count/avatar
  // shows up for a class nobody has actually joined yet.
  const livePresenceCount = connected ? presenceCount : 0;

  /** Students never author anything, so outgoing changes are dropped. */
  const noopSceneChange = useCallback(() => {}, []);

  /**
   * The teacher's video went away. That is not the same as the teacher ending the class.
   *
   * This used to throw up "Teacher Disconnected — they may rejoin shortly" the instant it
   * happened. When the teacher pressed End, both things happened at once, so the student got
   * that dialog, pressed OK, and was immediately thrown out by the *other* alert with "the
   * teacher has ended this session" — two contradictory messages for one event, which is what
   * the owner reported.
   *
   * Nothing is said now. The clock below waits five quiet minutes first, because a connection
   * that drops usually comes back, and `endedRef` keeps this quiet altogether when the class
   * is genuinely over.
   */
  const teacherGoneRef = useRef(false);
  const [teacherGone, setTeacherGone] = useState(false);
  const notifyTeacherLeft = useCallback(() => {
    teacherGoneRef.current = true;
    setTeacherGone(true);
  }, []);

  /**
   * Waiting for a teacher who is not here: five quiet minutes, then ten with a way out.
   *
   * Ends the call at fifteen. Both of them can come straight back from the Sessions tab, and
   * the fifteen minutes start again when they do — see utils/aloneInCall.ts.
   */
  const alone = useAloneInCall({
    /*
     * Two ways the teacher can be absent and one answer to both: their video dropped, or they
     * pressed End. A student cannot tell those apart and should not have to — a teacher whose
     * phone died looks exactly like a teacher who hung up.
     */
    alone: teacherGone || classEnded,
    active: !!roomUrl && !roomExpired,
    onCutoff: () => {
      leaveNow();
    },
  });

  return (
    <KeyboardAvoidingView
      style={[s.container, { backgroundColor: colors.card }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={s.container}>
        {/* Session context floats without becoming a touch-blocking header. */}
        <View pointerEvents="box-none" style={s.headerLayer}>
          <View
            pointerEvents="none"
            style={[
              s.sessionPill,
              elevation.card,
              {
                top: insets.top + space.xs,
                left: space.md,
                right: space.md,
                gap: space.sm,
                paddingHorizontal: space.md,
                paddingVertical: space.xs,
                borderRadius: radius.pill,
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={s.sessionInfo}>
              <Text
                style={[t.caption, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {session?.topic ?? "Live session"}
              </Text>
              <Text
                style={[t.overline, numeric, { color: colors.mutedForeground }]}
              >
                {session?.teacherName ?? "Teacher"} ·{" "}
                {session?.subject ?? "Class"} · {fmt(elapsed)}
              </Text>
            </View>
            {classIsLive ? (
              <View
                style={[
                  s.liveTag,
                  {
                    gap: space.xxs,
                    paddingHorizontal: space.xs,
                    paddingVertical: space.xxs,
                    borderRadius: radius.pill,
                    backgroundColor: colors.brandSoft,
                  },
                ]}
              >
                <View style={[s.liveDot, { backgroundColor: colors.brand }]} />
                <Text style={[t.overline, { color: colors.brand }]}>LIVE</Text>
              </View>
            ) : null}
          </View>
        </View>

        {livePresenceCount > 0 ? (
          <View
            pointerEvents="none"
            style={[
              s.presence,
              elevation.card,
              {
                top: pipTop,
                left: space.md,
                gap: space.xs,
                paddingHorizontal: space.sm,
                paddingVertical: space.xs,
                borderRadius: radius.pill,
                backgroundColor: colors.successSoft,
                borderColor: colors.success,
              },
            ]}
          >
            <View style={[s.presenceDot, { backgroundColor: colors.online }]} />
            <Text style={[t.caption, numeric, { color: colors.success }]}>
              {livePresenceCount} in session
            </Text>
          </View>
        ) : null}

        <View
          pointerEvents="box-none"
          style={[
            s.noticeLayer,
            {
              top: insets.top + space.huge + space.md,
              left: space.md,
              right: space.md,
              gap: space.xs,
            },
          ]}
        >
          {waitingForTeacher ? (
            <FloatingNotice
              tone="warning"
              icon="clock"
              text="Awaiting your teacher. You're already in the room, and the class will begin automatically."
            />
          ) : null}

          {accessDenied ? (
            <FloatingNotice
              tone="destructive"
              icon="lock"
              text="You're not enrolled in this class, so the whiteboard and chat are unavailable. Enrol from the session page to join."
            />
          ) : null}

          {timeLimit.overtime ? (
            <FloatingNotice
              tone="destructive"
              icon="alert-octagon"
              text="This class has run past its finish time. The call is ending now."
            />
          ) : timeLimit.showWarning ? (
            <FloatingNotice
              tone="warning"
              icon="clock"
              text={`${timeLimit.minutesLeft} minute${timeLimit.minutesLeft === 1 ? "" : "s"} left in this class.`}
              onClose={timeLimit.dismissWarning}
            />
          ) : null}

          {alone.phase === "warned" ? (
            <FloatingNotice
              tone="warning"
              icon="user-x"
              text={aloneMessage("teacher", alone.minutesLeft)}
              actionLabel="Leave"
              onAction={leaveNow}
            />
          ) : null}
        </View>

        {/* Only this visible capsule captures touches; its carrier stays transparent. */}
        <View
          pointerEvents="box-none"
          style={[s.hudLayer, { bottom: insets.bottom + space.sm }]}
        >
          <View
            pointerEvents="auto"
            style={[
              s.hud,
              elevation.sheet,
              {
                gap: space.xxs,
                padding: space.xs,
                borderRadius: radius.pill,
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <TouchableOpacity
              style={[
                s.hudButton,
                {
                  width: HIT_SLOP_MIN,
                  height: HIT_SLOP_MIN,
                  borderRadius: radius.pill,
                  backgroundColor:
                    mode === "board" ? colors.actionSoft : colors.card,
                },
              ]}
              onPress={() => setMode("board")}
              activeOpacity={0.75}
              accessibilityLabel="View class materials"
            >
              <Feather
                name="book-open"
                size={18}
                color={
                  mode === "board" ? colors.primary : colors.mutedForeground
                }
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                s.hudButton,
                {
                  width: HIT_SLOP_MIN,
                  height: HIT_SLOP_MIN,
                  borderRadius: radius.pill,
                  backgroundColor: boardExpanded
                    ? colors.muted
                    : colors.actionSoft,
                },
              ]}
              onPress={() => setBoardExpanded((hidden) => !hidden)}
              activeOpacity={0.75}
              accessibilityLabel={
                boardExpanded ? "Show teacher video" : "Hide teacher video"
              }
              testID="video-size-btn"
            >
              <Feather
                name={boardExpanded ? "video-off" : "video"}
                size={18}
                color={boardExpanded ? colors.mutedForeground : colors.primary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                s.hudButton,
                {
                  width: HIT_SLOP_MIN,
                  height: HIT_SLOP_MIN,
                  borderRadius: radius.pill,
                  backgroundColor:
                    mode === "chat" ? colors.actionSoft : colors.card,
                },
              ]}
              onPress={() =>
                setMode((current) => (current === "chat" ? "board" : "chat"))
              }
              activeOpacity={0.75}
              accessibilityLabel={
                mode === "chat" ? "Close class chat" : "Open class chat"
              }
            >
              <Feather
                name="message-circle"
                size={18}
                color={
                  mode === "chat" ? colors.primary : colors.mutedForeground
                }
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                s.hudButton,
                {
                  width: HIT_SLOP_MIN,
                  height: HIT_SLOP_MIN,
                  borderRadius: radius.pill,
                  backgroundColor: colors.card,
                },
              ]}
              onPress={toggleLandscape}
              activeOpacity={0.75}
              accessibilityLabel={
                isLandscape ? "Leave full screen" : "Full screen"
              }
            >
              <Feather
                name={isLandscape ? "minimize-2" : "maximize-2"}
                size={18}
                color={colors.mutedForeground}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                s.hudButton,
                {
                  width: HIT_SLOP_MIN,
                  height: HIT_SLOP_MIN,
                  borderRadius: radius.pill,
                  backgroundColor: colors.card,
                  borderColor: colors.destructive,
                  borderWidth: 1,
                },
              ]}
              onPress={leaveSession}
              activeOpacity={0.75}
              accessibilityLabel="Leave session"
            >
              <Feather name="log-out" size={18} color={colors.destructive} />
            </TouchableOpacity>
          </View>
        </View>

        {/* The board owns the stage; the teacher's feed stays mounted in a draggable PIP. */}
        <View style={s.contentArea}>
          <Animated.View
            pointerEvents={boardExpanded || mode === "chat" ? "none" : "auto"}
            style={[
              s.videoArea,
              elevation.sheet,
              {
                top: pipTop,
                left: pipBaseLeft,
                width: pipWidth,
                height: pipHeight,
                borderRadius: radius.md,
                backgroundColor: colors.secondary,
                borderColor: colors.lineStrong,
                transform: pipDrag.getTranslateTransform(),
              },
              (mode === "chat" || boardExpanded) && s.videoAreaHidden,
            ]}
          >
            {roomUrl ? (
              <VideoCall
                provider={videoProvider}
                roomUrl={roomUrl}
                token={meetingToken}
                displayName={studentName}
                style={StyleSheet.absoluteFill}
                onLeft={handleDailyLeft}
                watchUserName={session?.teacherName}
                onWatchedParticipantLeft={notifyTeacherLeft}
              />
            ) : (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  s.permissionGate,
                  { gap: space.sm, paddingHorizontal: space.xl },
                ]}
              >
                <ActivityIndicator color={colors.onInverse} />
                <Text
                  style={[
                    t.caption,
                    { color: colors.onInverseMuted, textAlign: "center" },
                  ]}
                >
                  {roomExpired ??
                    (roomError
                      ? "Couldn't set up the video room."
                      : "Setting up video room…")}
                </Text>
              </View>
            )}
            <View
              {...pipPanResponder.panHandlers}
              style={s.pipGripHit}
              accessibilityRole="adjustable"
              accessibilityLabel="Drag teacher video window"
            >
              <View
                style={[s.pipGrip, { backgroundColor: colors.onInverseMuted }]}
              />
            </View>
          </Animated.View>

          <View style={s.boardWrap}>
            {waitingForTeacher ? (
              <View
                style={[
                  s.boardArea,
                  s.boardWaiting,
                  {
                    gap: space.sm,
                    paddingHorizontal: space.xxl,
                    backgroundColor: colors.background,
                  },
                ]}
              >
                <Feather
                  name="clock"
                  size={26}
                  color={colors.mutedForeground}
                />
                <Text
                  style={[
                    t.title3,
                    { color: colors.foreground, textAlign: "center" },
                  ]}
                >
                  The board opens when the class starts
                </Text>
                <Text
                  style={[
                    t.callout,
                    {
                      color: colors.mutedForeground,
                      textAlign: "center",
                      maxWidth: space.huge * 9,
                    },
                  ]}
                >
                  You are in the room and your teacher can see you. Stay here —
                  the whiteboard appears the moment they begin.
                </Text>
              </View>
            ) : (
              <View style={s.boardArea}>
                {/* Students receive the teacher's Excalidraw scene and materials here. This
                    remains read-only, and stays mounted while chat slides over it. */}
                <SmartBoard
                  key={id}
                  readOnly
                  sceneUpdates={sceneUpdates}
                  onConsumeUpdates={consumeSceneUpdates}
                  onSceneChange={noopSceneChange}
                  viewport={boardView}
                  clearedAt={boardClearedAt}
                />
              </View>
            )}

            {/* This carrier is inert while closed; only the scrim and sheet capture touches. */}
            <View
              pointerEvents={mode === "chat" ? "auto" : "none"}
              style={s.chatLayer}
            >
              <Animated.View
                style={[
                  StyleSheet.absoluteFill,
                  { opacity: chatProgress, backgroundColor: colors.scrim },
                ]}
              >
                <TouchableOpacity
                  style={StyleSheet.absoluteFill}
                  activeOpacity={1}
                  onPress={() => setMode("board")}
                  accessibilityLabel="Close class chat"
                />
              </Animated.View>

              <Animated.View
                pointerEvents="auto"
                style={[
                  s.chatCover,
                  elevation.modal,
                  {
                    height: isCompact ? "64%" : "56%",
                    maxWidth: space.huge * 12,
                    borderTopLeftRadius: radius.lg,
                    borderTopRightRadius: radius.lg,
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    transform: [
                      {
                        translateY: chatProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [height, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <View
                  style={[
                    s.chatHeader,
                    {
                      minHeight: HIT_SLOP_MIN,
                      paddingLeft: space.md,
                      paddingRight: space.xxs,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <View style={s.sessionInfo}>
                    <Text style={[t.title3, { color: colors.foreground }]}>
                      Class chat
                    </Text>
                    <Text
                      style={[t.caption, { color: colors.mutedForeground }]}
                    >
                      {messages.length === 0
                        ? "No messages yet"
                        : `${messages.length} ${messages.length === 1 ? "message" : "messages"}`}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      s.chatClose,
                      { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN },
                    ]}
                    onPress={() => setMode("board")}
                    activeOpacity={0.7}
                    accessibilityLabel="Close class chat"
                  >
                    <Feather
                      name="x"
                      size={20}
                      color={colors.mutedForeground}
                    />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  ref={scrollRef}
                  style={s.flex}
                  contentContainerStyle={[
                    s.chatMessages,
                    { gap: space.sm, padding: space.md },
                  ]}
                  keyboardShouldPersistTaps="handled"
                  onContentSizeChange={() =>
                    scrollRef.current?.scrollToEnd({ animated: false })
                  }
                >
                  {messages.length === 0 ? (
                    <Text
                      style={[
                        t.callout,
                        {
                          color: colors.mutedForeground,
                          textAlign: "center",
                          marginTop: space.xxxl,
                        },
                      ]}
                    >
                      No messages yet. Ask your teacher a question here.
                    </Text>
                  ) : null}
                  {messages.map((msg) => (
                    <View
                      key={msg.id}
                      style={[s.chatBubble, msg.isMe && s.chatBubbleMe]}
                    >
                      {!msg.isMe ? (
                        <Text
                          style={[
                            t.overline,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {msg.senderName}
                        </Text>
                      ) : null}
                      <View
                        style={[
                          s.bubbleContent,
                          {
                            paddingHorizontal: space.sm,
                            paddingVertical: space.xs,
                            borderRadius: radius.md,
                            backgroundColor: msg.isMe
                              ? colors.primary
                              : colors.muted,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            t.body,
                            {
                              color: msg.isMe
                                ? colors.primaryForeground
                                : colors.foreground,
                            },
                          ]}
                        >
                          {msg.text}
                        </Text>
                      </View>
                      <Text
                        style={[
                          t.overline,
                          numeric,
                          { color: colors.inkFaint },
                        ]}
                      >
                        {msg.time}
                      </Text>
                    </View>
                  ))}
                </ScrollView>

                <View
                  style={[
                    s.chatInputRow,
                    {
                      gap: space.xs,
                      paddingHorizontal: space.md,
                      paddingTop: space.xs,
                      paddingBottom: insets.bottom + space.xs,
                      borderTopColor: colors.border,
                    },
                  ]}
                >
                  <TextInput
                    style={[
                      t.body,
                      s.chatInputField,
                      {
                        minHeight: HIT_SLOP_MIN,
                        paddingHorizontal: space.md,
                        borderRadius: radius.pill,
                        color: colors.foreground,
                        backgroundColor: colors.muted,
                        borderColor: colors.border,
                      },
                    ]}
                    value={chatMsg}
                    onChangeText={setChatMsg}
                    placeholder="Ask the teacher…"
                    placeholderTextColor={colors.inkFaint}
                    onSubmitEditing={sendMessage}
                    returnKeyType="send"
                    testID="chat-input"
                  />
                  <TouchableOpacity
                    style={[
                      s.sendBtn,
                      {
                        width: HIT_SLOP_MIN,
                        height: HIT_SLOP_MIN,
                        borderRadius: radius.pill,
                        backgroundColor: colors.primary,
                      },
                    ]}
                    onPress={sendMessage}
                    activeOpacity={0.8}
                    accessibilityLabel="Send message"
                  >
                    <Feather
                      name="send"
                      size={18}
                      color={colors.primaryForeground}
                    />
                  </TouchableOpacity>
                </View>
              </Animated.View>
            </View>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  noticeCard: {
    width: "100%",
    maxWidth: 640,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
  },
  noticeText: { flex: 1 },
  noticeAction: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  noticeClose: { alignItems: "center", justifyContent: "center" },
  headerLayer: { ...StyleSheet.absoluteFillObject, zIndex: 70 },
  sessionPill: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
  },
  sessionInfo: { flex: 1 },
  liveTag: { flexDirection: "row", alignItems: "center" },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  presence: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    zIndex: 72,
  },
  presenceDot: { width: 8, height: 8, borderRadius: 4 },
  noticeLayer: { position: "absolute", alignItems: "center", zIndex: 120 },
  hudLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 100,
  },
  hud: { flexDirection: "row", alignItems: "center", borderWidth: 1 },
  hudButton: { alignItems: "center", justifyContent: "center" },
  contentArea: { flex: 1, position: "relative" },
  videoArea: {
    position: "absolute",
    overflow: "hidden",
    borderWidth: 1,
    zIndex: 60,
  },
  videoAreaHidden: { display: "none" },
  pipGripHit: {
    position: "absolute",
    top: 0,
    left: "35%",
    right: "35%",
    minHeight: HIT_SLOP_MIN,
    alignItems: "center",
    justifyContent: "flex-start",
    zIndex: 2,
  },
  pipGrip: {
    marginTop: 4,
    alignSelf: "center",
    width: 32,
    height: 4,
    borderRadius: 2,
  },
  permissionGate: { alignItems: "center", justifyContent: "center" },
  boardWrap: { flex: 1, overflow: "hidden" },
  boardArea: { flex: 1, overflow: "hidden" },
  boardWaiting: { alignItems: "center", justifyContent: "center" },
  chatLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    alignItems: "center",
    zIndex: 200,
  },
  chatCover: {
    width: "100%",
    alignSelf: "center",
    overflow: "hidden",
    borderTopWidth: 1,
  },
  chatHeader: { flexDirection: "row", alignItems: "center" },
  chatClose: { alignItems: "center", justifyContent: "center" },
  chatMessages: { flexGrow: 1 },
  chatBubble: { gap: 3, maxWidth: "80%" },
  chatBubbleMe: { alignSelf: "flex-end", alignItems: "flex-end" },
  bubbleContent: {},
  chatInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
  },
  chatInputField: { flex: 1, borderWidth: 1, outlineStyle: "none" } as object,
  sendBtn: { justifyContent: "center", alignItems: "center" },
});
