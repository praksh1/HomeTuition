import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
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
  Vibration,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import type { Teacher } from "@/context/AuthContext";
import { ApiError, apiGet, apiPatch } from "@/utils/api";
import { useClassroomSocket } from "@/hooks/useClassroomSocket";
import VideoCall from "@/components/VideoCall";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import PdfViewer from "@/components/PdfViewer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { ErrorFallbackProps } from "@/components/ErrorFallback";
import {
  prepareBoardImage,
  BoardImageError,
  NATIVE_PICKER_QUALITY,
} from "@/utils/boardImage";
import { isShareableSource, looksLikePdf } from "@/utils/pickedFile";
import { File as FsFile } from "expo-file-system";
import { MAX_PDF_BYTES, preparePickedPdf } from "@/utils/pickedPdf";
import { cancelSessionReminder } from "@/utils/notifications";
import { canOpenSession } from "@/utils/sessionWindow";
import { useCallTimeLimit } from "@/hooks/useCallTimeLimit";
import { useAloneInCall } from "@/hooks/useAloneInCall";
import SmartBoard from "@/components/SmartBoard";
import { useLayout } from "@/hooks/useLayout";
import { HIT_SLOP_MIN } from "@/constants/layout";
import { aloneMessage } from "@/utils/aloneInCall";

type Mode = "whiteboard" | "chat";
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
  /** Needed to answer whether this class may still be opened. See utils/sessionWindow.ts. */
  date: string;
  startedAt?: string | null;
  endedAt?: string | null;
}

function WhiteboardFallback({ resetError }: ErrorFallbackProps) {
  const colors = useColors();
  const { t, space, radius } = useLayout();

  return (
    <View
      style={[
        s.boardFallback,
        {
          gap: space.sm,
          paddingHorizontal: space.xxl,
          backgroundColor: colors.card,
        },
      ]}
    >
      <Feather name="alert-triangle" size={30} color={colors.warn} />
      <Text
        style={[t.title3, { color: colors.foreground, textAlign: "center" }]}
      >
        The whiteboard stopped responding
      </Text>
      <Text
        style={[
          t.callout,
          { color: colors.mutedForeground, textAlign: "center" },
        ]}
      >
        Your video call is still running. Reload the board to keep teaching — if
        it happens again, try a smaller image.
      </Text>
      <TouchableOpacity
        style={[
          s.boardFallbackBtn,
          {
            marginTop: space.xxs,
            paddingHorizontal: space.lg,
            borderRadius: radius.sm,
            backgroundColor: colors.primary,
          },
        ]}
        onPress={resetError}
        activeOpacity={0.8}
      >
        <Text style={[t.caption, { color: colors.primaryForeground }]}>
          Reload board
        </Text>
      </TouchableOpacity>
    </View>
  );
}

type NoticeTone = "warning" | "destructive";

interface FloatingNoticeProps {
  tone: NoticeTone;
  icon: keyof typeof Feather.glyphMap;
  text: string;
  actionLabel?: string;
  actionKind?: "primary" | "tone";
  actionDisabled?: boolean;
  onAction?: () => void;
  onClose?: () => void;
}

/** A cheap transform-only entrance keeps urgent notices above the board without reflowing it. */
function FloatingNotice({
  tone,
  icon,
  text,
  actionLabel,
  actionKind = "tone",
  actionDisabled = false,
  onAction,
  onClose,
}: FloatingNoticeProps) {
  const colors = useColors();
  const { t, space, radius, elevation } = useLayout();
  const entrance = useRef(new Animated.Value(-space.huge)).current;
  const toneColor = tone === "destructive" ? colors.destructive : colors.warn;
  const toneFill =
    tone === "destructive" ? colors.destructiveSoft : colors.warnSoft;
  const actionColor = actionKind === "primary" ? colors.primary : toneColor;

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
              borderColor: actionColor,
            },
          ]}
          onPress={onAction}
          disabled={actionDisabled}
          activeOpacity={0.75}
        >
          <Text style={[t.caption, { color: actionColor }]}>{actionLabel}</Text>
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

