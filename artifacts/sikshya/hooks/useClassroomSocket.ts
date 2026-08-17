import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Platform } from "react-native";
import { getToken } from "@/utils/api";

export interface ChatMessage {
  id: string;
  senderName: string;
  role: "teacher" | "student";
  text: string;
  time: string;
  isMe: boolean;
}

export type DrawTool = "pen" | "line" | "arrow" | "circle" | "rect" | "text";

export interface DrawPath {
  tool: DrawTool;
  color: string;
  width: number;
  d?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  cx?: number;
  cy?: number;
  r?: number;
  text?: string;
  x?: number;
  y?: number;
  /** Below 1 for translucent instruments such as the highlighter. */
  opacity?: number;
}

export interface FloatingReaction {
  id: string;
  emoji: string;
  senderName: string;
  opacity: Animated.Value;
  translateY: Animated.Value;
  x: number;
}

export interface BoardMaterial {
  kind: "image" | "pdf";
  dataUrl: string;
}

const DRAW_TOOLS: DrawTool[] = ["pen", "line", "arrow", "circle", "rect", "text"];

/**
 * The size of the teacher's drawing surface, in the coordinate space their strokes are
 * recorded in.
 *
 * Strokes are plain numbers — a point at (800, 400) means 800px across the teacher's canvas.
 * Students render into a canvas of a completely different size, so without knowing the space
 * those numbers belong to, a stroke drawn near the right edge of a laptop lands off the side
 * of a phone. Publishing the teacher's canvas size lets every viewer map the drawing onto
 * their own screen with an SVG viewBox, which also keeps ink aligned with the material,
 * since the material is letterboxed the same way.
 */
export interface BoardSize {
  width: number;
  height: number;
}

function toBoardSize(raw: unknown): BoardSize | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const width = typeof o.width === "number" ? o.width : NaN;
  const height = typeof o.height === "number" ? o.height : NaN;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function toMaterial(kind: unknown, dataUrl: unknown): BoardMaterial | null {
  const k = kind === "image" ? "image" : kind === "pdf" ? "pdf" : null;
  if (k === null || typeof dataUrl !== "string" || dataUrl.length === 0) return null;
  return { kind: k, dataUrl };
}

/**
 * Board messages arrive from another participant, so their shape is not guaranteed. An
 * unrecognised tool would fall through to the pen branch and render a <Path> with no `d`,
 * which throws inside react-native-svg and takes the whole classroom screen down.
 */
function toDrawPath(raw: Record<string, unknown>): DrawPath | null {
  const tool = DRAW_TOOLS.includes(raw.tool as DrawTool) ? (raw.tool as DrawTool) : "pen";
  if (tool === "pen" && typeof raw.d !== "string") return null;
  if (tool === "text" && typeof raw.text !== "string") return null;
  return {
    tool,
    color: typeof raw.color === "string" ? raw.color : "#0D0D0D",
    width: typeof raw.width === "number" ? raw.width : 3,
    d: raw.d as string | undefined,
    x1: raw.x1 as number | undefined,
    y1: raw.y1 as number | undefined,
    x2: raw.x2 as number | undefined,
    y2: raw.y2 as number | undefined,
    cx: raw.cx as number | undefined,
    cy: raw.cy as number | undefined,
    r: raw.r as number | undefined,
    text: raw.text as string | undefined,
    x: raw.x as number | undefined,
    y: raw.y as number | undefined,
    opacity: typeof raw.opacity === "number" && raw.opacity > 0 && raw.opacity <= 1 ? raw.opacity : 1,
  };
}

function getWsUrl(sessionId: string, token: string, name: string): string {
  const params = new URLSearchParams({ sessionId, token, name });
  // Mirrors getApiBase() in utils/api.ts: an explicit origin wins, so the socket follows the
  // API to whatever host/port it is actually on. http -> ws, https -> wss.
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) {
    const base = explicit.replace(/\/+$/, "").replace(/^http/, "ws");
    return `${base}/api/ws?${params.toString()}`;
  }
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `wss://${domain}/api/ws?${params.toString()}`;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/api/ws?${params.toString()}`;
  }
  return `ws://localhost:80/api/ws?${params.toString()}`;
}

interface Options {
  sessionId: string;
  name: string;
  role: "teacher" | "student";
}

interface Result {
  connected: boolean;
  /** The server refused this user entry to the classroom; retrying has been abandoned. */
  accessDenied: boolean;
  presenceCount: number;
  messages: ChatMessage[];
  remotePaths: DrawPath[];
  floatingReactions: FloatingReaction[];
  material: BoardMaterial | null;
  /** The coordinate space the teacher's strokes are drawn in; null until they publish it. */
  boardSize: BoardSize | null;
  /** Teacher only: publish the drawing surface size so viewers can scale strokes correctly. */
  sendBoardSize: (width: number, height: number) => void;
  sessionStatus: string | null;
  sendChat: (text: string) => void;
  sendReaction: (emoji: string) => void;
  sendDrawCommit: (shape: DrawPath) => void;
  sendBoardClear: () => void;
  sendMaterial: (dataUrl: string, kind: "image" | "pdf") => void;
  clearMaterial: () => void;
}

