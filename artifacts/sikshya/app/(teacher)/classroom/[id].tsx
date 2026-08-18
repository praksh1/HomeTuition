import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ScreenOrientation from "expo-screen-orientation";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import Svg, { Path, Line, Circle, Text as SvgText, Polygon } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import type { Teacher } from "@/context/AuthContext";
import { apiGet, apiPatch } from "@/utils/api";
import { useClassroomSocket, type DrawPath, type DrawTool } from "@/hooks/useClassroomSocket";
import DailyEmbed from "@/components/DailyEmbed";
import WhiteboardCanvas, { ERASER_SIZES, type Instrument } from "@/components/WhiteboardCanvas";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Image } from "react-native";
import PdfViewer from "@/components/PdfViewer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { ErrorFallbackProps } from "@/components/ErrorFallback";
import { prepareBoardImage, BoardImageError, NATIVE_PICKER_QUALITY } from "@/utils/boardImage";
import { cancelSessionReminder } from "@/utils/notifications";
import { MIN_CONFIDENCE, recognizeShape, squareUp, toDrawPath, type Point as BoardPoint } from "../../../components/smartboard";

const SCREEN_W = Dimensions.get("window").width;
type Mode = "whiteboard" | "participants" | "chat";

const COLORS_PALETTE = ["#0D0D0D", "#C41E3A", "#1A365D", "#16A34A", "#F5A623", "#8B5CF6", "#FFFFFF"];
const PEN_SIZES = [3, 6, 10];

/** Shape and text tools — anything that is not freehand drawing. */
const TOOLS: { id: DrawTool; icon: keyof typeof Feather.glyphMap; label: string }[] = [
  { id: "line", icon: "minus", label: "Line" },
  { id: "arrow", icon: "arrow-up-right", label: "Arrow" },
  { id: "rect", icon: "square", label: "Rectangle" },
  { id: "circle", icon: "circle", label: "Circle" },
  { id: "text", icon: "type", label: "Text" },
];

/** Freehand instruments. Each lays down ink differently — see INSTRUMENTS in the canvas. */
const PENS: { id: Instrument; icon: keyof typeof Feather.glyphMap; label: string }[] = [
  { id: "pen", icon: "edit-3", label: "Pen" },
  { id: "marker", icon: "edit-2", label: "Marker" },
  { id: "highlighter", icon: "feather", label: "Highlighter" },
  { id: "pencil", icon: "pen-tool", label: "Pencil" },
];

function renderShape(p: DrawPath, i: number) {
  switch (p.tool) {
    case "line":
      return <Line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.color} strokeWidth={p.width} strokeLinecap="round" />;
    case "arrow": {
      const x1 = p.x1 ?? 0, y1 = p.y1 ?? 0, x2 = p.x2 ?? 0, y2 = p.y2 ?? 0;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = Math.max(10, p.width * 3);
      const p1x = x2 - headLen * Math.cos(angle - Math.PI / 7);
      const p1y = y2 - headLen * Math.sin(angle - Math.PI / 7);
      const p2x = x2 - headLen * Math.cos(angle + Math.PI / 7);
      const p2y = y2 - headLen * Math.sin(angle + Math.PI / 7);
      return (
        <React.Fragment key={i}>
          <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={p.color} strokeWidth={p.width} strokeLinecap="round" />
          <Polygon points={`${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}`} fill={p.color} />
        </React.Fragment>
      );
    }
    case "circle": {
      const cx = p.cx ?? 0, cy = p.cy ?? 0, r = p.r ?? 0;
      return <Circle key={i} cx={cx} cy={cy} r={r} stroke={p.color} strokeWidth={p.width} fill="none" />;
    }
    case "text":
      return (
        <SvgText key={i} x={p.x} y={p.y} fill={p.color} fontSize={Math.max(14, p.width * 6)} fontWeight="600">
          {p.text}
        </SvgText>
      );
    case "pen":
    default:
      return <Path key={i} d={p.d} stroke={p.color} strokeWidth={p.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  }
}

interface SessionData {
  id: number; topic: string; subject: string; teacherName: string;
  duration: number; maxStudents: number; enrolledCount: number; status: string;
}


const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

function WhiteboardFallback({ resetError }: ErrorFallbackProps) {
  return (
    <View style={s.boardFallback}>
      <Feather name="alert-triangle" size={30} color="#F5A623" />
      <Text style={s.boardFallbackTitle}>The whiteboard stopped responding</Text>
      <Text style={s.boardFallbackBody}>
        Your video call is still running. Reload the board to keep teaching — if it happens again,
        try a smaller image.
      </Text>
      <TouchableOpacity style={s.boardFallbackBtn} onPress={resetError} activeOpacity={0.8}>
        <Text style={s.boardFallbackBtnText}>Reload Board</Text>
      </TouchableOpacity>
    </View>
  );
}

interface Point { x: number; y: number }

/**
 * Keeps the scaled board covering the viewport. With `transformOrigin: 0 0` the content
 * spans [pan, pan + size * zoom], so pan must stay within [size * (1 - zoom), 0].
 */
function clampPan(pan: Point, zoom: number, viewport: { w: number; h: number }): Point {
  const minX = Math.min(0, viewport.w * (1 - zoom));
  const minY = Math.min(0, viewport.h * (1 - zoom));
  return {
    x: Math.min(0, Math.max(minX, pan.x)),
    y: Math.min(0, Math.max(minY, pan.y)),
  };
}

