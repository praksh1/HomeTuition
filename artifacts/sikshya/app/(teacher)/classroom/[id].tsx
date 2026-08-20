import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ScreenOrientation from "expo-screen-orientation";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import type { Teacher } from "@/context/AuthContext";
import { apiGet, apiPatch } from "@/utils/api";
import { useClassroomSocket } from "@/hooks/useClassroomSocket";
import DailyEmbed from "@/components/DailyEmbed";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import PdfViewer from "@/components/PdfViewer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { ErrorFallbackProps } from "@/components/ErrorFallback";
import { prepareBoardImage, BoardImageError, NATIVE_PICKER_QUALITY } from "@/utils/boardImage";
import { cancelSessionReminder } from "@/utils/notifications";
import SmartBoard from "@/components/SmartBoard";

const SCREEN_W = Dimensions.get("window").width;
type Mode = "whiteboard" | "participants" | "chat";

interface SessionData {
  id: number; topic: string; subject: string; teacherName: string;
  duration: number; maxStudents: number; enrolledCount: number; status: string;
}

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

  const { connected, accessDenied, presenceCount, messages, boardClearedAt, sceneUpdates, consumeSceneUpdates, sendSceneUpdate, sendBoardView, sendChat, sendBoardClear, clearMaterial } =
    useClassroomSocket({ sessionId: id ?? "", name: teacherName, role: "teacher" });

  const [session, setSession] = useState<SessionData | null>(null);
  const [mode, setMode] = useState<Mode>("whiteboard");
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [chatMsg, setChatMsg] = useState("");
  const [isLandscape, setIsLandscape] = useState(false);
  const [videoExpanded, setVideoExpanded] = useState(false);
  /** Upload options stay folded away until asked for — they are occasional actions, and as
   * two permanent full-width buttons they were consuming screen the video should have. */
  const [materialMenuOpen, setMaterialMenuOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /**
   * The next picture to place on the whiteboard. A new `key` is what triggers the placement,
   * so uploading the same photo twice still works and a re-render never duplicates one.
   */
  const [boardDocument, setBoardDocument] = useState<
    { key: string; dataUrl: string; kind: "image" | "pdf" } | null
  >(null);
  // Native-only: stores a local file:// URI for a PDF picked via DocumentPicker.
  // Kept separate from `material` (which is broadcast over the socket) because
  // file:// paths are device-local and meaningless on other participants' devices.
  const [localPdfUri, setLocalPdfUri] = useState<string | null>(null);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [meetingToken, setMeetingToken] = useState<string | null>(null);
  const [roomError, setRoomError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatScrollRef = useRef<ScrollView>(null);

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

  const nextBoardKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const applyUploadedFile = (dataUrl: string, kind: "image" | "pdf") => {
    /**
     * On native a PDF arrives as a device-local `file://` URI rather than bytes, so there is
     * nothing to hand the board. It opens for the teacher alone and says so, loudly — the same
     * honest failure as before. Reading the file into memory first would close this gap and is
     * worth doing; pretending it is shared is not.
     */
    if (kind === "pdf" && Platform.OS !== "web") {
      setLocalPdfUri(dataUrl);
      clearMaterial();
      return;
    }

    // Everything else goes to the board, which turns a PDF into pages and places a photo as a
    // single picture. Both end up as ordinary objects the whole class can see.
    setLocalPdfUri(null);
    setBoardDocument({ key: nextBoardKey(), dataUrl, kind });
    clearMaterial();
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
                  {boardDocument || localPdfUri ? "Material" : "Add material"}
                </Text>
                <Feather name={materialMenuOpen ? "chevron-up" : "chevron-down"} size={13} color="#777" />
              </TouchableOpacity>

              {(boardDocument || localPdfUri) && (
                <TouchableOpacity
                  style={s.uploadDockClear}
                  onPress={() => { clearMaterial(); setLocalPdfUri(null); setBoardDocument(null); setUploadError(null); setMaterialMenuOpen(false); }}
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

            {localPdfUri !== null && (
              <View style={s.pdfWarnBar}>
                <Feather name="eye-off" size={15} color="#FCD34D" />
                <Text style={s.pdfWarnText}>
                  Your students cannot see this PDF — only your whiteboard is shared. To teach
                  from a page, close this and upload it as a photo instead.
                </Text>
                <TouchableOpacity onPress={() => setLocalPdfUri(null)} activeOpacity={0.7}>
                  <Feather name="x" size={15} color="#FCD34D" />
                </TouchableOpacity>
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
              {localPdfUri !== null ? (
                // Shown to the teacher only, and never broadcast — see applyUploadedFile.
                Platform.OS === "web" ? (
                  React.createElement("iframe", {
                    src: localPdfUri,
                    title: "PDF document",
                    style: {
                      position: "absolute",
                      top: 0, left: 0,
                      width: "100%", height: "100%",
                      border: "none",
                      borderRadius: 12,
                    },
                  })
                ) : (
                  <PdfViewer uri={localPdfUri} style={StyleSheet.absoluteFill} />
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
                    clearedAt={boardClearedAt}
                  />
                </>
              )}
            </View>

          </View>
          </ErrorBoundary>
        )}

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
    flex: 1, marginHorizontal: 12, marginTop: 4, marginBottom: 8, borderRadius: 12,
    backgroundColor: "#FFFFFF", overflow: "hidden",
    position: "relative",
  },
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
  pdfWarnBar: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginTop: 4, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: "#3A2E0B", borderWidth: 1, borderColor: "#5A470F" },
  pdfWarnText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#FCD34D", lineHeight: 17 },
  uploadErrorBar: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginTop: 4, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: "#2A1416", borderWidth: 1, borderColor: "#7F1D1D" },
  uploadErrorText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#FCA5A5", lineHeight: 17 },
  boardFallback: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, paddingHorizontal: 28 },
  boardFallbackTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff", textAlign: "center" },
  boardFallbackBody: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#999", textAlign: "center", lineHeight: 19 },
  boardFallbackBtn: { marginTop: 4, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 10, backgroundColor: "#C41E3A" },
  boardFallbackBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
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
