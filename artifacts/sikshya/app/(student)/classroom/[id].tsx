import { Feather } from "@expo/vector-icons";
import * as ScreenOrientation from "expo-screen-orientation";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import type { Student } from "@/context/AuthContext";
import { apiGet } from "@/utils/api";
import { useClassroomSocket } from "@/hooks/useClassroomSocket";
import DailyEmbed from "@/components/DailyEmbed";
import SmartBoard from "@/components/SmartBoard";

const SCREEN_W = Dimensions.get("window").width;
type Mode = "board" | "chat";

interface SessionData {
  id: number; topic: string; subject: string; teacherName: string;
  duration: number; maxStudents: number; enrolledCount: number; status: string;
}

export default function StudentClassroom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const student = user as Student;
  if (!student || student.role !== "student") return null;

  const studentName = student.name ?? "Student";

  const { connected, accessDenied, presenceCount, messages, sessionStatus, sendChat, sceneUpdates, consumeSceneUpdates, boardClearedAt, boardView } =
    useClassroomSocket({ sessionId: id ?? "", name: studentName, role: "student" });

  const [session, setSession] = useState<SessionData | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [chatMsg, setChatMsg] = useState("");
  const [mode, setMode] = useState<Mode>("board");
  const [videoExpanded, setVideoExpanded] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [meetingToken, setMeetingToken] = useState<string | null>(null);
  const [roomError, setRoomError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

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
  // join them — this also covers the case where a student joins before the teacher's
  // own "start session" call has run, since the room is created idempotently either way.
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

  useEffect(() => {
    if (sessionStatus === "completed" || sessionStatus === "cancelled") {
      // Clear the room first: DailyEmbed releases the camera and microphone in its effect
      // cleanup, and dropping the URL runs that immediately rather than waiting for this
      // screen to unmount, which a navigation stack may never do.
      setRoomUrl(null);
    setMeetingToken(null);
      const msg = "The teacher has ended this session.";
      if (Platform.OS === "web") {
        window.alert(`Session Ended\n\n${msg}`);
        router.back();
      } else {
        Alert.alert("Session Ended", msg, [{ text: "OK", onPress: () => router.back() }]);
      }
    }
  }, [sessionStatus]);

  /**
   * The class is open to this student but the teacher has not pressed start.
   *
   * Students are let in up to five minutes early so the room is populated when the lesson
   * begins; without a clear signal that everyone is simply waiting, an empty call looks like a
   * broken one. `sessionStatus` arrives over the socket the moment the teacher starts, so this
   * clears itself with no polling.
   */
  const liveStatus = sessionStatus ?? session?.status ?? null;
  const waitingForTeacher = !!liveStatus && liveStatus !== "live" && liveStatus !== "completed" && liveStatus !== "cancelled";

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

  const sendMessage = () => {
    if (!chatMsg.trim()) return;
    sendChat(chatMsg.trim());
    setChatMsg("");
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  // Called when the student clicks Daily's native Leave button — no confirmation needed
  // since the user already made an explicit in-call gesture. Redirect instantly.
  const handleDailyLeft = useCallback(() => {
    setRoomUrl(null);
    setMeetingToken(null); // release camera/mic before navigating away
    router.back();
  }, []);

  const leaveSession = () => {
    const doLeave = () => {
      setRoomUrl(null);
    setMeetingToken(null); // release camera/mic before navigating away
      router.back();
    };
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

  const notifyTeacherLeft = () => {
    const msg = "The teacher has disconnected. They may rejoin shortly — you can wait here or leave the session.";
    if (Platform.OS === "web") window.alert(`Teacher Disconnected\n\n${msg}`);
    else Alert.alert("Teacher Disconnected", msg);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#0A0A0A" }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[s.container, { paddingTop: insets.top }]}>

        {/* Header */}
        <View style={s.header}>
          <View style={s.headerInfo}>
            <Text style={s.sessionTitle} numberOfLines={1}>{session?.topic ?? "Live Session"}</Text>
            <Text style={s.sessionSub}>{session?.subject ?? ""} · {fmt(elapsed)}</Text>
          </View>
          <View style={s.headerRight}>
            <TouchableOpacity style={s.iconBtn} onPress={toggleLandscape} activeOpacity={0.8}>
              <Feather name={isLandscape ? "minimize-2" : "maximize-2"} size={15} color="#aaa" />
            </TouchableOpacity>
            <View style={s.liveTag}>
              <View style={[s.liveDot, { backgroundColor: connected ? "#fff" : "#ff0" }]} />
              <Text style={s.liveText}>LIVE</Text>
            </View>
            <TouchableOpacity style={s.leaveBtn} onPress={leaveSession} activeOpacity={0.8}>
              <Feather name="phone-off" size={15} color="#EF4444" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Teacher banner */}
        <View style={s.teacherBanner}>
          <View style={s.teacherAvatar}>
            <Text style={s.teacherAvatarText}>{session?.teacherName?.[0]?.toUpperCase() ?? "T"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.teacherName}>{session?.teacherName ?? "Teacher"} is presenting</Text>
            <Text style={s.enrolledText}>
              {livePresenceCount > 0 ? `${livePresenceCount} in session` : "No one else here yet"}
            </Text>
          </View>
          <View style={s.onlineRow}>
            <View style={[s.onlineDot, { backgroundColor: connected ? "#22C55E" : "#F59E0B" }]} />
            <Text style={[s.onlineText, { color: connected ? "#22C55E" : "#F59E0B" }]}>
              {connected ? "Live" : "Connecting…"}
            </Text>
          </View>
        </View>

        {waitingForTeacher && (
          <View style={s.waitingBar}>
            <ActivityIndicator size="small" color="#FCD34D" />
            <Text style={s.waitingText}>
              Awaiting teacher to start the class. You're in the room — stay here and the class
              will begin automatically.
            </Text>
          </View>
        )}

        {accessDenied && (
          <View style={s.deniedBar}>
            <Feather name="lock" size={15} color="#FCA5A5" />
            <Text style={s.deniedText}>
              You're not enrolled in this class, so the whiteboard and chat are unavailable. Enrol
              from the session page to join.
            </Text>
          </View>
        )}

        {/* Mode tabs */}
        <View style={s.modeSwitcher}>
          {(["board", "chat"] as Mode[]).map((m) => (
            <TouchableOpacity key={m} style={[s.modeTab, mode === m && s.modeTabActive]} onPress={() => setMode(m)} activeOpacity={0.7}>
              <Feather name={m === "board" ? "monitor" : "message-circle"} size={13} color={mode === m ? "#fff" : "#666"} />
              <Text style={[s.modeText, mode === m && s.modeTextActive]}>
                {m === "board" ? "Whiteboard" : `Chat${messages.length > 0 ? ` (${messages.length})` : ""}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Content area — unified flexbox: video feed confined on top, board/chat on bottom.
            Video is persistently mounted so it never reconnects when switching tabs. */}
        <View style={s.contentArea}>
        {/* Video pane. Forced display:none (not just covered) while chatting — some mobile
            browsers break the embedded call out into a native Picture-in-Picture window that
            floats above all DOM content regardless of z-index, so removing it from layout
            is the only reliable way to keep it from clashing with the chat tab. */}
        <View style={[s.videoArea, videoExpanded && s.videoAreaExpanded, mode === "chat" && s.videoAreaHidden]}>
          {roomUrl ? (
            <DailyEmbed
              roomUrl={roomUrl}
              meetingToken={meetingToken}
              chatMessages={messages}
              onSendChat={sendChat}
              displayName={studentName}
              style={StyleSheet.absoluteFill}
              onLeft={handleDailyLeft}
              watchUserName={session?.teacherName}
              onWatchedParticipantLeft={notifyTeacherLeft}
            />
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
        <View style={s.boardWrap}>
        {/* Board — live whiteboard from teacher */}
        {/* The board appears when the class does.
            A student who arrived early used to see the teacher's private preparation — notes
            scribbled before the lesson, on a board the call still described as "waiting for
            others". The board and the class now start together; the server wipes it as the
            class goes live, so the lesson opens clean. */}
        {mode === "board" && waitingForTeacher && (
          <View style={[s.boardArea, s.boardWaiting]}>
            <Feather name="clock" size={26} color="#888" />
            <Text style={s.boardWaitingTitle}>The board opens when the class starts</Text>
            <Text style={s.boardWaitingBody}>
              You are in the room and your teacher can see you. Stay here — the whiteboard
              appears the moment they begin.
            </Text>
          </View>
        )}

        {mode === "board" && !waitingForTeacher && (
          <View style={s.boardArea}>
            {/* The teacher's board, read-only.
                Students see the same Excalidraw scene the teacher is drawing on, rather than a
                flattened picture of it, so panning and zooming to read something small is now
                possible from a phone — which it was not when the board was a fixed SVG scaled
                to fit the screen.

                `viewport` is what makes that an advantage rather than a hazard: an infinite
                canvas is easy to be lost on, so the board follows wherever the teacher is
                looking until the student takes over by panning themselves. */}
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

        {/* Chat — solid opaque background + high z-index so it fully covers the video pane
            if a mobile browser forces the call into a floating window regardless. */}
        {mode === "chat" && (
          <View style={[s.flex, s.chatCover]}>
            <ScrollView ref={scrollRef} style={s.flex} contentContainerStyle={s.chatContent} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
              {messages.length === 0 && (
                <Text style={s.emptyChat}>No messages yet. Send a question to the teacher!</Text>
              )}
              {messages.map((msg) => (
                <View key={msg.id} style={[s.bubble, msg.isMe && s.bubbleMe]}>
                  {!msg.isMe && <Text style={s.bubbleSender}>{msg.senderName}</Text>}
                  <View style={[s.bubbleBody, { backgroundColor: msg.isMe ? "#C41E3A" : msg.role === "teacher" ? "#1A365D" : "#1E1E1E" }]}>
                    <Text style={s.bubbleText}>{msg.text}</Text>
                  </View>
                  <Text style={s.bubbleTime}>{msg.time}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={[s.inputRow, { paddingBottom: insets.bottom + 8 }]}>
              <TextInput style={s.input} value={chatMsg} onChangeText={setChatMsg} placeholder="Ask the teacher…" placeholderTextColor="#555" onSubmitEditing={sendMessage} returnKeyType="send" />
              <TouchableOpacity style={s.sendBtn} onPress={sendMessage} activeOpacity={0.8}>
                <Feather name="send" size={15} color="#fff" />
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
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12 },
  headerInfo: { flex: 1, marginRight: 10 },
  sessionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  sessionSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#888", marginTop: 2 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#1A1A1A", justifyContent: "center", alignItems: "center" },
  liveTag: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#C41E3A", borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  leaveBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#1A1A1A", justifyContent: "center", alignItems: "center" },
  waitingBar: { flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#3A2E0B", borderBottomWidth: 1, borderBottomColor: "#5A470F" },
  waitingText: { flex: 1, color: "#FCD34D", fontSize: 12, lineHeight: 17 },
  teacherBanner: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: "#111" },
  teacherAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#1A365D", justifyContent: "center", alignItems: "center" },
  teacherAvatarText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  teacherName: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#ddd" },
  enrolledText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#666", marginTop: 2 },
  onlineRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  onlineText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  deniedBar: { flexDirection: "row", alignItems: "center", gap: 9, marginHorizontal: 14, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: "#2A1416", borderWidth: 1, borderColor: "#7F1D1D" },
  deniedText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#FCA5A5", lineHeight: 17 },
  modeSwitcher: { flexDirection: "row", paddingHorizontal: 14, paddingVertical: 8, gap: 8 },
  modeTab: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 7, backgroundColor: "#1A1A1A" },
  modeTabActive: { backgroundColor: "#2A2A2A" },
  modeText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#666" },
  modeTextActive: { color: "#fff" },
  boardArea: { flex: 1, marginHorizontal: 12, marginBottom: 12, borderRadius: 14, backgroundColor: "#fff", overflow: "hidden" },
  boardWaiting: { alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 28, backgroundColor: "#141414" },
  boardWaitingTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#DDD", textAlign: "center" },
  boardWaitingBody: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#888", textAlign: "center", lineHeight: 19 },
  boardEmpty: { flex: 1, justifyContent: "center", alignItems: "center", padding: 30, gap: 12 },
  boardEmptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: "#222", textAlign: "center" },
  boardEmptySub: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#777", textAlign: "center", lineHeight: 20 },
  chatContent: { padding: 14, gap: 10 },
  emptyChat: { textAlign: "center", color: "#555", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 40 },
  bubble: { maxWidth: "80%", gap: 3 },
  bubbleMe: { alignSelf: "flex-end", alignItems: "flex-end" },
  bubbleSender: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#666", marginLeft: 4 },
  bubbleBody: { borderRadius: 14, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#fff" },
  bubbleTime: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#555" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#1A1A1A" },
  input: { flex: 1, backgroundColor: "#1A1A1A", borderRadius: 24, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, fontFamily: "Inter_400Regular", color: "#fff" },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#C41E3A", justifyContent: "center", alignItems: "center" },
  contentArea: { flex: 1, flexDirection: "column" },
  videoArea: {
    flex: 1, backgroundColor: "#000", position: "relative",
    overflow: "hidden", borderBottomWidth: 1, borderBottomColor: "#1A1A1A",
  },
  videoAreaExpanded: { flex: 1 },
  videoAreaHidden: { display: "none" },
  permissionGate: { alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 24 },
  permissionGateText: { color: "#ccc", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  boardWrap: { flex: 1, overflow: "hidden" },
  chatCover: { backgroundColor: "#0A0A0A", zIndex: 9999, position: "relative" },
  videoExpandBtn: {
    position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", zIndex: 5,
  },
});