export default function Classroom() {
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
  const teacher = user as Teacher;
  if (!teacher || teacher.role !== "teacher") return null;

  const teacherName = teacher.name ?? "Teacher";

  const {
    connected,
    accessDenied,
    presenceCount,
    messages,
    sessionStatus,
    boardClearedAt,
    sceneUpdates,
    consumeSceneUpdates,
    sendSceneUpdate,
    sendBoardView,
    sendChat,
    sendBoardClear,
    clearMaterial,
    materialRejected,
    clearMaterialRejected,
  } = useClassroomSocket({
    sessionId: id ?? "",
    name: teacherName,
    role: "teacher",
  });

  const [session, setSession] = useState<SessionData | null>(null);
  const [mode, setMode] = useState<Mode>("whiteboard");
  const [elapsed, setElapsed] = useState(0);
  const [chatMsg, setChatMsg] = useState("");
  /** The call never unmounts while its app-owned shell is hidden or resized. */
  const [videoWindowSize, setVideoWindowSize] =
    useState<VideoWindowSize>("small");
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  /** Upload options stay folded away until asked for — they are occasional actions, and as
   * two permanent full-width buttons they were consuming screen the video should have. */
  const [materialMenuOpen, setMaterialMenuOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /**
   * The next picture to place on the whiteboard. A new `key` is what triggers the placement,
   * so uploading the same photo twice still works and a re-render never duplicates one.
   */
  const [boardDocument, setBoardDocument] = useState<{
    key: string;
    dataUrl: string;
    kind: "image" | "pdf";
  } | null>(null);
  // Native-only: stores a local file:// URI for a PDF picked via DocumentPicker.
  // Kept separate from `material` (which is broadcast over the socket) because
  // file:// paths are device-local and meaningless on other participants' devices.
  const [localPdfUri, setLocalPdfUri] = useState<string | null>(null);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [meetingToken, setMeetingToken] = useState<string | null>(null);
  /** Which implementation carries this call. The server decides; the app just mounts it. */
  const [videoProvider, setVideoProvider] = useState<string>("daily");
  const [roomError, setRoomError] = useState(false);
  /**
   * Set when this class is too old to open. Nothing about the call is set up while it is —
   * no room is requested, so no Daily room is created and the phone is never asked for the
   * camera. That request happening for a class that finished days ago is what made this feel
   * like tapping an old lesson "activates the video internally".
   */
  const [expired, setExpired] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatScrollRef = useRef<ScrollView>(null);
  const chatProgress = useRef(new Animated.Value(0)).current;
  const pipDrag = useRef(new Animated.ValueXY()).current;
  const pipOffset = useRef({ x: 0, y: 0 });
  const lastVisibleVideoSizeRef = useRef<VisibleVideoWindowSize>("small");
  const lastWindowedVideoSizeRef = useRef<WindowedVideoSize>("small");
  const lastSeenIncomingRef = useRef(0);
  const previousIncomingRef = useRef(0);

  /**
   * Excalidraw owns the outermost top and bottom bands.
   *
   * Its hamburger, drawing tools, properties controls and zoom controls live there. Floating
   * classroom chrome may cover canvas, but it must never cover the controls that make the
   * canvas usable. The top context pill starts below one full tap target; the HUD sits above
   * the bottom controls; and the PIP is clamped between them.
   */
  const boardToolbarBottom = insets.top + HIT_SLOP_MIN + space.md;
  const hudBottom = insets.bottom + HIT_SLOP_MIN + space.md;
  const pipBottomClearance = hudBottom + HIT_SLOP_MIN + space.lg;

  const videoHidden = videoWindowSize === "hidden";
  const videoFull = videoWindowSize === "full";
  const videoSmall = videoWindowSize === "small";

  // Small is a true thumbnail. Medium is the first size intended for Daily's own controls.
  const smallVideoWidth = Math.min(
    width - space.xxl,
    space.huge * (isCompact ? 4 : 6),
  );
  const mediumVideoWidth = Math.min(
    width - space.xxl,
    space.huge * (isCompact ? 7 : 10),
  );
  const pipTop =
    boardToolbarBottom +
    HIT_SLOP_MIN +
    (isLandscapeLayout ? space.xs : space.lg);
  const availableVideoHeight = Math.max(
    space.huge * 2,
    height - pipTop - pipBottomClearance,
  );
  const smallVideoHeight = Math.min(space.huge * 3, availableVideoHeight);
  const mediumVideoHeight = Math.min(
    space.huge * (isLandscapeLayout ? 5 : 6),
    availableVideoHeight,
  );
  const windowedVideoWidth = videoSmall ? smallVideoWidth : mediumVideoWidth;
  const windowedVideoHeight = videoSmall ? smallVideoHeight : mediumVideoHeight;
  const windowedVideoBaseLeft = Math.max(
    space.md,
    width - windowedVideoWidth - space.md,
  );
  const expandedVideoWidth = width - space.xxl;
  const expandedVideoHeight = Math.max(
    space.huge * 3,
    height - pipTop - hudBottom - HIT_SLOP_MIN - space.lg,
  );
  const videoWidth = videoFull ? expandedVideoWidth : windowedVideoWidth;
  const videoHeight = videoFull ? expandedVideoHeight : windowedVideoHeight;
  const videoLeft = videoFull ? space.md : windowedVideoBaseLeft;
  const noticeTop = videoHidden
    ? pipTop
    : videoFull
      ? pipTop + space.sm
      : pipTop + windowedVideoHeight + space.sm;
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
              space.md - windowedVideoBaseLeft,
              Math.min(
                pipOffset.current.x + gesture.dx,
                width - windowedVideoWidth - space.md - windowedVideoBaseLeft,
              ),
            ),
            y: Math.max(
              0,
              Math.min(
                pipOffset.current.y + gesture.dy,
                height - pipTop - windowedVideoHeight - pipBottomClearance,
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
              space.md - windowedVideoBaseLeft,
              Math.min(
                pipOffset.current.x + gesture.dx,
                width - windowedVideoWidth - space.md - windowedVideoBaseLeft,
              ),
            ),
            y: Math.max(
              0,
              Math.min(
                pipOffset.current.y + gesture.dy,
                height - pipTop - windowedVideoHeight - pipBottomClearance,
              ),
            ),
          };
          pipDrag.setValue(next);
          pipOffset.current = next;
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

  useEffect(() => {
    const next = {
      x: Math.max(
        space.md - windowedVideoBaseLeft,
        Math.min(
          pipOffset.current.x,
          width - windowedVideoWidth - space.md - windowedVideoBaseLeft,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          pipOffset.current.y,
          height - pipTop - windowedVideoHeight - pipBottomClearance,
        ),
      ),
    };
    pipOffset.current = next;
    pipDrag.setOffset({ x: 0, y: 0 });
    pipDrag.setValue(next);
  }, [
    height,
    windowedVideoBaseLeft,
    pipDrag,
    pipTop,
    pipBottomClearance,
    space.md,
    windowedVideoHeight,
    windowedVideoWidth,
    width,
  ]);

  const hideVideoWindow = useCallback(() => {
    if (videoWindowSize === "hidden") return;
    lastVisibleVideoSizeRef.current = videoWindowSize;
    if (videoWindowSize !== "full") {
      lastWindowedVideoSizeRef.current = videoWindowSize;
    }
    setVideoWindowSize("hidden");
  }, [videoWindowSize]);

  const showVideoWindow = useCallback(() => {
    setVideoWindowSize(lastVisibleVideoSizeRef.current);
  }, []);

  const toggleWindowedVideoSize = useCallback(() => {
    const next: WindowedVideoSize =
      videoWindowSize === "small" ? "medium" : "small";
    lastVisibleVideoSizeRef.current = next;
    lastWindowedVideoSizeRef.current = next;
    setVideoWindowSize(next);
  }, [videoWindowSize]);

  const toggleFullVideoWindow = useCallback(() => {
    if (videoWindowSize === "full") {
      const next = lastWindowedVideoSizeRef.current;
      lastVisibleVideoSizeRef.current = next;
      setVideoWindowSize(next);
      return;
    }

    if (videoWindowSize !== "hidden") {
      lastWindowedVideoSizeRef.current = videoWindowSize;
    }
    lastVisibleVideoSizeRef.current = "full";
    setVideoWindowSize("full");
  }, [videoWindowSize]);

  useEffect(() => {
    Animated.timing(chatProgress, {
      toValue: mode === "chat" ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [chatProgress, mode]);

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

  useEffect(() => {
    // Order matters, and this is the whole fix: find out what the class *is* before asking
    // for anything that starts a video call. Asking first is what created a Daily room and
    // set the phone asking for camera and microphone on a class that ended days ago.
    void (async () => {
      const current = await loadSession();
      if (!current) return;
      const check = canOpenSession(current);
      if (!check.ok) {
        setExpired({ title: check.title, message: check.message });
        return;
      }
      /**
       * A class the teacher ended, and has come back to, is taken live again.
       *
       * This is the entire purpose of the three-hour window: a teacher who hung up by mistake
       * gets straight back in. Without this they did not. The class stayed `completed`, the
       * screen decided it was over, threw away the room it had just been given, and showed
       * "Setting up video room…" for as long as they were willing to wait — while telling them
       * on the way past that they must have started another class, which they had not.
       *
       * The server decides whether this is allowed, not this screen: it applies the same
       * window and refuses if the teacher is already teaching something else.
       */
      if (current.status === "completed") {
        const resumed = await resumeThisClass();
        if (!resumed) return;
      }
      await loadRoom();
    })();
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [id]);

  /**
   * Take a class the teacher ended live again, and say plainly when that cannot be done.
   *
   * Returns false when the class stays closed, so the caller does not go on to ask for a video
   * room it will not be allowed to use. The refusals worth showing are the server's own: the
   * class is past the window, or this teacher is already teaching something else — that second
   * one names the other class, which is the only thing that makes it actionable.
   */
  const resumeThisClass = async (): Promise<boolean> => {
    try {
      await apiPatch(`/sessions/${id}`, { status: "live" });
      setSession((prev) => (prev ? { ...prev, status: "live" } : prev));
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setExpired({ title: "Cannot rejoin this class", message: err.message });
        return false;
      }
      // Anything else is a connection problem rather than a decision, and the video area
      // already knows how to say so.
      setRoomError(true);
      return false;
    }
  };

  const loadSession = async (): Promise<SessionData | null> => {
    try {
      const current = await apiGet<SessionData>(`/sessions/${id}`);
      setSession(current);
      return current;
    } catch {
      return null;
    }
  };

  // Daily.co rooms must be created server-side via their REST API before anyone can
  // join them — the client can no longer just guess a room URL and connect to it.
  /** Guards against two requests in flight at once — see the safety net below. */
  const roomInFlight = useRef(false);

  const loadRoom = async () => {
    if (roomInFlight.current) return;
    roomInFlight.current = true;
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
      // The server applies the same window on this endpoint, and it is the one that counts.
      // If it refuses, say so rather than showing a broken video area.
      if (err instanceof ApiError && err.status === 409) {
        setExpired({
          title: "Session already expired",
          message:
            err.message ||
            "This class ended more than 3 hours ago. Please create a new one.",
        });
        return;
      }
      // Anything else leaves the video area able to say so.
      setRoomError(true);
    } finally {
      roomInFlight.current = false;
    }
  };

  /**
   * Whether this class is actually running.
   *
   * The teacher's own screen used to ignore this entirely: when their class was ended
   * elsewhere — by starting another one, or by the server tidying up a left-over class — their
   * window carried on showing a live lesson while the students in it had been told to leave.
   * A teaching surface that lies about whether anyone can see it is worse than no surface.
   */
  const liveStatus = sessionStatus ?? session?.status ?? null;
  const classIsLive = liveStatus === "live";
  const classIsOver = liveStatus === "completed" || liveStatus === "cancelled";

  /**
   * Whether this class has been live at any point while the teacher has been on this screen.
   *
   * The difference matters and getting it wrong is what broke re-entry. A class that is over
   * *when you open it* is one you hung up on and have come back to, which the window above
   * exists to allow. A class that goes over *while you are in it* was ended somewhere else,
   * and that is worth interrupting someone for. Both used to take the second path.
   */
  const wasLiveOnThisVisit = useRef(false);
  useEffect(() => {
    if (classIsLive) wasLiveOnThisVisit.current = true;
  }, [classIsLive]);

  useEffect(() => {
    if (!classIsOver || !wasLiveOnThisVisit.current) return;
    setRoomUrl(null);
    setMeetingToken(null);
    const msg =
      "This class is no longer live. If you started another class, that one ended this one — a teacher can only run one at a time.";
    if (Platform.OS === "web") {
      window.alert(`Class ended\n\n${msg}`);
      router.back();
    } else {
      Alert.alert("Class ended", msg, [
        { text: "OK", onPress: () => router.back() },
      ]);
    }
  }, [classIsOver]);

  /**
   * A live class must never be left without a room.
   *
   * `loadRoom` used to run once, at mount. Anything that cleared the room after that — a class
   * ending and being started again, a failed first attempt — left the video area spinning
   * forever with nothing to bring it back. This is the safety net rather than the mechanism:
   * if the class is live and there is no room, ask for one.
   */
  useEffect(() => {
    if (!classIsLive || roomUrl || roomError || expired) return;
    void loadRoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classIsLive, roomUrl, roomError, expired]);

  const [starting, setStarting] = useState(false);

  /** Take an unstarted class live from inside the room, rather than sending them back out. */
  const startThisClass = async () => {
    setStarting(true);
    try {
      await apiPatch(`/sessions/${id}`, { status: "live" });
      setSession((prev) => (prev ? { ...prev, status: "live" } : prev));
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 409
          ? err.message
          : "That class could not be started. Please check your connection and try again.";
      if (Platform.OS === "web")
        window.alert(`Cannot start this class\n\n${message}`);
      else Alert.alert("Cannot start this class", message);
    } finally {
      setStarting(false);
    }
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60)
      .toString()
      .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const nextBoardKey = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const applyUploadedFile = (source: string, kind: "image" | "pdf") => {
    /**
     * What may go on the board is decided by whether we are holding bytes, not by which
     * platform we are on. This used to ask `Platform.OS !== "web"` and send every PDF picked
     * on a phone to the local viewer — which was right while the phone only had a `file://`
     * path, and wrong the moment it could read one. A device-local path still cannot be
     * shared, so it still opens here alone, with the banner saying so.
     */
    if (!isShareableSource(source)) {
      if (kind === "pdf") {
        setLocalPdfUri(source);
        clearMaterial();
        return;
      }
      // A picture always reaches this point as bytes; if it has not, something upstream is
      // broken and silently putting an unopenable path on the board is the worst answer.
      reportUploadError(
        "That picture could not be prepared for sharing. Please try again.",
      );
      return;
    }

    // Bytes go to the board, which turns a PDF into pages and places a photo as a single
    // picture. Both end up as ordinary objects the whole class can see.
    setLocalPdfUri(null);
    setBoardDocument({ key: nextBoardKey(), dataUrl: source, kind });
    clearMaterial();
  };

  const reportUploadError = (message: string) => {
    setUploadError(message);
    if (Platform.OS === "web") window.alert(message);
    else Alert.alert("Upload Failed", message);
  };

  const handleWebFileSelected = async (file: File) => {
    setUploadError(null);
    try {
      // The name is consulted when the type is missing, which is the ordinary case for a PDF
      // picked from an Android file manager. Asking only about the type is what made every
      // such PDF fail with "could not be opened as an image". See utils/pickedFile.ts.
      if (looksLikePdf(file)) {
        if (file.size > MAX_PDF_BYTES) {
          reportUploadError(
            "This PDF is too large to share on the board. Please use one under 8 MB.",
          );
          return;
        }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Could not read that PDF."));
          reader.readAsDataURL(file);
        });
        applyUploadedFile(dataUrl, "pdf");
        return;
      }
      applyUploadedFile(
        await prepareBoardImage({ platform: "web", file }),
        "image",
      );
    } catch (err) {
      reportUploadError(
        err instanceof BoardImageError
          ? err.message
          : "Could not upload that file. Please try again.",
      );
    }
  };

  // Split into two distinct pickers: iOS's WKWebView file input only offers the Photo
  // Library picker when `accept` is scoped to images alone — mixing in `application/pdf`
  // forces iOS to fall back to the Files app for both. Two separate inputs/buttons let each
  // one open the picker the user actually expects (Photo Library vs Files).
  const handleUploadPhoto = async () => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        handleWebFileSelected(file);
      };
      input.click();
      return;
    }

    // Use the native Expo image picker (UIImagePickerController) instead of the generic
    // document picker — on iOS, DocumentPicker's "image" file type still routes through
    // the Files app browser rather than the Photo Library, which is not what users expect
    // from an "Upload Photo" button. expo-image-picker opens the actual Photo Library.
    setUploadError(null);
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Permission Needed",
          "Photo Library access is required to upload a photo.",
        );
        return;
      }
      // base64 is required, not just convenient: the picker's `file://` URI only resolves on
      // this device, so broadcasting it would leave every student with a broken image.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: NATIVE_PICKER_QUALITY,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      applyUploadedFile(
        await prepareBoardImage({
          platform: "native",
          asset: result.assets[0],
        }),
        "image",
      );
    } catch (err) {
      reportUploadError(
        err instanceof BoardImageError
          ? err.message
          : "Could not upload the photo. Please try again.",
      );
    }
  };

  const handleUploadPdf = async () => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      // The extension matters as much as the MIME type. On iOS Safari a bare
      // `application/pdf` leaves every PDF greyed out in the Files browser — the picker
      // matches on the file's type identifier, and without `.pdf` it disables the very
      // files this button exists to choose. Reported from a real iPhone.
      // Both forms, deliberately. iOS matches on the type identifier and greys out every PDF
      // without the extension present; Android matches on the MIME type and ignores the
      // extension. Naming both is the only spelling that works on both.
      input.accept = "application/pdf,.pdf";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        handleWebFileSelected(file);
      };
      input.click();
      return;
    }

    setUploadError(null);
    try {
      const doc = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf"],
        copyToCacheDirectory: true,
      });
      if (doc.canceled || !doc.assets?.[0]) return;
      const asset = doc.assets[0];
      // Bytes if it could be read, the local path if it could not — see utils/pickedPdf.ts.
      // Either way the PDF is not lost: what changes is whether the class can see it.
      const picked = await preparePickedPdf(
        asset.uri,
        (uri) => new FsFile(uri),
      );
      if (!picked.shareable) {
        // Saying why matters: "too large" is something a teacher can act on by splitting the
        // file, where a silent local-only PDF taught them nothing.
        reportUploadError(picked.reason);
        applyUploadedFile(picked.localUri, "pdf");
        return;
      }
      applyUploadedFile(picked.dataUrl, "pdf");
    } catch {
      Alert.alert(
        "Upload Failed",
        "Could not upload the PDF. Please try again.",
      );
    }
  };

  // Called when the teacher clicks Daily's native Leave button. No confirmation dialog
  // here — the user already made an explicit in-call gesture, so we just clean up
  // immediately: mark the session completed and return to the dashboard.
  /**
   * Get out of this screen, whatever route brought us here.
   *
   * The same trap the student's classroom had: a teacher who arrived from a link, a
   * notification, or their monthly class's page has nothing behind them on the stack, so
   * `router.back()` alone leaves them sitting in the call they just ended.
   */
  const leaveScreen = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(teacher)/sessions");
  }, []);

  const handleDailyLeft = useCallback(async () => {
    // Drop the room URL before navigating. DailyEmbed tears the call down in its effect
    // cleanup, and clearing the URL makes that run immediately instead of waiting for the
    // screen to unmount — a navigation stack may keep this screen alive, and until the frame
    // is destroyed the camera and microphone stay on with the recording light lit.
    setRoomUrl(null);
    setMeetingToken(null);
    try {
      await apiPatch(`/sessions/${id}`, { status: "completed" });
    } catch {}
    // The class is over, so withdraw its "starts in 30 minutes" reminder. Reminders were
    // scheduled at creation and never cancelled, which is why finished sessions kept
    // notifying.
    try {
      await cancelSessionReminder(String(id));
    } catch {}
    leaveScreen();
  }, [id, leaveScreen]);

  /**
   * The class's own clock, running while the call is.
   *
   * Five minutes before the booked finish the room is told; ten minutes past it the call is
   * ended, after the room has been told that too. The rules live in utils/sessionWindow.ts so
   * this screen and the student's read the same clock — a call that stopped for one of them
   * and not the other would be worse than no limit at all.
   */
  const endBecauseTimeIsUp = useCallback(() => {
    setRoomUrl(null);
    setMeetingToken(null);
    void apiPatch(`/sessions/${id}`, { status: "completed" }).catch(() => {});
    void cancelSessionReminder(String(id)).catch(() => {});
    leaveScreen();
  }, [id, leaveScreen]);

  // Presence (from the live WebSocket room) is the source of truth once connected — it
  // starts at 0 the moment the teacher starts the session (server force-clears any stale
  // "ghost" entries on start). Falling back to enrolledCount before the socket connects
  // caused a stale avatar/count to render even when nobody is actually present.
  const participantCount = connected ? presenceCount : 0;

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
    onCutoff: endBecauseTimeIsUp,
  });

  /**
   * A teacher sitting in an empty room, on the same fifteen minutes as a waiting student.
   *
   * The owner asked for both halves: *"Same thing at the teachers end if there is no student
   * who has joined — teacher can also only stay active for 15 minutes if 0 students have
   * joined."* Five quiet minutes in case somebody is just slow, then ten with the way out on
   * screen, then the call ends itself. Starting it again from Sessions gives another fifteen.
   *
   * `presenceCount` counts students, never the teacher, so nobody having arrived really is
   * zero — see the participant label further down.
   */
  const aloneTeacher = useAloneInCall({
    alone: participantCount === 0,
    active: !!roomUrl && !expired,
    onCutoff: endBecauseTimeIsUp,
  });

  const endSession = async () => {
    const doEnd = async () => {
      setRoomUrl(null);
      setMeetingToken(null); // release camera/mic before leaving — see handleDailyLeft above
      try {
        await apiPatch(`/sessions/${id}`, { status: "completed" });
      } catch {}
      try {
        await cancelSessionReminder(String(id));
      } catch {}
      leaveScreen();
    };
    if (Platform.OS === "web") {
      if (
        window.confirm(
          "End Session?\n\nThis will mark the session as completed.",
        )
      )
        await doEnd();
    } else {
      Alert.alert("End Session?", "This will mark the session as completed.", [
        { text: "Cancel", style: "cancel" },
        { text: "End Session", style: "destructive", onPress: doEnd },
      ]);
    }
  };

  const sendMessage = () => {
    if (!chatMsg.trim()) return;
    sendChat(chatMsg.trim());
    setChatMsg("");
    setTimeout(
      () => chatScrollRef.current?.scrollToEnd({ animated: true }),
      100,
    );
  };

  /**
   * A class too old to open gets this instead of a classroom.
   *
   * Returned before anything else renders, so no video area is mounted, no board socket is
   * used for teaching and nothing on this screen suggests a lesson is running. Someone can
   * still arrive here from a stale link or a back-stack entry; this is what they get.
   */
  if (expired) {
    return (
      <View
        style={[
          s.container,
          s.expiredScreen,
          {
            gap: space.md,
            paddingTop: insets.top,
            paddingHorizontal: space.xxl,
            backgroundColor: colors.background,
          },
        ]}
      >
        <Feather name="clock" size={44} color={colors.warn} />
        <Text
          style={[t.title2, { color: colors.foreground, textAlign: "center" }]}
        >
          {expired.title}
        </Text>
        <Text
          style={[
            t.body,
            { color: colors.mutedForeground, textAlign: "center" },
          ]}
        >
          {expired.message}
        </Text>
        <TouchableOpacity
          style={[
            s.expiredBtn,
            {
              gap: space.xs,
              marginTop: space.xs,
              minHeight: HIT_SLOP_MIN,
              paddingHorizontal: space.lg,
              borderRadius: radius.md,
              backgroundColor: colors.primary,
            },
          ]}
          onPress={() => router.replace("/(teacher)/session-create")}
          activeOpacity={0.85}
        >
          <Feather name="plus" size={16} color={colors.primaryForeground} />
          <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>
            Create a new session
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.expiredBackButton, { minHeight: HIT_SLOP_MIN }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Text style={[t.caption, { color: colors.mutedForeground }]}>
            Back to my sessions
          </Text>
        </TouchableOpacity>
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
                top: boardToolbarBottom,
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
                {session
                  ? `${session.subject}: ${session.topic}`
                  : "Live session"}
              </Text>
              <Text
                style={[t.overline, numeric, { color: colors.mutedForeground }]}
              >
                {fmt(elapsed)} /{" "}
                {String(session?.duration ?? 60).padStart(2, "0")}:00
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

        {/* Presence — do not render avatar bubbles or an "active" count at all when
            nobody is actually present, so a ghost participant never shows up. */}
        {participantCount > 0 && !videoFull && !isCompact && (
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
              {participantCount}{" "}
              {participantCount === 1 ? "student" : "students"}
            </Text>
          </View>
        )}

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
              text="The live board couldn't be opened for this class. Check that you're signed in as the teacher who created it."
            />
          ) : null}

          {!classIsLive && !classIsOver ? (
            <FloatingNotice
              tone="warning"
              icon="eye-off"
              text="This class has not started, so nothing you draw is shared yet. Start it when you are ready."
              actionLabel={starting ? "Starting…" : "Start class"}
              actionKind="primary"
              actionDisabled={starting}
              onAction={startThisClass}
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

          {aloneTeacher.phase === "warned" ? (
            <FloatingNotice
              tone="warning"
              icon="user-x"
              text={aloneMessage("students", aloneTeacher.minutesLeft)}
              actionLabel="End"
              actionKind="tone"
              onAction={endBecauseTimeIsUp}
            />
          ) : null}

          {localPdfUri !== null ? (
            <FloatingNotice
              tone="warning"
              icon="eye-off"
              text="Students cannot see this local PDF. Close it and upload a photo of the page to share it on the board."
              onClose={() => setLocalPdfUri(null)}
            />
          ) : null}

          {materialRejected ? (
            <FloatingNotice
              tone="destructive"
              icon="alert-circle"
              text={materialRejected}
              onClose={clearMaterialRejected}
            />
          ) : null}

          {uploadError ? (
            <FloatingNotice
              tone="destructive"
              icon="alert-circle"
              text={uploadError}
              onClose={() => setUploadError(null)}
            />
          ) : null}
        </View>

        {/* Only the visible capsule captures touches; its full-screen layer is transparent. */}
        <View
          pointerEvents={mode === "chat" ? "none" : "box-none"}
          style={[
            s.hudLayer,
            { bottom: hudBottom },
            mode === "chat" && s.overlayHidden,
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
                  backgroundColor: materialMenuOpen
                    ? colors.actionSoft
                    : colors.card,
                },
              ]}
              onPress={() => {
                setMode("whiteboard");
                setMaterialMenuOpen((open) => !open);
              }}
              activeOpacity={0.75}
              accessibilityLabel="Add teaching material"
            >
              <Feather
                name="paperclip"
                size={18}
                color={
                  materialMenuOpen ? colors.primary : colors.mutedForeground
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
                  backgroundColor:
                    mode === "chat" ? colors.actionSoft : colors.card,
                },
              ]}
              onPress={() =>
                setMode((current) =>
                  current === "chat" ? "whiteboard" : "chat",
                )
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
              onPress={endSession}
              activeOpacity={0.75}
              accessibilityLabel="End session"
            >
              <Feather name="phone-off" size={18} color={colors.destructive} />
            </TouchableOpacity>
          </View>
        </View>

        {videoHidden && mode !== "chat" ? (
          <View
            pointerEvents="box-none"
            style={[
              s.callDockLayer,
              {
                bottom: hudBottom + HIT_SLOP_MIN + space.md,
                paddingRight: space.md,
              },
            ]}
          >
            <TouchableOpacity
              style={[
                s.showCallButton,
                elevation.sheet,
                {
                  minHeight: HIT_SLOP_MIN,
                  gap: space.xs,
                  paddingHorizontal: space.md,
                  borderRadius: radius.pill,
                  backgroundColor: colors.card,
                  borderColor: colors.primary,
                },
              ]}
              onPress={showVideoWindow}
              activeOpacity={0.75}
              accessibilityLabel="Show call window"
            >
              <Feather name="video" size={18} color={colors.primary} />
              <Text style={[t.caption, { color: colors.primary }]}>
                Show call
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Daily stays mounted through hide and every size change; only its shell moves. */}
        <View style={s.contentArea}>
          <Animated.View
            pointerEvents={mode === "chat" || videoHidden ? "none" : "auto"}
            style={[
              s.videoArea,
              elevation.sheet,
              {
                top: pipTop,
                left: videoLeft,
                width: videoWidth,
                height: videoHeight,
                borderRadius: videoFull ? radius.lg : radius.md,
                backgroundColor: colors.secondary,
                borderColor: colors.lineStrong,
                transform: videoFull ? [] : pipDrag.getTranslateTransform(),
              },
              (mode === "chat" || videoHidden) && s.videoAreaHidden,
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
                  accessibilityLabel="Drag video window"
                >
                  <View
                    style={[
                      s.pipGrip,
                      { backgroundColor: colors.onInverseMuted },
                    ]}
                  />
                </View>
              ) : (
                <View style={s.callDragZone} />
              )}

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
                >
                  <Feather name="eye-off" size={18} color={colors.onInverse} />
                  <Text style={[t.caption, { color: colors.onInverse }]}>
                    Hide
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    s.callFrameButton,
                    { width: HIT_SLOP_MIN, height: HIT_SLOP_MIN },
                  ]}
                  onPress={toggleWindowedVideoSize}
                  accessibilityLabel={
                    videoSmall
                      ? "Make call window medium"
                      : "Make call window small"
                  }
                  testID="video-window-size-btn"
                >
                  <Feather
                    name={videoSmall ? "maximize" : "minimize"}
                    size={18}
                    color={colors.onInverse}
                  />
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
            </View>

            <View style={s.callFrameBody}>
              {roomUrl ? (
                <VideoCall
                  provider={videoProvider}
                  roomUrl={roomUrl}
                  token={meetingToken}
                  displayName={teacherName}
                  style={StyleSheet.absoluteFill}
                  onLeft={handleDailyLeft}
                  canScreenShare
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
                    {roomError
                      ? "Couldn't set up the video room."
                      : "Setting up video room…"}
                  </Text>
                </View>
              )}
            </View>
          </Animated.View>
          <View style={[s.boardArea, { paddingTop: insets.top }]}>
            {/* Whiteboard. Scoped to its own boundary so a board rendering failure shows a
            recoverable message here instead of unmounting the app — which would also tear
            down the video call the class is running on. */}
            <ErrorBoundary FallbackComponent={WhiteboardFallback}>
              <View pointerEvents="box-none" style={s.whiteboardArea}>
                {materialMenuOpen && (
                  <View
                    pointerEvents="auto"
                    style={[
                      s.materialMenu,
                      elevation.sheet,
                      {
                        left: space.md,
                        right: space.md,
                        bottom: hudBottom + HIT_SLOP_MIN + space.lg,
                        gap: space.xs,
                        padding: space.sm,
                        borderRadius: radius.lg,
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View style={s.materialHeader}>
                      <View style={s.sessionInfo}>
                        <Text style={[t.title3, { color: colors.foreground }]}>
                          Add material
                        </Text>
                        <Text
                          style={[t.caption, { color: colors.mutedForeground }]}
                        >
                          Photos and PDFs are placed on the shared board.
                        </Text>
                      </View>
                      {(boardDocument || localPdfUri) && (
                        <TouchableOpacity
                          style={[
                            s.materialClear,
                            {
                              minHeight: HIT_SLOP_MIN,
                              paddingHorizontal: space.sm,
                              borderRadius: radius.sm,
                              borderColor: colors.destructive,
                            },
                          ]}
                          onPress={() => {
                            clearMaterial();
                            setLocalPdfUri(null);
                            setBoardDocument(null);
                            setUploadError(null);
                            setMaterialMenuOpen(false);
                          }}
                          activeOpacity={0.75}
                        >
                          <Feather
                            name="trash-2"
                            size={16}
                            color={colors.destructive}
                          />
                          <Text
                            style={[t.caption, { color: colors.destructive }]}
                          >
                            Clear
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={[s.materialActions, { gap: space.xs }]}>
                      {Platform.OS === "web" ? (
                        <>
                          <View
                            style={[
                              s.materialBtn,
                              {
                                gap: space.xs,
                                minHeight: HIT_SLOP_MIN,
                                borderRadius: radius.sm,
                                backgroundColor: colors.primary,
                              },
                            ]}
                          >
                            <Feather
                              name="image"
                              size={16}
                              color={colors.primaryForeground}
                              pointerEvents="none"
                            />
                            <Text
                              style={[
                                t.caption,
                                { color: colors.primaryForeground },
                              ]}
                              pointerEvents="none"
                            >
                              Photo
                            </Text>
                            {React.createElement("input", {
                              type: "file",
                              accept: "image/*",
                              onChange: (e: any) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                handleWebFileSelected(file);
                                e.target.value = "";
                                setMaterialMenuOpen(false);
                              },
                              style: {
                                position: "absolute",
                                inset: 0,
                                width: "100%",
                                height: "100%",
                                opacity: 0,
                                cursor: "pointer",
                                zIndex: 9999,
                              },
                            })}
                          </View>
                          <View
                            style={[
                              s.materialBtn,
                              {
                                gap: space.xs,
                                minHeight: HIT_SLOP_MIN,
                                borderRadius: radius.sm,
                                backgroundColor: colors.primary,
                              },
                            ]}
                          >
                            <Feather
                              name="file-text"
                              size={16}
                              color={colors.primaryForeground}
                              pointerEvents="none"
                            />
                            <Text
                              style={[
                                t.caption,
                                { color: colors.primaryForeground },
                              ]}
                              pointerEvents="none"
                            >
                              PDF
                            </Text>
                            {React.createElement("input", {
                              type: "file",
                              // Both spellings, and this is the input the teacher actually taps on
                              // the web — the earlier fix went to the native-picker path and never
                              // reached here, which is why PDFs were still greyed out. iOS matches
                              // on the type identifier and disables every PDF without the
                              // extension; Android matches on the MIME type and ignores it.
                              accept: "application/pdf,.pdf",
                              onChange: (e: any) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                handleWebFileSelected(file);
                                e.target.value = "";
                                setMaterialMenuOpen(false);
                              },
                              style: {
                                position: "absolute",
                                inset: 0,
                                width: "100%",
                                height: "100%",
                                opacity: 0,
                                cursor: "pointer",
                                zIndex: 9999,
                              },
                            })}
                          </View>
                        </>
                      ) : (
                        <>
                          <TouchableOpacity
                            style={[
                              s.materialBtn,
                              {
                                gap: space.xs,
                                minHeight: HIT_SLOP_MIN,
                                borderRadius: radius.sm,
                                backgroundColor: colors.primary,
                              },
                            ]}
                            onPress={() => {
                              setMaterialMenuOpen(false);
                              handleUploadPhoto();
                            }}
                            activeOpacity={0.8}
                          >
                            <Feather
                              name="image"
                              size={16}
                              color={colors.primaryForeground}
                            />
                            <Text
                              style={[
                                t.caption,
                                { color: colors.primaryForeground },
                              ]}
                            >
                              Photo
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[
                              s.materialBtn,
                              {
                                gap: space.xs,
                                minHeight: HIT_SLOP_MIN,
                                borderRadius: radius.sm,
                                backgroundColor: colors.primary,
                              },
                            ]}
                            onPress={() => {
                              setMaterialMenuOpen(false);
                              handleUploadPdf();
                            }}
                            activeOpacity={0.8}
                          >
                            <Feather
                              name="file-text"
                              size={16}
                              color={colors.primaryForeground}
                            />
                            <Text
                              style={[
                                t.caption,
                                { color: colors.primaryForeground },
                              ]}
                            >
                              PDF
                            </Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                    {/* A way out that is not the browser's Back button. Without it the only exit
                    from this menu was Back, which a teacher reasonably feared would drop them
                    out of the class they were teaching. */}
                    <TouchableOpacity
                      style={[
                        s.materialCancel,
                        {
                          gap: space.xs,
                          minHeight: HIT_SLOP_MIN,
                          paddingHorizontal: space.sm,
                          borderRadius: radius.sm,
                          borderColor: colors.lineStrong,
                        },
                      ]}
                      onPress={() => setMaterialMenuOpen(false)}
                      activeOpacity={0.8}
                    >
                      <Feather
                        name="x"
                        size={16}
                        color={colors.mutedForeground}
                      />
                      <Text
                        style={[t.caption, { color: colors.mutedForeground }]}
                      >
                        Cancel
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                <View style={s.canvasScrollWrap}>
                  {/* PDF mode: render the document in the platform's native PDF viewer.
                  No pdf.js, no off-screen canvas allocation, no main-thread rasterization.
                  - Web: <iframe> — Chrome/Safari's built-in PDF plugin renders it.
                  - Native: WebView with the local file:// URI picked by DocumentPicker. */}
                  {localPdfUri !== null ? (
                    // Shown to the teacher only, and never broadcast — see applyUploadedFile.
                    Platform.OS === "web" ? (
                      React.createElement("iframe", {
                        src: localPdfUri,
                        title: "PDF document",
                        style: {
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: "100%",
                          border: "none",
                          borderRadius: 0,
                        },
                      })
                    ) : (
                      <PdfViewer
                        uri={localPdfUri}
                        style={StyleSheet.absoluteFill}
                      />
                    )
                  ) : (
                    /* The whiteboard proper. Excalidraw owns the whole surface: its own tools,
                   colours, undo, zoom, object handling and the controls for them. Nothing is
                   duplicated around it — a second row of pens below the board drove a drawing
                   engine that had already been replaced, so every one of those buttons was
                   dead. A shared photo sits behind the ink, which is why the board's own
                   background is transparent. */
                    <>
                      {/* Keyed by the class, so opening the next lesson starts on a blank board.
                      This screen is one route with a changing id, so without it the component
                      is reused and the previous lesson's working comes along for the ride. */}
                      <SmartBoard
                        key={id}
                        sceneUpdates={sceneUpdates}
                        onConsumeUpdates={consumeSceneUpdates}
                        onSceneChange={sendSceneUpdate}
                        onViewportChange={sendBoardView}
                        onClearAll={sendBoardClear}
                        insertDocument={boardDocument}
                        /* A document the board never acknowledged. On a phone the board is a WebView, and a
                       large file can be dropped on the way in rather than refused — which looks exactly
                       like a board still thinking. Better to say so than to leave a teacher waiting in
                       front of a class. */
                        onDocumentLost={() =>
                          reportUploadError(
                            "The whiteboard did not receive that file — it may be too large for this phone. " +
                              "Try a smaller PDF, or share a photo of the page instead.",
                          )
                        }
                        clearedAt={boardClearedAt}
                      />
                    </>
                  )}
                </View>
              </View>
            </ErrorBoundary>
            {/* The transparent layer is inert while closed; the scrim and sheet alone capture. */}
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
                  onPress={() => setMode("whiteboard")}
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
                    onPress={() => setMode("whiteboard")}
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
                  ref={chatScrollRef}
                  style={s.flex}
                  contentContainerStyle={[
                    s.chatMessages,
                    { gap: space.sm, padding: space.md },
                  ]}
                  keyboardShouldPersistTaps="handled"
                  onContentSizeChange={() =>
                    chatScrollRef.current?.scrollToEnd({ animated: false })
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
                      Students’ messages will appear here.
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
                    placeholder="Message students…"
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
  expiredScreen: { alignItems: "center", justifyContent: "center" },
  expiredBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  expiredBackButton: { alignItems: "center", justifyContent: "center" },
  boardFallback: { flex: 1, justifyContent: "center", alignItems: "center" },
  boardFallbackBtn: { alignItems: "center", justifyContent: "center" },
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
  hudButton: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  callDockLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "flex-end",
    zIndex: 100,
  },
  showCallButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  chatBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  overlayHidden: { opacity: 0 },
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
  callFrameBody: { flex: 1, position: "relative" },
  permissionGate: { alignItems: "center", justifyContent: "center" },
  boardArea: { flex: 1, overflow: "hidden" },
  whiteboardArea: { flex: 1 },
  canvasScrollWrap: { flex: 1, position: "relative", overflow: "hidden" },
  materialMenu: { position: "absolute", borderWidth: 1, zIndex: 110 },
  materialHeader: { flexDirection: "row", alignItems: "center" },
  materialActions: { flexDirection: "row" },
  materialBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
  },
  materialClear: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  materialCancel: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
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
