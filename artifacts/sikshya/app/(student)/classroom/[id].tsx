import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import type { Student } from "@/context/AuthContext";
import { ApiError, apiGet } from "@/utils/api";
import { useClassroomSocket } from "@/hooks/useClassroomSocket";
import ClassroomFloor from "@/components/ClassroomFloor";
import VideoCall from "@/components/VideoCall";
import { readRoomRefusal, retryDelayMs, type RoomRefusal } from "@/utils/roomRefusal";
import { TEST_BOOKING_LABEL, TEST_CLASS_LABEL } from "@/utils/testAccess";
import {
  callWindowControls,
  callWindowReducer,
  dragBounds,
  initialCallWindow,
  windowRect,
  type Viewport,
} from "@/utils/callWindow";
import SmartBoard from "@/components/SmartBoard";
import { useCallTimeLimit } from "@/hooks/useCallTimeLimit";
import { useAloneInCall } from "@/hooks/useAloneInCall";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { HIT_SLOP_MIN, space as spaceScale } from "@/constants/layout";
import { aloneMessage } from "@/utils/aloneInCall";
import { ExpiredClassRedirect } from "@/components/classes/ExpiredClassRedirect";
import { canJoinSession } from "@/utils/sessionWindow";
import { ClassroomControlDock } from "@/components/classes/ClassroomControlDock";
import { ClassroomChatDrawer } from "@/components/classes/ClassroomChatDrawer";
import { ClassroomReactions } from "@/components/classes/ClassroomReactions";
import { ClassroomMediaPreparation } from "@/components/classes/ClassroomMediaPreparation";
import WarningModal from "@/components/WarningModal";

type Mode = "board" | "chat";
type VideoWindowSize = "hidden" | "small" | "medium" | "full";
type VisibleVideoWindowSize = Exclude<VideoWindowSize, "hidden">;
type WindowedVideoSize = Exclude<VisibleVideoWindowSize, "full">;

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
  endedAt?: string | null;
  /** The API clock used for the entry decision; a handset clock never closes the classroom. */
  serverTime?: string;
}

type NoticeTone = "warning" | "destructive";

interface FloatingNoticeProps {
  tone: NoticeTone;
  icon: keyof typeof Feather.glyphMap;
  text: string;
  testID?: string;
  closeTestID?: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
}

