import { useCallback, useEffect, useRef, useState } from "react";
import { Animated } from "react-native";
import { getToken } from "@/utils/api";
import { wsUrl } from "@/utils/wsUrl";
import { onNetworkResume } from "@/utils/networkResume";

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

/** One batch of changed board elements, as broadcast by the server. */
export interface SceneDelta {
  /** True when this is a full catch-up for a client that just joined. */
  full: boolean;
  elements: unknown[];
  /**
   * The picture data for any image elements in this batch.
   *
   * Excalidraw stores a picture apart from the element that draws it, so a delta carrying only
   * elements gives the far side a frame with nothing in it — which is precisely what students
   * saw when a teacher shared a photo.
   */
  files?: unknown[];
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

/**
 * The rectangle of the infinite canvas the teacher currently has on screen, in scene
 * coordinates.
 *
 * Knowing *what* has been drawn is not enough on a canvas without edges: a student whose view
 * sat somewhere else saw a blank stretch of board and had to pinch around hunting for the
 * lesson. The teacher publishes the region they are looking at and every student fits it to
 * their own screen, which also absorbs the difference between a laptop and a phone.
 */
export interface BoardViewport {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function toBoardViewport(raw: unknown): BoardViewport | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const nums = [o.minX, o.minY, o.maxX, o.maxY];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [minX, minY, maxX, maxY] = nums as number[];
  if (maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY };
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

/**
 * How long to wait before trying the classroom socket again.
 *
 * This was `3000 * 2 ** (attempts - 1)`, capped at 30s, whether or not the student had ever
 * been in the class. So a student whose phone lost signal for a second waited three seconds to
 * get back in, and a student on a genuinely patchy connection — which is most of this
 * product's market — was soon waiting half a minute at a time while their lesson carried on
 * without them. That is the "takes forever to rejoin" report.
 *
 * A socket that has been open once is a different situation from one that never opened: the
 * first is a network blip and should be retried almost at once, the second may be a server
 * that is down and deserves backing off from. So they are no longer treated the same.
 *
 * The jitter matters more than it looks. When a teacher's connection wobbles, every student in
 * the class is disconnected at the same instant; without it they would all reconnect on the
 * same tick and hit the server as one spike.
 */
export function reconnectDelay(attempt: number, everConnected: boolean): number {
  const base = everConnected
    ? Math.min(8000, 300 * 2 ** (attempt - 1)) // 300ms, 600, 1.2s, 2.4s, 4.8s, 8s...
    : Math.min(30000, 3000 * 2 ** (attempt - 1)); // unchanged: 3s, 6s, 12s, 24s, 30s...
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

function getWsUrl(sessionId: string, token: string, name: string): string {
  return wsUrl({ sessionId, token, name });
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
  /**
   * Changes whenever the server clears the board, so a screen holding its own local strokes
   * knows to drop them. The teacher draws locally for responsiveness, so clearing only the
   * remote copy would leave their ink on a board everyone else sees as empty.
   */
  boardClearedAt: number;
  /**
   * Elements from the object board that have arrived since the last render.
   *
   * Deliberately a *queue of changes* rather than the whole scene: Excalidraw owns the scene
   * and merges into it, and handing it a full replacement on every message would fight its own
   * editing state — a student's viewport would jump, and a teacher's in-progress drag would be
   * yanked out from under them.
   */
  sceneUpdates: SceneDelta[];
  /** Marks updates as applied so they are not merged twice. */
  consumeSceneUpdates: () => void;
  sendSceneUpdate: (elements: unknown[], files?: unknown[]) => void;
  floatingReactions: FloatingReaction[];
  material: BoardMaterial | null;
  /** The coordinate space the teacher's strokes are drawn in; null until they publish it. */
  boardSize: BoardSize | null;
  /** Teacher only: publish the drawing surface size so viewers can scale strokes correctly. */
  sendBoardSize: (width: number, height: number) => void;
  /** The region of the board the teacher is looking at; null until they publish one. */
  boardView: BoardViewport | null;
  /** Teacher only: publish the visible region so students can follow along. */
  sendBoardView: (view: BoardViewport) => void;
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
  /** Timestamp of the last server-driven board clear; a change means "wipe local strokes". */
  const [boardClearedAt, setBoardClearedAt] = useState(0);
  const [sceneUpdates, setSceneUpdates] = useState<SceneDelta[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [material, setMaterial] = useState<BoardMaterial | null>(null);
  const [boardSize, setBoardSize] = useState<BoardSize | null>(null);
  const [boardView, setBoardView] = useState<BoardViewport | null>(null);
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
        case "board_view":
          setBoardView((prev) => toBoardViewport(msg) ?? prev);
          break;
        case "scene_state":
          setSceneUpdates((prev) => [
            ...prev,
            { full: true, elements: (msg.elements as unknown[]) ?? [], files: (msg.files as unknown[]) ?? [] },
          ]);
          break;
        case "scene_update":
          setSceneUpdates((prev) => [
            ...prev,
            { full: false, elements: (msg.elements as unknown[]) ?? [], files: (msg.files as unknown[]) ?? [] },
          ]);
          break;
        case "board_clear":
          setRemotePaths([]);
          setSceneUpdates([]);
          // Bumped so the teacher's screen can drop its *own* strokes too. The teacher draws
          // into local state for responsiveness, so clearing only the remote copy would leave
          // their ink on a board the server and every student consider empty.
          setBoardClearedAt(Date.now());
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

      reconnTimerRef.current = setTimeout(
        () => { void connect(); },
        reconnectDelay(failedAttemptsRef.current, everConnectedRef.current),
      );
    };

    ws.onerror = () => { ws.close(); };
  }, [sessionId, addFloating]);