export function useClassroomSocket({ sessionId, name, role }: Options): Result {
  const [connected, setConnected] = useState(false);
  const [presenceCount, setPresenceCount] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [remotePaths, setRemotePaths] = useState<DrawPath[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [material, setMaterial] = useState<BoardMaterial | null>(null);
  const [boardSize, setBoardSize] = useState<BoardSize | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);

  const [accessDenied, setAccessDenied] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // The server refuses the upgrade outright for anyone who isn't the session's teacher or an
  // enrolled student. That failure is permanent, so retrying it forever would just hammer the
  // server and leave the user staring at a silent "Connecting…". Attempts are counted and
  // backed off, and given up on entirely if the socket has never once opened.
  const failedAttemptsRef = useRef(0);
  const everConnectedRef = useRef(false);
  const nameRef = useRef(name);
  const roleRef = useRef(role);
  nameRef.current = name;
  roleRef.current = role;

  const addFloating = useCallback((emoji: string, senderName: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    const opacity = new Animated.Value(1);
    const translateY = new Animated.Value(0);
    const x = 0.05 + Math.random() * 0.65;
    const reaction: FloatingReaction = { id, emoji, senderName, opacity, translateY, x };
    setFloatingReactions((prev) => [...prev, reaction]);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 2500, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -130, duration: 2500, useNativeDriver: true }),
    ]).start(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
    });
  }, []);

  const send = useCallback((data: object) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }, []);

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;
    const token = await getToken();
    if (!token) return;

    const url = getWsUrl(sessionId, token, nameRef.current);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      failedAttemptsRef.current = 0;
      everConnectedRef.current = true;
      setConnected(true);
      setAccessDenied(false);
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(event.data as string) as Record<string, unknown>; } catch { return; }

      switch (msg.type) {
        case "chat":
          setMessages((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random()}`,
              senderName: msg.senderName as string,
              role: msg.role as "teacher" | "student",
              text: msg.text as string,
              time: msg.time as string,
              isMe: false,
            },
          ]);
          break;
        case "draw_commit": {
          const shape = toDrawPath(msg);
          if (shape) setRemotePaths((prev) => [...prev, shape]);
          break;
        }
        case "board_state": {
          // Sent once on connect so a student joining mid-class sees what is already
          // on the board instead of a blank canvas.
          const raw = Array.isArray(msg.paths) ? (msg.paths as Record<string, unknown>[]) : [];
          setRemotePaths(raw.map(toDrawPath).filter((p): p is DrawPath => p !== null));
          const mat = msg.material as { kind?: unknown; dataUrl?: unknown } | null | undefined;
          setMaterial(mat ? toMaterial(mat.kind, mat.dataUrl) : null);
          setBoardSize(toBoardSize(msg.boardSize));
          break;
        }
        case "board_size":
          setBoardSize(toBoardSize(msg));
          break;
        case "board_clear":
          setRemotePaths([]);
          break;
        case "presence":
          setPresenceCount(msg.count as number);
          break;
        case "reaction":
          addFloating(msg.emoji as string, msg.senderName as string);
          break;
        case "material_set":
          setMaterial((prev) => toMaterial(msg.kind, msg.dataUrl) ?? prev);
          break;
        case "material_clear":
          setMaterial(null);
          break;
        case "session_status":
          setSessionStatus(msg.status as string);
          break;
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      failedAttemptsRef.current += 1;

      // Never opened after several tries means the server is rejecting this user, not that
      // the network is flaky — stop and let the screen explain it.
      if (!everConnectedRef.current && failedAttemptsRef.current >= 4) {
        setAccessDenied(true);
        return;
      }

      const delay = Math.min(30000, 3000 * 2 ** (failedAttemptsRef.current - 1));
      reconnTimerRef.current = setTimeout(() => { void connect(); }, delay);
    };

    ws.onerror = () => { ws.close(); };
  }, [sessionId, addFloating]);

  useEffect(() => {
    mountedRef.current = true;
    void connect();
    return () => {
      mountedRef.current = false;
      if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendChat = useCallback(
    (text: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}`,
          senderName: nameRef.current,
          role: roleRef.current,
          text,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          isMe: true,
        },
      ]);
      send({ type: "chat", text });
    },
    [send],
  );

  const sendReaction = useCallback(
    (emoji: string) => {
      addFloating(emoji, nameRef.current);
      send({ type: "reaction", emoji });
    },
    [addFloating, send],
  );

  const sendDrawCommit = useCallback(
    (shape: DrawPath) => send({ type: "draw_commit", ...shape }),
    [send],
  );

  const sendBoardClear = useCallback(() => send({ type: "board_clear" }), [send]);

  const sendBoardSize = useCallback(
    (width: number, height: number) => {
      if (!(width > 0) || !(height > 0)) return;
      setBoardSize({ width, height });
      send({ type: "board_size", width, height });
    },
    [send],
  );

  const sendMaterial = useCallback(
    (dataUrl: string, kind: "image" | "pdf") => {
      setMaterial({ dataUrl, kind });
      send({ type: "material_set", dataUrl, kind });
    },
    [send],
  );

  const clearMaterial = useCallback(() => {
    setMaterial(null);
    send({ type: "material_clear" });
  }, [send]);

  return {
    connected,
    accessDenied,
    boardSize,
    sendBoardSize,
    presenceCount,
    messages,
    remotePaths,
    floatingReactions,
    material,
    sessionStatus,
    sendChat,
    sendReaction,
    sendDrawCommit,
    sendBoardClear,
    sendMaterial,
    clearMaterial,
  };
}