/** Mirrors the verified teacher notice: transform-only, above the board, never in its flow. */
function FloatingNotice({
  tone,
  icon,
  text,
  testID,
  closeTestID,
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
      testID={testID}
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
          testID={closeTestID}
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
  const {
    t,
    numeric,
    width,
    height,
    isCompact,
    isLandscape: isLandscapeLayout,
    space,
    radius,
    elevation,
  } = useLayout();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const student = user as Student;
  /**
   * Remembered here, applied after the hooks. See the teacher classroom for the whole story: a
   * `return null` above forty hooks turns a cold open of a class link — a refresh, a bookmark —
   * into React error 310 and "Something went wrong. Please reload the app."
   */
  const wrongRole = !student || student.role !== "student";

  const studentName = student?.name ?? "Student";

  const {
    connected,
    accessDenied,
    presenceCount,
    messages,
    floatingReactions,
    sendReaction,
    sessionStatus,
    sendChat,
    sceneUpdates,
    consumeSceneUpdates,
    boardClearedAt,
    boardView,
    boardPages,
    activeBoardPageId,
    boardPageChangedAt,
    boardLaser,
    floor,
    floorRefusal,
    clearFloorRefusal,
    floorActions,
  } = useClassroomSocket({
    sessionId: id ?? "",
    name: studentName,
    role: "student",
  });

  const [session, setSession] = useState<SessionData | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [chatMsg, setChatMsg] = useState("");
  const [mode, setMode] = useState<Mode>("board");
  /** The call never unmounts while its app-owned shell is hidden or resized. */
  /**
   * The same window the teacher has, from the same file.
   *
   * Both classrooms carried their own copy of this and had already drifted apart. `utils/
   * callWindow.ts` is now the only description of where the call sits and what each button does
   * to it, and it is tested on its own.
   */
  const [callWindow, dispatchWindow] = useReducer(
    callWindowReducer,
    isCompact ? "compact" : "normal",
    initialCallWindow,
  );
  const videoWindowSize: VideoWindowSize =
    callWindow.state === "compact" ? "small" : callWindow.state === "normal" ? "medium" : callWindow.state;
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  /**
   * Whether this class's video can enforce a permission, and when its discussion opens.
   *
   * Both from the room payload, both decided by the server. `canModerate` is false on Daily —
   * where every participant can unmute themselves, so a raised hand would be asking for something
   * the student already has — and the whole floor is hidden rather than drawn and refused.
   */
  const [canModerate, setCanModerate] = useState(false);
  const [discussionOpensAt, setDiscussionOpensAt] = useState<number | null>(null);
  /** The teacher's participant identity, from the room payload. Used only for the tile budget. */
  const [teacherParticipantId, setTeacherParticipantId] = useState<string | null>(null);
  const [meetingToken, setMeetingToken] = useState<string | null>(null);
  /** Which implementation carries this call. The server decides; the app just mounts it. */
  const [videoProvider, setVideoProvider] = useState<string>("daily");
  const [mediaPrepared, setMediaPrepared] = useState(false);
  const [micToggleRequest, setMicToggleRequest] = useState(0);
  const [localMicOn, setLocalMicOn] = useState(false);
  const [localCameraOn, setLocalCameraOn] = useState(false);
  const [cameraToggleRequest, setCameraToggleRequest] = useState(0);
  /**
   * What, if anything, this room has to say about payment — and to *this* person.
   *
   * Two facts arrive from the server and they are not the same. `booking` means this viewer's own
   * place was granted and took no money. `class` means only that the class is open to such
   * bookings; everybody else in it paid the full price. Painting the first sentence at everybody,
   * which is what a single flag did, told a paying student their money had not been taken.
   *
   * The server decides — it is the only side that knows what the enrolment says — and the banner
   * repeats what it was told.
   */
  const [testNotice, setTestNotice] =
    useState<{ kind: "booking" | "class"; text: string } | null>(null);
  const [roomError, setRoomError] = useState(false);
  /** Set when the server refuses a room because the class is genuinely over. */
  const [roomExpired, setRoomExpired] = useState<string | null>(null);
  /**
   * Set when the doors simply have not opened yet, which is not the same thing at all.
   *
   * Both states used to be one. Every timing refusal arrived as a 409 and became `roomExpired`,
   * so a student who had booked and paid and opened their class early was shown an ending — for
   * a lesson they were about to attend.
   */
  const [roomWaiting, setRoomWaiting] = useState<RoomRefusal | null>(null);
  /** True until Fadko has checked the lesson before asking any video provider for a room. */
  const [checkingEntry, setCheckingEntry] = useState(true);
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
  const pipDrag = useRef(new Animated.ValueXY()).current;
  const lastSeenIncomingRef = useRef(0);
  const previousIncomingRef = useRef(0);

  /**
   * Excalidraw's controls own the top and bottom bands. Classroom overlays stay between them:
   * the context pill begins below the top toolbar, the HUD sits above the zoom controls, and
   * the remote-video PIP cannot be dragged into either interactive area.
   */
  const boardToolbarBottom = insets.top + HIT_SLOP_MIN + space.md;
  const hudBottom = insets.bottom + HIT_SLOP_MIN + space.md;
  const pipBottomClearance = hudBottom + HIT_SLOP_MIN + space.lg;

  const videoHidden = videoWindowSize === "hidden";
  const videoFull = videoWindowSize === "full";
  const videoSmall = videoWindowSize === "small";
  const windowControls = callWindowControls(callWindow);

  /** The bands Excalidraw owns at top and bottom; the helper keeps the window out of both. */
  const viewport: Viewport = useMemo(
    () => ({
      width,
      height,
      insets,
      reservedTop: boardToolbarBottom - insets.top + HIT_SLOP_MIN + (isLandscapeLayout ? space.xs : space.lg),
      reservedBottom: pipBottomClearance - insets.bottom,
      hitSlopMin: HIT_SLOP_MIN,
    }),
    [width, height, insets, boardToolbarBottom, pipBottomClearance, isLandscapeLayout, space.xs, space.lg],
  );

  const rect = windowRect(callWindow.state, viewport, callWindow.offset);
  const pipTop = rect.top;
  const videoWidth = rect.width;
  const videoHeight = rect.height;
  const videoLeft = rect.left;
  const presentedVideoLeft =
    !isCompact && mode === "chat" && !videoFull
      ? Math.min(videoLeft, Math.max(space.sm, width - 404 - videoWidth))
      : videoLeft;
  const windowedVideoWidth = rect.width;
  const windowedVideoHeight = rect.height;
  const windowedVideoBaseLeft = rect.left;
  const noticeTop = videoHidden
    ? rect.top
    : videoFull
      ? rect.top + space.sm
      : rect.top + rect.height + space.sm;

  useEffect(() => {
    dispatchWindow({ type: "viewport", bounds: dragBounds(callWindow.state, viewport) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, insets.top, insets.bottom, insets.left, insets.right]);

  const incomingMessageCount = useMemo(
    () =>
      messages.reduce((total, message) => total + (message.isMe ? 0 : 1), 0),
    [messages],
  );

  const pipPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > space.xxs || Math.abs(gesture.dy) > space.xxs,
        onPanResponderGrant: () => {
          pipDrag.setOffset({ x: 0, y: 0 });
          pipDrag.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: Animated.event(
          [null, { dx: pipDrag.x, dy: pipDrag.y }],
          {
            useNativeDriver: false,
          },
        ),
        onPanResponderRelease: (_, gesture) => {
          // The shared model absorbs and clamps the movement; the rectangle already includes it,
          // so the animated value goes back to zero rather than doubling on the next drag.
          pipDrag.flattenOffset();
          dispatchWindow({ type: "drag", dx: gesture.dx, dy: gesture.dy });
          pipDrag.setValue({ x: 0, y: 0 });
        },
        onPanResponderTerminate: (_, gesture) => {
          pipDrag.flattenOffset();
          dispatchWindow({ type: "drag", dx: gesture.dx, dy: gesture.dy });
          pipDrag.setValue({ x: 0, y: 0 });
        },
      }),
    [
      height,
      windowedVideoBaseLeft,
      pipDrag,
      pipTop,
      pipBottomClearance,
      space.md,
      space.xxs,
      windowedVideoHeight,
      windowedVideoWidth,
      width,
    ],
  );

  /**
   * The old clamp lived here, written out in six local variables, once per classroom.
   *
   * `dragBounds` in `utils/callWindow.ts` is the one rule now, applied on every viewport change
   * by the effect above — which is also what makes a rotation re-clamp the window instead of
   * losing it off the edge.
   */

  const hideVideoWindow = useCallback(() => dispatchWindow({ type: "hide" }), []);
  const showVideoWindow = useCallback(() => dispatchWindow({ type: "show" }), []);
  /** Minus: small, and back in the corner. One meaning from every state. */
  const minimizeVideoWindow = useCallback(() => dispatchWindow({ type: "minimize" }), []);
  const toggleFullVideoWindow = useCallback(() => dispatchWindow({ type: "toggle-full" }), []);
  /** Compact's one control: back to the working size. */
  const restoreVideoWindow = useCallback(() => dispatchWindow({ type: "restore" }), []);

  useEffect(() => {
    const previous = previousIncomingRef.current;
    if (incomingMessageCount > previous && mode !== "chat") {
      Vibration.vibrate();
    }
    previousIncomingRef.current = incomingMessageCount;

    if (mode === "chat") {
      lastSeenIncomingRef.current = incomingMessageCount;
      setUnreadChatCount(0);
      return;
    }

    setUnreadChatCount(
      Math.max(0, incomingMessageCount - lastSeenIncomingRef.current),
    );
  }, [incomingMessageCount, mode]);

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

  const goToDashboard = useCallback(() => {
    hasLeft.current = true;
    setRoomUrl(null);
    setMeetingToken(null);
    setMediaPrepared(false);
    router.replace("/(student)");
  }, []);

  useEffect(() => {
    let cancelled = false;
    hasLeft.current = false;
    setCheckingEntry(true);
    setRoomExpired(null);
    setRoomWaiting(null);
    setRoomError(false);
    setRoomUrl(null);
    setMeetingToken(null);

    void (async () => {
      const loaded = await loadSession();
      if (cancelled || !loaded) {
        if (!cancelled) setCheckingEntry(false);
        return;
      }

      // The lesson details arrive first. This removes the race that mounted Daily before Fadko
      // knew whether the lesson had ended. The server's clock travels with the response so a
      // phone set to the wrong time cannot close (or reopen) a class.
      const serverNow = loaded.serverTime ? Date.parse(loaded.serverTime) : Number.NaN;
      const localGate = canJoinSession(loaded, Number.isFinite(serverNow) ? serverNow : Date.now());
      if (!localGate.ok && localGate.code !== "too_early") {
        setRoomExpired(localGate.message);
        setCheckingEntry(false);
        return;
      }

      await loadRoom();
      if (!cancelled) setCheckingEntry(false);
    })();

    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // Entry is intentionally restarted only when the route points at a different lesson.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /**
   * Whoever the teacher has featured, as a participant identity rather than an account id.
   *
   * The floor speaks in account ids because that is what the server authorises against; the call
   * roster speaks in participant identities. `providerUserId` on the server is just the id as a
   * string, so the conversion is a `String(...)` — written out here rather than assumed, so that
   * the day the identity format gains a prefix there is one place to change.
   */
  const spotlightParticipantId =
    floor && floor.spotlight !== null ? String(floor.spotlight) : null;

  const loadSession = async () => {
    try {
      const loaded = await apiGet<SessionData>(`/sessions/${id}`);
      setSession(loaded);
      return loaded;
    } catch {
      setRoomError(true);
      return null;
    }
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
        capabilities,
        discussionOpensAt: opensAt,
        teacherUserId: teacherIdentity,
        testClass,
        testClassLabel,
        testBooking,
        testBookingLabel,
      } = await apiGet<{
        roomUrl: string;
        token?: string | null;
        provider?: string;
        capabilities?: { moderatesPublishing?: boolean };
        discussionOpensAt?: number | null;
        /** The teacher's participant identity, so their tile is never dropped for a busy grid. */
        teacherUserId?: string | null;
        /** The class is open to test bookings. Says nothing about whether *you* paid. */
        testClass?: boolean;
        testClassLabel?: string;
        /** *Your own* place here was granted and took no money. */
        testBooking?: boolean;
        testBookingLabel?: string;
      }>(`/sessions/${id}/room`);
      if (provider) setVideoProvider(provider);
      setCanModerate(capabilities?.moderatesPublishing === true);
      setDiscussionOpensAt(typeof opensAt === "number" ? opensAt : null);
      setTeacherParticipantId(typeof teacherIdentity === "string" ? teacherIdentity : null);
      /**
       * The narrower, personal fact wins; the class-level one is the fallback.
       *
       * Both used to arrive as one flag, so an ordinary student who had genuinely paid for a seat
       * in a test class sat under a banner telling them no payment had been processed. Now the
       * only person shown that sentence is the person it is true of.
       */
      /**
       * A student is told about their own place, and about nothing else.
       *
       * The class-level fact — that this class is open to granted bookings — is the teacher's to
       * know; it qualifies their income. To a student it is either irrelevant (they paid) or
       * weaker than what they are already being told (they did not). Showing it to somebody who
       * paid puts the word "test" next to their money for no reason, which is the same instinct
       * that produced the false banner in the first place, one step quieter.
       */
      void testClass;
      void testClassLabel;
      setTestNotice(
        testBooking
          ? { kind: "booking" as const, text: testBookingLabel || TEST_BOOKING_LABEL }
          : null,
      );
      setRoomUrl(url);
      setMeetingToken(token ?? null);
      setRoomError(false);
    } catch (err) {
      // A class that is over is refused by the server rather than given a room. Say that,
      // instead of "couldn't set up the video room", which sounds like a fault to retry.
      if (err instanceof ApiError && err.status === 409) {
        const refusal = readRoomRefusal(err.status, err.data, err.message);
        if (refusal.kind === "waiting") {
          // Early, not over. The video area says when it opens, and the effect below asks again
          // at that moment rather than leaving somebody to guess.
          setRoomWaiting(refusal);
          setRoomExpired(null);
          return;
        }
        setRoomWaiting(null);
        setRoomExpired(refusal.message || "This class has finished.");
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

  /**
   * Ask again when the door opens.
   *
   * Clamped to five minutes by `retryDelayMs`: one timer set for tomorrow morning is a promise a
   * throttled tab or a dozing phone will not keep.
   */
  useEffect(() => {
    if (!roomWaiting) return;
    const delay = retryDelayMs(roomWaiting, Date.now());
    if (delay === null) return;
    const timer = setTimeout(() => {
      setRoomWaiting(null);
      void loadRoom();
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomWaiting]);

  const sendMessage = () => {
    if (!chatMsg.trim()) return;
    sendChat(chatMsg.trim());
    setChatMsg("");
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

  const leaveSession = useCallback(() => setLeaveConfirmOpen(true), []);
  const confirmLeaveSession = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    setLeaveConfirmOpen(false);
    leaveNow();
  }, [leaveNow, leaving]);

  // Presence starts at 0 the instant the server clears stale entries on session start;
  // don't fall back to enrolledCount before the socket connects, or a ghost count/avatar
  // shows up for a class nobody has actually joined yet.
  const livePresenceCount = connected
    ? floor?.scope === "student"
      ? floor.participantCount
      : presenceCount
    : 0;

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
  const notifyTeacherReturned = useCallback(() => {
    teacherGoneRef.current = false;
    setTeacherGone(false);
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
    active: !!roomUrl && !roomExpired && !roomWaiting,
    onCutoff: () => {
      leaveNow();
    },
  });

  // Every hook above has run. Now it is safe to render nothing for the wrong role.
  if (wrongRole) return null;

  if (roomExpired) {
    return <ExpiredClassRedirect message={roomExpired} onDashboard={goToDashboard} />;
  }

  if (checkingEntry) {
    return (
      <View style={[s.container, s.permissionGate, { gap: space.sm, backgroundColor: colors.background }]} testID="classroom-entry-check">
        <ActivityIndicator color={colors.primary} />
        <Text style={[t.callout, { color: colors.mutedForeground }]}>Checking this class…</Text>
      </View>
    );
  }

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
                left: space.sm,
                width: Math.min(width - space.lg, isCompact ? width - space.lg : 440),
                minHeight: 36,
                gap: space.xxs,
                paddingHorizontal: space.xs,
                paddingVertical: 3,
                borderRadius: radius.sm,
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={[s.sessionCompactInfo, { gap: space.xs }]}>
              <Text
                style={[t.caption, { color: colors.foreground, flex: 1 }]}
                numberOfLines={1}
              >
                {session?.topic ?? "Live session"}
              </Text>
              <Text
                style={[t.overline, numeric, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {fmt(elapsed)}
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
            {typeof __DEV__ !== "undefined" && __DEV__ && testNotice ? (
              <View
                testID={testNotice.kind === "booking" ? "classroom-test-booking" : "classroom-test-class"}
                accessibilityLabel="Test classroom"
                style={[
                  s.testTag,
                  {
                    paddingHorizontal: space.xs,
                    paddingVertical: space.xxs,
                    borderRadius: radius.pill,
                    backgroundColor: colors.warnSoft,
                  },
                ]}
              >
                <Text style={[t.overline, { color: colors.warn }]}>TEST</Text>
              </View>
            ) : null}
          </View>
        </View>

        {livePresenceCount > 0 && !videoFull && !isCompact ? (
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
              top: noticeTop,
              left: space.md,
              right: space.md,
              gap: space.xs,
            },
          ]}
        >
          {accessDenied ? (
            <FloatingNotice
              tone="destructive"
              icon="lock"
              text="You're not enrolled in this class, so the whiteboard and chat are unavailable. Enrol from the session page to join."
            />
          ) : null}

          {timeLimit.overtime ? (
            <FloatingNotice
              testID="call-overtime-notice"
              tone="destructive"
              icon="alert-octagon"
              text="This class has run past its finish time. The call is ending now."
            />
          ) : timeLimit.showWarning ? (
            <FloatingNotice
              testID="call-warning-notice"
              closeTestID="call-warning-close"
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

        {(!canModerate || !floor) && mode !== "chat" ? <ClassroomControlDock
          bottom={hudBottom}
          chatOpen={false}
          unreadCount={unreadChatCount}
          videoHidden={videoHidden}
          onToggleChat={() =>
            setMode((current) => (current === "chat" ? "board" : "chat"))
          }
          onToggleVideo={videoHidden ? showVideoWindow : hideVideoWindow}
          onLeave={leaveSession}
          leaveLabel="Leave class"
        /> : null}

        {/* Only this visible capsule captures touches; its carrier stays transparent. */}
        <View
          pointerEvents="none"
          style={[
            s.hudLayer,
            { bottom: hudBottom },
            s.overlayHidden,
          ]}
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
              {unreadChatCount > 0 && mode !== "chat" ? (
                <View
                  pointerEvents="none"
                  style={[
                    s.chatBadge,
                    {
                      minWidth: space.lg,
                      height: space.lg,
                      paddingHorizontal: space.xxs,
                      borderRadius: radius.pill,
                      backgroundColor: colors.primary,
                      borderColor: colors.card,
                    },
                  ]}
                >
                  <Text
                    style={[
                      t.overline,
                      numeric,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    {unreadChatCount > 9 ? "9+" : unreadChatCount}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                s.hudButton,
                {
                  width: HIT_SLOP_MIN,
                  height: HIT_SLOP_MIN,
                  borderRadius: radius.pill,
                  backgroundColor: videoHidden
                    ? colors.actionSoft
                    : colors.card,
                },
              ]}
              onPress={videoHidden ? showVideoWindow : hideVideoWindow}
              activeOpacity={0.75}
              accessibilityLabel={
                videoHidden ? "Show call window" : "Hide call window"
              }
              testID="video-visibility-btn"
            >
              <Feather
                name={videoHidden ? "video-off" : "video"}
                size={18}
                color={videoHidden ? colors.primary : colors.mutedForeground}
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

        {/* The media session stays mounted through hide and size changes; only its shell moves. */}
        <View style={s.contentArea}>
          <Animated.View
            testID="video-window"
            pointerEvents={mode === "chat" || videoHidden ? "none" : "auto"}
            style={[
              s.videoArea,
              elevation.sheet,
              {
                top: pipTop,
                left: presentedVideoLeft,
                width: videoWidth,
                height: videoHeight,
                borderRadius: videoFull ? radius.lg : radius.md,
                backgroundColor: colors.secondary,
                borderColor: colors.lineStrong,
                // Position comes from the shared model; the animated value only tracks a live drag.
                transform: windowControls.canDrag ? pipDrag.getTranslateTransform() : [],
              },
              ((isCompact && mode === "chat") || videoHidden) && s.videoAreaHidden,
            ]}
          >
            <View
              style={[
                s.callFrameHeader,
                {
                  height: HIT_SLOP_MIN,
                  backgroundColor: colors.secondary,
                  borderBottomColor: colors.lineStrong,
                },
              ]}
            >
              {!videoFull ? (
                <View
                  {...pipPanResponder.panHandlers}
                  style={s.callDragZone}
                  accessibilityRole="adjustable"
                  accessibilityLabel="Drag teacher video window"
                >
                  <Feather name="move" size={18} color={colors.onInverseMuted} />
                </View>
              ) : (
                <View style={s.callDragZone} />
              )}

              {/*
                Compact is a preview, so it gets one control rather than three.

                Three 44-point buttons do not fit across a 132-point window; they render as a row
                of half-buttons nobody can hit, which is the "unusable provider control row" this
                is meant to avoid. Restore is the one thing somebody wants from a thumbnail, and
                Hide stays reachable from the classroom's own HUD.
              */}
              {videoSmall ? (
                <View style={s.callFrameActions}>
                  <TouchableOpacity
                    style={[s.callFrameButton, { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN }]}
                    onPress={hideVideoWindow}
                    accessibilityRole="button"
                    accessibilityLabel="Hide call window"
                    testID="video-hide-btn"
                  >
                    <Feather name="eye-off" size={18} color={colors.onInverse} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      s.callFrameButton,
                      { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN },
                    ]}
                    onPress={restoreVideoWindow}
                    accessibilityRole="button"
                    accessibilityLabel="Restore the call window"
                    testID="video-restore-btn"
                  >
                    <Feather name="maximize-2" size={18} color={colors.onInverse} />
                  </TouchableOpacity>
                </View>
              ) : (
              <View style={s.callFrameActions}>
                <TouchableOpacity
                  style={[
                    s.callFrameButton,
                    {
                      width: HIT_SLOP_MIN + space.md,
                      height: HIT_SLOP_MIN,
                      gap: space.xxs,
                    },
                  ]}
                  onPress={hideVideoWindow}
                  accessibilityLabel="Hide call window"
                  testID="video-hide-btn"
                >
                  <Feather name="eye-off" size={18} color={colors.onInverse} />
                  <Text style={[t.caption, { color: colors.onInverse }]}>
                    Hide
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    s.callFrameButton,
                    { width: 94, height: HIT_SLOP_MIN, gap: space.xxs },
                  ]}
                  onPress={minimizeVideoWindow}
                  disabled={!windowControls.canMinimize}
                  accessibilityLabel="Make the call window small and put it back in the corner"
                  accessibilityState={{ disabled: !windowControls.canMinimize }}
                  testID="video-window-size-btn"
                >
                  <Feather
                    name="minimize-2"
                    size={18}
                    color={windowControls.canMinimize ? colors.onInverse : colors.onInverseMuted}
                  />
                  <Text style={[t.caption, { color: colors.onInverse }]}>Minimize</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    s.callFrameButton,
                    {
                      width: HIT_SLOP_MIN,
                      height: HIT_SLOP_MIN,
                      backgroundColor: videoFull
                        ? colors.actionSoft
                        : colors.secondary,
                    },
                  ]}
                  onPress={toggleFullVideoWindow}
                  accessibilityLabel={
                    videoFull ? "Restore call window" : "Show call full screen"
                  }
                  testID="video-fullscreen-btn"
                >
                  <Feather
                    name={videoFull ? "minimize-2" : "maximize-2"}
                    size={18}
                    color={videoFull ? colors.primary : colors.onInverse}
                  />
                </TouchableOpacity>
              </View>
              )}
            </View>

            <View style={s.callFrameBody}>
              {roomUrl && (videoProvider !== "livekit" || mediaPrepared) ? (
                <VideoCall
                  provider={videoProvider}
                  roomUrl={roomUrl}
                  token={meetingToken}
                  displayName={studentName}
                  style={StyleSheet.absoluteFill}
                  onLeft={videoProvider === "livekit" ? leaveSession : handleDailyLeft}
                  /*
                    The classroom socket is up long before this is, and a grant made in that gap
                    reaches LiveKit before the student's participant does. The server keeps such a
                    grant pending rather than reporting it done; this is what tells it to finish.
                  */
                  onMediaReady={floorActions.mediaReady}
                  micToggleRequest={micToggleRequest}
                  cameraToggleRequest={cameraToggleRequest}
                  isTeacher={false}
                  canUseMicrophone={
                    floor?.scope === "student" &&
                    floor.you.allowedMic &&
                    floor.you.provider === "ok" &&
                    floor.you.state !== "muted-by-teacher"
                  }
                  canUseCamera={floor?.scope === "student" && floor.you.allowedCamera}
                  onLocalMediaChange={(media) => {
                    setLocalMicOn(media.micEnabled);
                    setLocalCameraOn(media.cameraEnabled);
                    if (floor?.scope !== "student") return;
                    if (floor.you.acceptedMic !== media.micEnabled) {
                      floorActions.setMic(media.micEnabled);
                    }
                    if (floor.you.acceptedCamera !== media.cameraEnabled) {
                      floorActions.setCamera(media.cameraEnabled);
                    }
                  }}
                  watchUserName={session?.teacherName}
                  onWatchedParticipantLeft={notifyTeacherLeft}
                  onWatchedParticipantReturned={notifyTeacherReturned}
                  teacherUserId={teacherParticipantId}
                  spotlightUserId={spotlightParticipantId}
                  showProviderControls={windowControls.showsProviderControls}
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
                      roomWaiting?.message ??
                      (roomError
                        ? "Couldn't set up the video room."
                        : "Setting up video room…")}
                  </Text>
                </View>
              )}
            </View>
          </Animated.View>

          <View style={[s.boardWrap, { paddingTop: insets.top }]}>
            {waitingForTeacher ? (
              <View
                style={[
                  s.boardArea,
                  s.boardWaiting,
                  {
                    gap: space.sm,
                    paddingHorizontal: space.xxl,
                    paddingBottom: hudBottom + HIT_SLOP_MIN + space.lg,
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
                  classroomChrome
                  readOnly
                  sceneUpdates={sceneUpdates}
                  onConsumeUpdates={consumeSceneUpdates}
                  onSceneChange={noopSceneChange}
                  viewport={boardView}
                  clearedAt={boardClearedAt}
                  pages={boardPages}
                  activePageId={activeBoardPageId}
                  pageChangedAt={boardPageChangedAt}
                  laser={boardLaser}
                />
              </View>
            )}

            {/*
              Where this student stands, pinned along the bottom.

              Above the board rather than over the call, because the board is what a student looks
              at for most of a lesson and an invitation they cannot see is an invitation nobody
              answers. Inert when the floor is null — before the first state arrives, once the
              class ends, and on a provider that cannot enforce a permission.
            */}
            {mode !== "chat" ? <View pointerEvents="box-none" style={[s.floorLayer, { bottom: insets.bottom + space.sm }]}>
              <ClassroomFloor
                floor={floor}
                refusal={floorRefusal}
                onDismissRefusal={clearFloorRefusal}
                actions={floorActions}
                discussionOpensAt={discussionOpensAt}
                canModerate={canModerate}
                microphoneOn={localMicOn}
                onToggleMicrophone={() => setMicToggleRequest((count) => count + 1)}
                cameraOn={localCameraOn}
                onToggleCamera={() => setCameraToggleRequest((count) => count + 1)}
                dockControls={<ClassroomControlDock inline bottom={0}
                  chatOpen={false} unreadCount={unreadChatCount} videoHidden={videoHidden}
                  onToggleChat={() => setMode("chat")}
                  onToggleVideo={videoHidden ? showVideoWindow : hideVideoWindow}
                  onLeave={leaveSession} leaveLabel="Leave class" />}
              />
            </View> : null}

            {mode !== "chat" ? <ClassroomReactions reactions={floatingReactions} /> : null}
            <ClassroomChatDrawer
              open={mode === "chat"}
              connected={connected}
              onReaction={sendReaction}
              reactions={floatingReactions}
              messages={messages}
              value={chatMsg}
              onChangeText={setChatMsg}
              onSend={sendMessage}
              onClose={() => setMode("board")}
              placeholder="Message everyone…"
              emptyText="Ask your teacher a question without leaving the board."
            />
          </View>
        </View>
      </View>
      <ClassroomMediaPreparation
        visible={Boolean(roomUrl && videoProvider === "livekit" && !mediaPrepared)}
        onComplete={() => setMediaPrepared(true)}
      />
      <WarningModal
        visible={leaveConfirmOpen}
        title="Leave this class?"
        consequences={[
          "Your teacher and classmates remain in the active class.",
          "You can return while this lesson is still open.",
        ]}
        confirmLabel="Leave class"
        busy={leaving}
        onConfirm={confirmLeaveSession}
        onCancel={() => setLeaveConfirmOpen(false)}
        testID="leave-class-confirmation"
      />
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
  sessionCompactInfo: { flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0 },
  testTag: { alignItems: "center", justifyContent: "center" },
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
  // Time and access notices must remain actionable above the floating control dock.
  noticeLayer: { position: "absolute", alignItems: "center", zIndex: 130 },
  /*
    Under the chat sheet and over the board.

    zIndex 110 rather than 130: the chat cover slides up over everything and must land on top of
    this, while the class's own notices — the wrap-up warning, an access refusal — sit above it,
    because those are about whether the lesson can continue at all.
  */
  floorLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: spaceScale.sm,
    zIndex: 110,
  },
  hudLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 100,
  },
  hud: { flexDirection: "row", alignItems: "center", borderWidth: 1 },
  hudButton: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  chatBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  // Retired HUD stays out of layout and hit testing; opacity alone leaves invisible buttons.
  overlayHidden: { display: "none" },
  contentArea: { flex: 1, position: "relative" },
  videoArea: {
    position: "absolute",
    overflow: "hidden",
    borderWidth: 1,
    zIndex: 60,
  },
  videoAreaHidden: { display: "none" },
  callFrameHeader: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    // Above the call itself, so nothing the provider paints can end up on top of these controls.
    zIndex: 1,
  },
  callDragZone: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  pipGrip: {
    width: 32,
    height: 4,
    borderRadius: 2,
  },
  callFrameActions: { flexDirection: "row", alignItems: "center" },
  callFrameButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  /**
   * The call is clipped to its own half of the window.
   *
   * Without this the call's contents paint outside the body. A provider message too tall for a
   * 132-point preview rendered 140 points high in a 72-point box, centred, so it overflowed
   * *upwards* across the header — and swallowed every tap meant for Hide, minus and maximise.
   * The buttons were there, drawn, and dead, which is exactly what the owner reported.
   */
  callFrameBody: { flex: 1, position: "relative", overflow: "hidden" },
  permissionGate: { alignItems: "center", justifyContent: "center" },
  boardWrap: { flex: 1, overflow: "hidden" },
  boardArea: { flex: 1, overflow: "hidden" },
  boardWaiting: { alignItems: "center", justifyContent: "flex-end" },
});