  /**
   * Drop everything belonging to the previous class when the session id changes.
   *
   * The classroom screens are one route with a changing parameter, so moving from one class to
   * the next reuses this hook rather than remounting it. Board state therefore survived the
   * move, and a teacher starting their next lesson found the previous lesson's strokes and
   * shared document already on the board.
   */
  useEffect(() => {
    setRemotePaths([]);
    setSceneUpdates([]);
    setBoardClearedAt(0);
    setMaterial(null);
    setBoardSize(null);
    setBoardView(null);
    setMessages([]);
    setPresenceCount(0);
    setSessionStatus(null);
    setAccessDenied(false);
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    void connect();
    return () => {
      mountedRef.current = false;
      if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  /**
   * Get back into the class the moment the device can, instead of waiting out a timer set
   * while it could not.
   *
   * A student who walks back into signal, or picks their phone back up, is looking at the
   * screen right then. Sitting on a pending backoff for several more seconds is exactly what
   * "rejoining takes forever" felt like from their side.
   */
  useEffect(() => {
    return onNetworkResume(() => {
      if (!mountedRef.current || accessDenied) return;
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      if (reconnTimerRef.current) {
        clearTimeout(reconnTimerRef.current);
        reconnTimerRef.current = null;
      }
      // The backoff exists for a server that is refusing, not for a network that was off.
      failedAttemptsRef.current = 0;
      void connect();
    });
  }, [connect, accessDenied]);

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
  const sendSceneUpdate = useCallback(
    (elements: unknown[], files: unknown[] = []) => {
      if (elements.length > 0) send({ type: "scene_update", elements, files });
    },
    [send],
  );
  const consumeSceneUpdates = useCallback(() => setSceneUpdates([]), []);

  const sendBoardSize = useCallback(
    (width: number, height: number) => {
      if (!(width > 0) || !(height > 0)) return;
      setBoardSize({ width, height });
      send({ type: "board_size", width, height });
    },
    [send],
  );

  /**
   * Only the teacher's own board publishes a view, and it is deliberately *not* mirrored into
   * local state: doing so would feed the teacher's viewport straight back into their own
   * editor and fight every pan they make.
   */
  const sendBoardView = useCallback(
    (view: BoardViewport) => send({ type: "board_view", ...view }),
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
    boardView,
    sendBoardView,
    presenceCount,
    messages,
    remotePaths,
    boardClearedAt,
    sceneUpdates,
    consumeSceneUpdates,
    sendSceneUpdate,
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