export default function Classroom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const teacher = user as Teacher;
  if (!teacher || teacher.role !== "teacher") return null;

  const teacherName = teacher.name ?? "Teacher";

  /**
   * Side by side once there is room for it.
   *
   * Stacked, the board only ever got a slice of the height and felt cramped no matter what
   * the tools did. Beside the video it gets the full height of the screen, which is what a
   * teaching surface needs. Below this width two columns would leave both too narrow to use,
   * so a phone in portrait keeps the stacked layout.
   */
  const { width: winW } = useWindowDimensions();
  const sideBySide = winW >= 900;

  const { connected, accessDenied, presenceCount, messages, material, boardClearedAt, sendChat, sendDrawCommit, sendBoardClear, sendMaterial, clearMaterial, sendBoardSize } =
    useClassroomSocket({ sessionId: id ?? "", name: teacherName, role: "teacher" });

  const [session, setSession] = useState<SessionData | null>(null);
  const [mode, setMode] = useState<Mode>("whiteboard");
  const [paths, setPaths] = useState<DrawPath[]>([]);
  /** Strokes taken off the board by undo, available until the next new stroke. */
  const [redoStack, setRedoStack] = useState<DrawPath[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [tool, setTool] = useState<DrawTool>("pen");
  const [previewShape, setPreviewShape] = useState<DrawPath | null>(null);
  /**
   * Whether rough strokes are snapped to clean shapes.
   *
   * On by default because it is the feature that makes a diagram legible on a phone screen, but
   * it must be switchable: a teacher drawing freehand art, or writing large, wants their own
   * line kept exactly as drawn.
   */
  const [smartShapes, setSmartShapes] = useState(true);
  const [textModalVisible, setTextModalVisible] = useState(false);
  const [textInputValue, setTextInputValue] = useState("");
  const pendingTextPoint = useRef<{ x: number; y: number } | null>(null);

  /**
   * A new class starts on a blank board.
   *
   * This screen is one route with a changing id, so opening the next class reuses the same
   * component instance and its strokes came along for the ride — the teacher opened a fresh
   * lesson and found the last one's working still on the board. The server clears its own copy
   * when the class goes live; this clears the local one.
   */
  useEffect(() => {
    setPaths([]);
    setRedoStack([]);
    setPreviewShape(null);
    setCurrentPath("");
  }, [id]);

  /**
   * The server wipes the board when the class goes live, which also covers restarting the same
   * session id. Follow it, or the teacher keeps ink that nobody else can see.
   */
  useEffect(() => {
    if (boardClearedAt === 0) return;
    setPaths([]);
    setRedoStack([]);
    setPreviewShape(null);
    setCurrentPath("");
  }, [boardClearedAt]);

  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const [penColor, setPenColor] = useState("#0D0D0D");
  const [penSize, setPenSize] = useState(3);
  const [isEraser, setIsEraser] = useState(false);
  const [instrument, setInstrument] = useState<Instrument>("pen");
  const [eraserWidth, setEraserWidth] = useState<number>(ERASER_SIZES[1]);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [chatMsg, setChatMsg] = useState("");
  const [isLandscape, setIsLandscape] = useState(false);
  const [videoExpanded, setVideoExpanded] = useState(false);
  /** Upload options stay folded away until asked for — they are occasional actions, and as
   * two permanent full-width buttons they were consuming screen the video should have. */
  const [materialMenuOpen, setMaterialMenuOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isPanMode, setIsPanMode] = useState(false);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Native-only: stores a local file:// URI for a PDF picked via DocumentPicker.
  // Kept separate from `material` (which is broadcast over the socket) because
  // file:// paths are device-local and meaningless on other participants' devices.
  const [localPdfUri, setLocalPdfUri] = useState<string | null>(null);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [meetingToken, setMeetingToken] = useState<string | null>(null);
  const [roomError, setRoomError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatScrollRef = useRef<ScrollView>(null);

  // The canvas exposes both PanResponder handlers and raw onTouch* handlers so that mouse
  // and touch input both work. Both fire for the same touch on native, which would process
  // every gesture twice — the first handler to fire claims the gesture and the other is
  // ignored until it ends.
  const gestureOwnerRef = useRef<"responder" | "touch" | null>(null);
  const panDragRef = useRef<{ from: Point; pan: Point } | null>(null);

  // Gesture callbacks read view transform state through refs so an in-flight drag always
  // sees the latest values, never a value captured by an earlier render's closure.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const isPanModeRef = useRef(isPanMode);
  isPanModeRef.current = isPanMode;

  useEffect(() => {
    loadSession();
    loadRoom();
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [id]);

  const loadSession = async () => {
    try { setSession(await apiGet<SessionData>(`/sessions/${id}`)); } catch {}
  };

  // Daily.co rooms must be created server-side via their REST API before anyone can
  // join them — the client can no longer just guess a room URL and connect to it.
  const loadRoom = async () => {
    try {
      const { roomUrl: url, token } = await apiGet<{ roomUrl: string; token?: string | null }>(`/sessions/${id}/room`);
      setRoomUrl(url);
      setMeetingToken(token ?? null);
      setRoomError(false);
    } catch {
      setRoomError(true);
    }
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const toggleLandscape = async () => {
    try {
      if (isLandscape) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      }
      setIsLandscape((v) => !v);
    } catch {}
  };

  // NOTE: the old gesture pipeline (handleGesture*/toBoardPoint/PanResponder/onTouch*) used
  // to live here. It is gone: WhiteboardCanvas owns input now, via pointer events on web so
  // mouse, finger and stylus all work, and PanResponder on native.

  const applyZoom = useCallback((next: number) => {
    const prev = zoomRef.current;
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +next.toFixed(2)));
    if (clamped === prev) return;
    const vp = viewportRef.current;
    const p = panRef.current;
    // Anchor on the viewport centre so zooming keeps the currently visible part of the
    // material in view instead of drifting toward the top-left corner.
    const cx = vp.w / 2;
    const cy = vp.h / 2;
    const nextPan =
      clamped === ZOOM_MIN
        ? { x: 0, y: 0 }
        : clampPan(
            { x: cx - ((cx - p.x) * clamped) / prev, y: cy - ((cy - p.y) * clamped) / prev },
            clamped,
            vp,
          );
    setZoom(clamped);
    setPan(nextPan);
    if (clamped === ZOOM_MIN) setIsPanMode(false);
  }, []);

  const resetView = useCallback(() => {
    setZoom(ZOOM_MIN);
    setPan({ x: 0, y: 0 });
    setIsPanMode(false);
  }, []);

  const confirmTextShape = () => {
    const point = pendingTextPoint.current;
    const value = textInputValue.trim();
    setTextModalVisible(false);
    if (point && value) {
      const shape: DrawPath = { tool: "text", text: value, x: point.x, y: point.y, color: penColor, width: penSize };
      setPaths((prev) => [...prev, shape]);
      sendDrawCommit(shape);
    }
    pendingTextPoint.current = null;
    setTextInputValue("");
  };

  const clearBoard = () => {
    setPaths([]);
    setCurrentPath("");
    setPreviewShape(null);
    setRedoStack([]);
    sendBoardClear();
  };

  /**
   * One finished stroke: keep it locally and send it to everyone watching.
   *
   * If Smart mode is on and the stroke was clearly meant to be a shape, the rough ink is
   * replaced with a clean vector one. Recognition is deliberately conservative — an
   * unrecognised stroke is left exactly as drawn, because silently mangling what a teacher
   * wrote is far worse than not helping. Handwriting is never converted: it is open and curved,
   * which the recogniser rejects outright.
   */
  const commitShape = useCallback(
    (shape: DrawPath, points?: BoardPoint[]) => {
      let final = shape;

      if (smartShapes && points && points.length > 3 && shape.tool === "pen") {
        const guess = recognizeShape(points);
        if (guess && guess.confidence >= MIN_CONFIDENCE) {
          const snapped = squareUp(guess);
          const asPath = toDrawPath(snapped, shape.color ?? penColor, shape.width ?? penSize, shape.opacity);
          if (asPath) final = asPath;
        }
      }

      setPaths((prev) => [...prev, final]);
      setRedoStack([]); // a new stroke ends any redo branch
      sendDrawCommit(final);
    },
    [sendDrawCommit, smartShapes, penColor, penSize],
  );

  /**
   * Undo and redo work by replaying the whole board.
   *
   * The wire protocol only ever appends a stroke, so there is no "remove that one" message.
   * Clearing and re-sending what remains is the honest way to keep every viewer in step —
   * an undo that only took effect on the teacher's screen would be worse than none.
   */
  const replayBoard = useCallback(
    (next: DrawPath[]) => {
      sendBoardClear();
      next.forEach((p) => sendDrawCommit(p));
    },
    [sendBoardClear, sendDrawCommit],
  );

  const undo = useCallback(() => {
    setPaths((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      setRedoStack((r) => [...r, prev[prev.length - 1]]);
      replayBoard(next);
      return next;
    });
  }, [replayBoard]);

  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const shape = r[r.length - 1];
      setPaths((prev) => {
        const next = [...prev, shape];
        replayBoard(next);
        return next;
      });
      return r.slice(0, -1);
    });
  }, [replayBoard]);

  const handleSurfaceLayout = useCallback(
    (width: number, height: number) => {
      setViewport((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
      sendBoardSize(width, height);
    },
    [sendBoardSize],
  );

  const handleRequestText = useCallback((at: Point) => {
    pendingTextPoint.current = at;
    setTextInputValue("");
    setTextModalVisible(true);
  }, []);

  const applyUploadedFile = (dataUrl: string, kind: "image" | "pdf") => {
    if (kind === "pdf") {
      if (Platform.OS === "web") {
        // On web: the dataUrl is a full base64 data URI. Feed it straight to an
        // <iframe> via the socket so all web participants see it in the browser's
        // native PDF renderer — no pdf.js canvas rasterization, no off-screen
        // canvas allocation, no memory pressure on the mobile main thread.
        sendMaterial(dataUrl, "pdf");
      } else {
        // On native: dataUrl is a device-local file:// URI from DocumentPicker.
        // Show it locally in a WebView; don't broadcast since file paths are
        // meaningless on other participants' devices.
        setLocalPdfUri(dataUrl);
      }
      return;
    }
    resetView();
    sendMaterial(dataUrl, kind);
  };

  /** PDFs are passed through untouched, so they need their own ceiling. */
  const MAX_PDF_BYTES = 8_000_000;

  const reportUploadError = (message: string) => {
    setUploadError(message);
    if (Platform.OS === "web") window.alert(message);
    else Alert.alert("Upload Failed", message);
  };

  const handleWebFileSelected = async (file: File) => {
    setUploadError(null);
    try {
      if (file.type === "application/pdf") {
        if (file.size > MAX_PDF_BYTES) {
          reportUploadError("This PDF is too large to share on the board. Please use one under 8 MB.");
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
      applyUploadedFile(await prepareBoardImage({ platform: "web", file }), "image");
    } catch (err) {
      reportUploadError(
        err instanceof BoardImageError ? err.message : "Could not upload that file. Please try again.",
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
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission Needed", "Photo Library access is required to upload a photo.");
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
      applyUploadedFile(await prepareBoardImage({ platform: "native", asset: result.assets[0] }), "image");
    } catch (err) {
      reportUploadError(
        err instanceof BoardImageError ? err.message : "Could not upload the photo. Please try again.",
      );
    }
  };

  const handleUploadPdf = async () => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/pdf";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        handleWebFileSelected(file);
      };
      input.click();
      return;
    }

    try {
      const doc = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf"],
        copyToCacheDirectory: true,
      });
      if (doc.canceled || !doc.assets?.[0]) return;
      const asset = doc.assets[0];
      applyUploadedFile(asset.uri, "pdf");
    } catch {
      Alert.alert("Upload Failed", "Could not upload the PDF. Please try again.");
    }
  };

  const toggleRecording = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const msg = !isRecording ? "Recording started." : "Recording saved to Sikshya cloud.";
    if (Platform.OS === "web") window.alert(msg);
    else Alert.alert(!isRecording ? "Recording Started" : "Recording Saved", msg);
    setIsRecording((r) => !r);
  };

  // Called when the teacher clicks Daily's native Leave button. No confirmation dialog
  // here — the user already made an explicit in-call gesture, so we just clean up
  // immediately: mark the session completed and return to the dashboard.
  const handleDailyLeft = useCallback(async () => {
    // Drop the room URL before navigating. DailyEmbed tears the call down in its effect
    // cleanup, and clearing the URL makes that run immediately instead of waiting for the
    // screen to unmount — a navigation stack may keep this screen alive, and until the frame
    // is destroyed the camera and microphone stay on with the recording light lit.
    setRoomUrl(null);
    setMeetingToken(null);
    try { await apiPatch(`/sessions/${id}`, { status: "completed" }); } catch {}
    // The class is over, so withdraw its "starts in 30 minutes" reminder. Reminders were
    // scheduled at creation and never cancelled, which is why finished sessions kept
    // notifying.
    try { await cancelSessionReminder(String(id)); } catch {}
    router.back();
  }, [id]);

  const endSession = async () => {
    const doEnd = async () => {
      setRoomUrl(null);
    setMeetingToken(null); // release camera/mic before leaving — see handleDailyLeft above
      try { await apiPatch(`/sessions/${id}`, { status: "completed" }); } catch {}
      try { await cancelSessionReminder(String(id)); } catch {}
      router.back();
    };
    if (Platform.OS === "web") {
      if (window.confirm("End Session?\n\nThis will mark the session as completed.")) await doEnd();
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
    setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  // Presence (from the live WebSocket room) is the source of truth once connected — it
  // starts at 0 the moment the teacher starts the session (server force-clears any stale
  // "ghost" entries on start). Falling back to enrolledCount before the socket connects
  // caused a stale avatar/count to render even when nobody is actually present.
  const participantCount = connected ? presenceCount : 0;

  // The material image and every committed stroke are memoised so that changing zoom, pan or
  // the active tool re-renders only the transform wrapper. Without this, each zoom tap threw
  // away and rebuilt the decoded image plus every SVG path, which is what exhausted memory
  // and took the video call down with the app.
  const materialUri = material?.kind === "image" ? material.dataUrl : null;
  const materialLayer = useMemo(
    () =>
      materialUri ? (
        <Image source={{ uri: materialUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
      ) : null,
    [materialUri],
  );

  const canPan = zoom > ZOOM_MIN;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#0A0A0A" }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[s.container, { paddingTop: insets.top }]}>

        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <View style={s.sessionInfo}>
              <Text style={s.sessionTitle} numberOfLines={1}>
                {session ? `${session.subject}: ${session.topic}` : "Live Session"}
              </Text>
              <Text style={s.timer}>{fmt(elapsed)} / {String(session?.duration ?? 60).padStart(2, "0")}:00</Text>
            </View>
            <View style={[s.liveTag, { backgroundColor: colors.primary }]}>
              <View style={[s.liveDot, { backgroundColor: connected ? "#fff" : "#ff0" }]} />
              <Text style={s.liveText}>LIVE</Text>
            </View>
          </View>
          <View style={s.headerRight}>
            <TouchableOpacity style={s.iconBtn} onPress={toggleLandscape} activeOpacity={0.8}>
              <Feather name={isLandscape ? "minimize-2" : "maximize-2"} size={16} color="#aaa" />
            </TouchableOpacity>
            <TouchableOpacity style={[s.recBtn, { backgroundColor: isRecording ? colors.destructive : "#333" }]} onPress={toggleRecording} activeOpacity={0.8}>
              <Feather name="circle" size={13} color="#fff" />
              <Text style={s.recText}>{isRecording ? "Stop" : "Rec"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.endBtn} onPress={endSession} activeOpacity={0.8}>
              <Feather name="phone-off" size={14} color="#EF4444" />
              <Text style={s.endBtnText}>End</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Presence — do not render avatar bubbles or an "active" count at all when
            nobody is actually present, so a ghost participant never shows up. */}
        {participantCount > 0 && (
          <View style={s.presence}>
            {Array.from({ length: Math.min(participantCount, 5) }).map((_, i) => (
              <View key={i} style={[s.miniAvatar, { backgroundColor: ["#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EF4444"][i % 5], marginLeft: i > 0 ? -10 : 0 }]}>
                <Text style={s.miniAvatarText}>{String.fromCharCode(65 + i)}</Text>
              </View>
            ))}
            <Text style={s.presenceText}>
              {participantCount} {participantCount === 1 ? "student" : "students"}
            </Text>
          </View>
        )}

        {accessDenied && (
          <View style={s.deniedBar}>
            <Feather name="lock" size={15} color="#FCA5A5" />
            <Text style={s.deniedText}>
              The live board couldn't be opened for this class. It may belong to another teacher
              account — check you're signed in as the teacher who created it.
            </Text>
          </View>
        )}

        {/* Mode tabs */}
        <View style={s.modeSwitcher}>
          {/* Chat and participants come from Daily Prebuilt now, inside the call itself, so the
              app no longer offers its own dated versions alongside them. The panels below are
              left in place but unreachable; remove them once the native app has its own chat,
              since the native SDK has no Prebuilt and so no chat of its own. */}
          {(["whiteboard", "chat"] as Mode[]).map((m) => (
            <TouchableOpacity key={m} style={[s.modeTab, mode === m && s.modeTabActive]} onPress={() => setMode(m)} activeOpacity={0.7}>
              <Feather
                name={m === "whiteboard" ? "edit-3" : m === "participants" ? "users" : "message-circle"}
                size={14}
                color={mode === m ? "#fff" : "#666"}
              />
              <Text style={[s.modeTabText, mode === m && s.modeTabTextActive]}>
                {m === "whiteboard" ? "Board" : m === "participants" ? "Students" : `Chat${messages.length > 0 ? ` (${messages.length})` : ""}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Content area — unified flexbox: video feed confined on top, board/chat/participants on bottom.
            Video is persistently mounted so it never reconnects when switching tabs. */}
        <View style={[s.contentArea, sideBySide && s.contentAreaRow]}>
        {/* Video pane. Forced display:none (not just covered) while chatting — some mobile
            browsers break the embedded call out into a native Picture-in-Picture window that
            floats above all DOM content regardless of z-index, so removing it from layout
            is the only reliable way to keep it from clashing with the chat tab. */}
        <View style={[s.videoArea, sideBySide && s.videoAreaSide, videoExpanded && s.videoAreaExpanded, mode === "chat" && s.videoAreaHidden]}>
          {roomUrl ? (
            <DailyEmbed chatMessages={messages} onSendChat={sendChat} roomUrl={roomUrl} meetingToken={meetingToken} displayName={teacherName} style={StyleSheet.absoluteFill} onLeft={handleDailyLeft} canScreenShare />
          ) : (
            <View style={[StyleSheet.absoluteFill, s.permissionGate]}>
              <ActivityIndicator color="#fff" />
              <Text style={s.permissionGateText}>
                {roomError ? "Couldn't set up the video room." : "Setting up video room…"}
              </Text>
            </View>
          )}
          <TouchableOpacity style={s.videoExpandBtn} onPress={() => setVideoExpanded((v) => !v)} activeOpacity={0.8}>
            <Feather name={videoExpanded ? "minimize-2" : "maximize-2"} size={13} color="#fff" />
          </TouchableOpacity>
        </View>
        {!videoExpanded && (
        <View style={[s.boardArea, sideBySide && s.boardAreaSide]}>
        {/* Whiteboard. Scoped to its own boundary so a board rendering failure shows a
            recoverable message here instead of unmounting the app — which would also tear
            down the video call the class is running on. */}
        {mode === "whiteboard" && (
          <ErrorBoundary FallbackComponent={WhiteboardFallback}>
          <View style={s.whiteboardArea}>
            {/* Material controls. Collapsed to a single slim row by default: uploading happens
                once or twice a lesson, so it does not deserve permanent space that the video
                and the board itself need. Tapping it reveals the actual upload options. */}
            <View style={s.uploadDock}>
              <TouchableOpacity
                style={[s.materialToggle, materialMenuOpen && s.materialToggleOpen]}
                onPress={() => setMaterialMenuOpen((v) => !v)}
                activeOpacity={0.75}
              >
                <Feather name="paperclip" size={13} color={materialMenuOpen ? "#fff" : "#B9B9B9"} />
                <Text style={[s.materialToggleText, materialMenuOpen && s.materialToggleTextOpen]}>
                  {material || localPdfUri ? "Material" : "Add material"}
                </Text>
                <Feather name={materialMenuOpen ? "chevron-up" : "chevron-down"} size={13} color="#777" />
              </TouchableOpacity>

              {(material || localPdfUri) && (
                <TouchableOpacity
                  style={s.uploadDockClear}
                  onPress={() => { clearMaterial(); setLocalPdfUri(null); setUploadError(null); resetView(); setMaterialMenuOpen(false); }}
                  activeOpacity={0.7}
                >
                  <Feather name="x-circle" size={16} color="#EF4444" />
                </TouchableOpacity>
              )}
            </View>

            {materialMenuOpen && (
              <View style={s.materialMenu}>
                {Platform.OS === "web" ? (
                  <>
                    <View style={s.materialBtn}>
                      <Feather name="image" size={14} color="#fff" pointerEvents="none" />
                      <Text style={s.materialBtnText} pointerEvents="none">Photo</Text>
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
                        style: { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", zIndex: 9999 },
                      })}
                    </View>
                    <View style={s.materialBtn}>
                      <Feather name="file-text" size={14} color="#fff" pointerEvents="none" />
                      <Text style={s.materialBtnText} pointerEvents="none">PDF</Text>
                      {React.createElement("input", {
                        type: "file",
                        accept: "application/pdf",
                        onChange: (e: any) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          handleWebFileSelected(file);
                          e.target.value = "";
                          setMaterialMenuOpen(false);
                        },
                        style: { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", zIndex: 9999 },
                      })}
                    </View>
                  </>
                ) : (
                  <>
                    <TouchableOpacity style={s.materialBtn} onPress={() => { setMaterialMenuOpen(false); handleUploadPhoto(); }} activeOpacity={0.8}>
                      <Feather name="image" size={14} color="#fff" />
                      <Text style={s.materialBtnText}>Photo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.materialBtn} onPress={() => { setMaterialMenuOpen(false); handleUploadPdf(); }} activeOpacity={0.8}>
                      <Feather name="file-text" size={14} color="#fff" />
                      <Text style={s.materialBtnText}>PDF</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}

            {uploadError && (
              <View style={s.uploadErrorBar}>
                <Feather name="alert-circle" size={15} color="#FCA5A5" />
                <Text style={s.uploadErrorText}>{uploadError}</Text>
                <TouchableOpacity onPress={() => setUploadError(null)} activeOpacity={0.7}>
                  <Feather name="x" size={15} color="#FCA5A5" />
                </TouchableOpacity>
              </View>
            )}

            <View style={s.canvasScrollWrap}>
              {/* PDF mode: render the document in the platform's native PDF viewer.
                  No pdf.js, no off-screen canvas allocation, no main-thread rasterization.
                  - Web: <iframe> — Chrome/Safari's built-in PDF plugin renders it.
                  - Native: WebView with the local file:// URI picked by DocumentPicker. */}
              {(material?.kind === "pdf" || localPdfUri !== null) ? (
                Platform.OS === "web" && material?.kind === "pdf" ? (
                  React.createElement("iframe", {
                    src: material.dataUrl,
                    title: "PDF document",
                    style: {
                      position: "absolute",
                      top: 0, left: 0,
                      width: "100%", height: "100%",
                      border: "none",
                      borderRadius: 12,
                    },
                  })
                ) : localPdfUri !== null ? (
                  <PdfViewer uri={localPdfUri} style={StyleSheet.absoluteFill} />
                ) : null
              ) : (
                /* Drawing canvas — shown when material is an image overlay or board is blank */
                <WhiteboardCanvas
                  paths={paths}
                  materialLayer={materialLayer}
                  onCommit={commitShape}
                  onSurfaceLayout={handleSurfaceLayout}
                  tool={tool}
                  instrument={instrument}
                  color={penColor}
                  strokeWidth={penSize}
                  isEraser={isEraser}
                  eraserWidth={eraserWidth}
                  zoom={zoom}
                  pan={pan}
                  panMode={isPanMode}
                  onPanChange={setPan}
                  onRequestText={handleRequestText}
                />
              )}
            </View>

            {/* Toolbar sits below the board and takes its own space.
                It used to float on top of the canvas across the full width, so any stroke
                beginning in the bottom strip hit the toolbar instead of the board — which is
                why drawing only worked in parts of the surface, and why colour taps that
                landed in that strip appeared to do nothing. */}
            <View style={s.toolbar}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.toolbarScroll} contentContainerStyle={s.toolbarInner}>
                {/* Freehand instruments — each writes differently, not just in a different colour */}
                {PENS.map((pen) => {
                  const active = tool === "pen" && !isEraser && instrument === pen.id;
                  return (
                    <TouchableOpacity
                      key={pen.id}
                      style={[s.toolBtn, active && { backgroundColor: colors.primary }]}
                      onPress={() => { setTool("pen"); setInstrument(pen.id); setIsEraser(false); }}
                      activeOpacity={0.7}
                    >
                      <Feather name={pen.icon} size={16} color={active ? "#fff" : "#333"} />
                    </TouchableOpacity>
                  );
                })}

                <View style={s.toolDivider} />

                {TOOLS.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[s.toolBtn, tool === t.id && !isEraser && { backgroundColor: colors.primary }]}
                    onPress={() => { setTool(t.id); setIsEraser(false); }}
                    activeOpacity={0.7}
                  >
                    <Feather name={t.icon} size={16} color={tool === t.id && !isEraser ? "#fff" : "#333"} />
                  </TouchableOpacity>
                ))}

                <View style={s.toolDivider} />

                {COLORS_PALETTE.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={s.colorHit}
                    onPress={() => { setPenColor(c); setIsEraser(false); }}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        s.colorDot,
                        { backgroundColor: c, borderColor: penColor === c && !isEraser ? colors.primary : c === "#FFFFFF" ? "#CCC" : "transparent" },
                        penColor === c && !isEraser && s.colorDotActive,
                      ]}
                    />
                  </TouchableOpacity>
                ))}

                <View style={s.toolDivider} />

                {PEN_SIZES.map((sz) => (
                  <TouchableOpacity
                    key={sz}
                    style={[s.toolBtn, penSize === sz && !isEraser && { borderColor: colors.primary, borderWidth: 1.5 }]}
                    onPress={() => { setPenSize(sz); setIsEraser(false); }}
                    activeOpacity={0.7}
                  >
                    <View style={{ width: sz * 1.6, height: sz * 1.6, borderRadius: sz, backgroundColor: "#333" }} />
                  </TouchableOpacity>
                ))}

                <View style={s.toolDivider} />

                {/* Eraser, with its own sizes — a single fixed width is useless for rubbing out
                    either a stray tick or a whole worked example. */}
                <TouchableOpacity style={[s.toolBtn, isEraser && { backgroundColor: colors.primary }]} onPress={() => setIsEraser((v) => !v)} activeOpacity={0.7}>
                  <Feather name="delete" size={16} color={isEraser ? "#fff" : "#333"} />
                </TouchableOpacity>
                {isEraser && ERASER_SIZES.map((sz) => (
                  <TouchableOpacity
                    key={`er-${sz}`}
                    style={[s.toolBtn, eraserWidth === sz && { borderColor: colors.primary, borderWidth: 1.5 }]}
                    onPress={() => setEraserWidth(sz)}
                    activeOpacity={0.7}
                  >
                    <View style={{ width: sz / 2.6, height: sz / 2.6, borderRadius: 3, borderWidth: 1, borderColor: "#666", backgroundColor: "#fff" }} />
                  </TouchableOpacity>
                ))}
                <View style={s.toolDivider} />

                {/* Smart shapes: rough strokes snap to clean geometry. Switchable, because a
                    teacher drawing freehand art wants their own line kept exactly as drawn. */}
                <TouchableOpacity
                  style={[s.toolBtn, smartShapes && { backgroundColor: colors.primary }]}
                  onPress={() => setSmartShapes((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Feather name="zap" size={16} color={smartShapes ? "#fff" : "#333"} />
                </TouchableOpacity>

                <View style={s.toolDivider} />

                <TouchableOpacity style={s.toolBtn} onPress={() => applyZoom(zoom - ZOOM_STEP)} activeOpacity={0.7}>
                  <Feather name="zoom-out" size={16} color={zoom > ZOOM_MIN ? "#333" : "#BBB"} />
                </TouchableOpacity>
                <Text style={s.toolZoomText}>{Math.round(zoom * 100)}%</Text>
                <TouchableOpacity style={s.toolBtn} onPress={() => applyZoom(zoom + ZOOM_STEP)} activeOpacity={0.7}>
                  <Feather name="zoom-in" size={16} color={zoom < ZOOM_MAX ? "#333" : "#BBB"} />
                </TouchableOpacity>
                {/* Zoom is useless without a way to reach the rest of the material, so panning
                    is an explicit mode — a plain drag stays reserved for drawing. */}
                <TouchableOpacity
                  style={[s.toolBtn, isPanMode && { backgroundColor: colors.primary }]}
                  onPress={() => setIsPanMode((v) => canPan && !v)}
                  activeOpacity={0.7}
                >
                  <Feather name="move" size={16} color={isPanMode ? "#fff" : canPan ? "#333" : "#BBB"} />
                </TouchableOpacity>
                <TouchableOpacity style={s.toolBtn} onPress={resetView} activeOpacity={0.7}>
                  <Feather name="maximize" size={16} color="#333" />
                </TouchableOpacity>
              </ScrollView>

              {/* Undo, redo and clear live outside the scrolling strip.
                  They were inside it, at the far right, behind a scroll view with its indicator
                  hidden — so on any screen narrower than the full toolbar they were invisible
                  and there was no hint that anything lay off the edge. These three are the most
                  used controls on the board and must always be one tap away. */}
              <View style={s.toolbarPinned}>
                <TouchableOpacity style={s.toolBtn} onPress={undo} disabled={paths.length === 0} activeOpacity={0.7}>
                  <Feather name="corner-up-left" size={17} color={paths.length ? "#333" : "#BBB"} />
                </TouchableOpacity>
                <TouchableOpacity style={s.toolBtn} onPress={redo} disabled={redoStack.length === 0} activeOpacity={0.7}>
                  <Feather name="corner-up-right" size={17} color={redoStack.length ? "#333" : "#BBB"} />
                </TouchableOpacity>
                <TouchableOpacity style={s.toolBtn} onPress={clearBoard} activeOpacity={0.7}>
                  <Feather name="trash-2" size={17} color="#C2410C" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
          </ErrorBoundary>
        )}

        {/* Text tool input modal */}
        <Modal visible={textModalVisible} transparent animationType="fade" onRequestClose={() => setTextModalVisible(false)}>
          <View style={s.textModalOverlay}>
            <View style={s.textModalCard}>
              <Text style={s.textModalTitle}>Add Text</Text>
              <TextInput
                style={s.textModalInput}
                value={textInputValue}
                onChangeText={setTextInputValue}
                placeholder="Type text…"
                placeholderTextColor="#666"
                autoFocus
                onSubmitEditing={confirmTextShape}
              />
              <View style={s.textModalActions}>
                <TouchableOpacity style={s.textModalCancel} onPress={() => { setTextModalVisible(false); pendingTextPoint.current = null; }} activeOpacity={0.7}>
                  <Text style={s.textModalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.textModalConfirm, { backgroundColor: colors.primary }]} onPress={confirmTextShape} activeOpacity={0.8}>
                  <Text style={s.textModalConfirmText}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Participants */}
        {mode === "participants" && (
          <ScrollView style={s.flex} contentContainerStyle={s.participantGrid}>
            {Array.from({ length: Math.max(participantCount, 1) }).map((_, i) => {
              const names = ["Aarav S.", "Sita G.", "Ramesh K.", "Puja R.", "Bikash T.", "Anita B.", "Dinesh M.", "Kamala R."];
              const nm = names[i % names.length];
              const active = i % 5 !== 4;
              return (
                <View key={i} style={s.participantCard}>
                  <View style={[s.bigAvatar, { backgroundColor: active ? "#1A365D" : "#333" }]}>
                    <Text style={s.bigAvatarText}>{nm.split(" ").map((n) => n[0]).join("")}</Text>
                    {!active && <View style={s.inactiveOverlay}><Feather name="video-off" size={16} color="#666" /></View>}
                  </View>
                  <Text style={s.participantName} numberOfLines={1}>{nm.split(" ")[0]}</Text>
                  <View style={[s.statusDot, { backgroundColor: active ? "#22C55E" : "#555" }]} />
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Chat — solid opaque background + high z-index so it fully covers the video pane
            if a mobile browser forces the call into a floating window regardless. */}
        {mode === "chat" && (
          <View style={[s.flex, s.chatCover, { paddingBottom: 0 }]}>
            <ScrollView ref={chatScrollRef} style={s.flex} contentContainerStyle={s.chatMessages} onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: false })}>
              {messages.length === 0 && (
                <Text style={s.emptyChat}>No messages yet. Students will appear here.</Text>
              )}
              {messages.map((msg) => (
                <View key={msg.id} style={[s.chatBubble, msg.isMe && s.chatBubbleMe]}>
                  {!msg.isMe && <Text style={s.chatSender}>{msg.senderName}</Text>}
                  <View style={[s.bubbleContent, { backgroundColor: msg.isMe ? colors.primary : "#1E1E1E" }]}>
                    <Text style={s.chatText}>{msg.text}</Text>
                  </View>
                  <Text style={s.chatTime}>{msg.time}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={[s.chatInputRow, { paddingBottom: insets.bottom + 8 }]}>
              <TextInput style={s.chatInputField} value={chatMsg} onChangeText={setChatMsg} placeholder="Message students..." placeholderTextColor="#555" onSubmitEditing={sendMessage} returnKeyType="send" testID="chat-input" />
              <TouchableOpacity style={[s.sendBtn, { backgroundColor: colors.primary }]} onPress={sendMessage} activeOpacity={0.8}>
                <Feather name="send" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}
        </View>
        )}
        </View>

      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  sessionInfo: { flex: 1 },
  sessionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  timer: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#999" },
  liveTag: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#1A1A1A", justifyContent: "center", alignItems: "center" },
  recBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  recText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  endBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 10, backgroundColor: "#1A1A1A", paddingHorizontal: 9, paddingVertical: 6, borderWidth: 1, borderColor: "#EF4444" },
  endBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#EF4444" },
  presence: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingBottom: 6 },
  miniAvatar: { width: 26, height: 26, borderRadius: 13, justifyContent: "center", alignItems: "center", borderWidth: 2, borderColor: "#0A0A0A" },
  miniAvatarText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
  presenceText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#888" },
  deniedBar: { flexDirection: "row", alignItems: "center", gap: 9, marginHorizontal: 14, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: "#2A1416", borderWidth: 1, borderColor: "#7F1D1D" },
  deniedText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#FCA5A5", lineHeight: 17 },
  modeSwitcher: { flexDirection: "row", paddingHorizontal: 14, paddingBottom: 8, gap: 6 },
  modeTab: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "#1A1A1A" },
  modeTabActive: { backgroundColor: "#2A2A2A" },
  modeTabText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#666" },
  modeTabTextActive: { color: "#fff" },
  whiteboardArea: { flex: 1 },
  canvasScrollWrap: {
    flex: 1, marginHorizontal: 12, marginTop: 4, borderRadius: 12,
    backgroundColor: "#FFFFFF", overflow: "hidden",
    position: "relative",
  },
  canvas: { flex: 1, width: "100%", height: "100%", transformOrigin: "0 0" } as object,
  uploadDock: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingTop: 5, paddingBottom: 3, zIndex: 50, position: "relative" },
  // Slim, quiet control. The previous pair of full-width scarlet buttons read as the most
  // important thing on screen when they are in fact an occasional action.
  materialToggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#1A1A1A", borderWidth: 1, borderColor: "#2A2A2A" },
  materialToggleOpen: { backgroundColor: "#C41E3A", borderColor: "#FF6B81" },
  materialToggleText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#B9B9B9" },
  materialToggleTextOpen: { color: "#fff" },
  materialMenu: { flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingBottom: 4, zIndex: 50 },
  materialBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 8, backgroundColor: "#C41E3A", paddingVertical: 9, position: "relative", overflow: "hidden", zIndex: 50 },
  materialBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  uploadDockClear: { width: 30, height: 30, borderRadius: 8, backgroundColor: "#1A1A1A", justifyContent: "center", alignItems: "center" },
  uploadErrorBar: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginTop: 4, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: "#2A1416", borderWidth: 1, borderColor: "#7F1D1D" },
  uploadErrorText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#FCA5A5", lineHeight: 17 },
  boardFallback: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, paddingHorizontal: 28 },
  boardFallbackTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff", textAlign: "center" },
  boardFallbackBody: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#999", textAlign: "center", lineHeight: 19 },
  boardFallbackBtn: { marginTop: 4, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 10, backgroundColor: "#C41E3A" },
  boardFallbackBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  // Toolbar occupies its own row under the board rather than floating over it, so the
  // drawing surface has no dead zones.
  // Fixed height and no growth: a horizontal ScrollView left unconstrained in a column
  // stretches to fill the container, which collapsed the canvas above it to zero height.
  toolbar: { height: 56, flexGrow: 0, flexShrink: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 6, paddingBottom: 4 },
  toolbarScroll: { flexGrow: 1, flexShrink: 1 },
  toolbarPinned: { flexDirection: "row", alignItems: "center", gap: 2, paddingLeft: 8, marginLeft: 4, borderLeftWidth: 1, borderLeftColor: "#E5E5E5" },
  toolbarInner: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.95)", borderRadius: 20,
    borderWidth: 1, borderColor: "rgba(0,0,0,0.06)",
  },
  toolBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#F3F3F3", justifyContent: "center", alignItems: "center" },
  toolDivider: { width: 1, height: 22, backgroundColor: "#E2E2E2", marginHorizontal: 2 },
  toolZoomText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#333", minWidth: 34, textAlign: "center" },
  // The swatch is small for looks, but the tappable area around it is a full-size target —
  // a 24px dot inside a scroll view was easy to miss, which made colours feel unresponsive.
  colorHit: { width: 34, height: 34, justifyContent: "center", alignItems: "center" },
  colorDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  colorDotActive: { transform: [{ scale: 1.18 }] },
  island: {
    position: "absolute", left: 12, right: 12, bottom: 12, alignItems: "center", zIndex: 40,
  },
  islandInner: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 22,
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 10,
    borderWidth: 1, borderColor: "rgba(0,0,0,0.06)",
  },
  islandBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#F3F3F3", justifyContent: "center", alignItems: "center" },
  islandDivider: { width: 1, height: 22, backgroundColor: "#E2E2E2", marginHorizontal: 2 },
  islandColorDot: { width: 24, height: 24, borderRadius: 12 },
  islandZoomText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#333", minWidth: 34, textAlign: "center" },
  textModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 24 },
  textModalCard: { width: "100%", maxWidth: 360, backgroundColor: "#1A1A1A", borderRadius: 16, padding: 18, gap: 14 },
  textModalTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  textModalInput: { backgroundColor: "#0D0D0D", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, fontFamily: "Inter_400Regular", color: "#fff", outlineStyle: "none" } as object,
  textModalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  textModalCancel: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  textModalCancelText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#999" },
  textModalConfirm: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  textModalConfirmText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  participantGrid: { flexDirection: "row", flexWrap: "wrap", padding: 16, gap: 12, justifyContent: "center" },
  participantCard: { width: (SCREEN_W - 64) / 3, alignItems: "center", gap: 6 },
  bigAvatar: { width: 76, height: 76, borderRadius: 12, justifyContent: "center", alignItems: "center", overflow: "hidden" },
  bigAvatarText: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  inactiveOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center", backgroundColor: "#00000080" },
  participantName: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#ccc" },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  chatMessages: { padding: 14, gap: 10 },
  emptyChat: { textAlign: "center", color: "#555", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 40 },
  chatBubble: { gap: 3, maxWidth: "80%" },
  chatBubbleMe: { alignSelf: "flex-end", alignItems: "flex-end" },
  chatSender: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#666", marginLeft: 4 },
  bubbleContent: { borderRadius: 14, paddingHorizontal: 13, paddingVertical: 9 },
  chatText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#fff" },
  chatTime: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#555" },
  chatInputRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#1A1A1A" },
  chatInputField: { flex: 1, backgroundColor: "#1A1A1A", borderRadius: 24, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, fontFamily: "Inter_400Regular", color: "#fff", outlineStyle: "none" } as object,
  sendBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
  contentArea: { flex: 1, flexDirection: "column" },
  // Panels sit beside each other on a wide screen, each taking the full height.
  contentAreaRow: { flexDirection: "row" },
  videoAreaSide: {
    flex: 1, borderBottomWidth: 0, borderRightWidth: 1, borderRightColor: "#1A1A1A",
  },
  // Video carries the lesson, so it takes roughly two thirds of the content area; the board
  // gets the remaining third and can still be pushed to full screen with the expand control.
  // Previously both were flex:1 — an even split that left the video a thin strip once the
  // upload dock had taken its share.
  videoArea: {
    flex: 2.2, backgroundColor: "#000", position: "relative",
    overflow: "hidden", borderBottomWidth: 1, borderBottomColor: "#1A1A1A",
  },
  videoAreaExpanded: { flex: 1 },
  videoAreaHidden: { display: "none" },
  permissionGate: { alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 24 },
  permissionGateText: { color: "#ccc", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  boardArea: { flex: 1, overflow: "hidden" },
  // The board is the thing being judged, so it gets the larger share when side by side.
  boardAreaSide: { flex: 1.4 },
  chatCover: { backgroundColor: "#0A0A0A", zIndex: 9999, position: "relative" },
  videoExpandBtn: {
    position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", zIndex: 5,
  },
});
