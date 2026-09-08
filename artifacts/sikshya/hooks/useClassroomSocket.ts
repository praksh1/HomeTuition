import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/* ========================================================================== *
 * The classroom floor — who may speak, and who decided                        *
 * ========================================================================== */

/**
 * The nine labels a person can be shown about their own or somebody else's media.
 *
 * Mirrors `api-server/src/lib/classroom/speakingFloor.ts` exactly. Nine rather than a boolean
 * because "muted" covers three situations a student needs told apart: they muted themselves, the
 * teacher muted them, or they never asked to speak in the first place — and a student who thinks
 * their teacher silenced them behaves differently from one who knows they have not put their hand
 * up yet.
 */
export type MediaState =
  | "audience"
  | "requested"
  | "invited"
  | "allowed-not-accepted"
  | "speaking"
  | "camera-active"
  | "muted-by-self"
  | "muted-by-teacher"
  | "disconnected";

export type InvitationScope = "mic" | "mic+camera";
export type FloorMode = "classroom" | "discussion";

/**
 * How far behind the video provider is on one person.
 *
 * `ok` is in step. `pending` means the server asked and has not been told yes yet. `failed` means
 * it asked, could not get through, and stopped trying — the classroom's decision stands on the
 * server and the SFU has **not** accepted it.
 *
 * It exists because the screen used to claim otherwise: a mute that never reached LiveKit was
 * drawn as a finished mute, so a teacher believed a microphone was off while the class could still
 * hear it. Nothing in the app may render a row that is not in step as one that is.
 */
export type ProviderState = "ok" | "pending" | "failed";

/** One row of the teacher's participant list. Students never receive these. */
export interface FloorRow {
  userId: number;
  name: string;
  state: MediaState;
  requestedAt: number | null;
  invitedAt: number | null;
  invitationScope: InvitationScope | null;
  connected: boolean;
  allowedMic: boolean;
  allowedCamera: boolean;
  provider: ProviderState;
}

export interface TeacherFloorView {
  scope: "teacher";
  mode: FloorMode;
  discussionEligible: boolean;
  discussionStartedAt: number | null;
  spotlight: number | null;
  students: FloorRow[];
  /** Who is waiting, oldest first, in the server's own order. */
  queue: number[];
}

export interface StudentFloorView {
  scope: "student";
  mode: FloorMode;
  discussionEligible: boolean;
  discussionStartedAt: number | null;
  spotlight: number | null;
  you: {
    state: MediaState;
    requestedAt: number | null;
    invitedAt: number | null;
    invitationScope: InvitationScope | null;
    allowedMic: boolean;
    allowedCamera: boolean;
    acceptedMic: boolean;
    acceptedCamera: boolean;
    provider: ProviderState;
  };
  /** How many hands are up. A count, never names — see `floorView.ts` on the server. */
  handsUp: number;
  /** This viewer's own place in that line, 1-based, or null when they are not in it. */
  queuePosition: number | null;
}

export type FloorView = TeacherFloorView | StudentFloorView;

/** Why the server said no. Shown to the one person who asked, and to nobody else. */
export interface FloorRefusal {
  action: string | null;
  code: string;
  reason: string;
}

/**
 * The twenty-three things a person can ask the floor for.
 *
 * Typed rather than a `send(type, payload)` because the wire is the security boundary: a screen
 * that assembles message names from strings is a screen that can send `floor_mute` from a
 * student's phone by accident. The server refuses that anyway — this just means it never has to.
 */
export interface FloorActions {
  /* A student, about their own place */
  ask: () => void;
  cancelAsk: () => void;
  /**
   * "My video is connected now." A fact about this device, and not a request for anything.
   *
   * The classroom socket and the video connection are separate, and this one comes up first — so a
   * teacher who grants the floor in the gap is granting it to somebody the SFU has never heard of.
   * The server used to record that as done; it now leaves it pending and finishes it when this
   * arrives.
   *
   * It carries no payload, deliberately. The server takes the identity from this authenticated
   * socket and the rights from its own floor, so the most a client can do with it is ask for a
   * decision its teacher already made to be re-attempted. Sending it in a loop achieves nothing:
   * the server rate-limits and caps it.
   */
  mediaReady: () => void;
  /** Answer an invitation, or switch on what the teacher has already permitted. */
  accept: (scope: InvitationScope) => void;
  /**
   * One switch at a time, for a student already speaking.
   *
   * The case this exists for: turning the camera off to save bandwidth on a weak line while
   * carrying on answering. Sent to the floor as well as to the call, so the teacher's list does
   * not go on showing a camera nobody is sending.
   */
  setMic: (on: boolean) => void;
  setCamera: (on: boolean) => void;
  decline: () => void;
  listenOnly: () => void;
  joinDiscussion: (scope: InvitationScope) => void;
  leaveDiscussion: () => void;
  /* This class's teacher, about anybody in it */
  allow: (userId: number, scope: InvitationScope, replace?: boolean) => void;
  dismiss: (userId: number) => void;
  cancelInvite: (userId: number) => void;
  cancelInvites: () => void;
  inviteAll: () => void;
  mute: (userId: number) => void;
  muteAll: () => void;
  stopCamera: (userId: number) => void;
  returnToAudience: (userId: number) => void;
  startDiscussion: () => void;
  endDiscussion: () => void;
  spotlight: (userId: number | null) => void;
}

const PROVIDER_STATES: ProviderState[] = ["ok", "pending", "failed"];

/**
 * Read a provider state, defaulting to `pending` rather than `ok`.
 *
 * The one place where the safe default is *not* the optimistic one. A payload from a server that
 * does not send this field yet, or one this build cannot read, must not be drawn as "the provider
 * has this" — that is the exact claim the field was added to stop being made without evidence.
 */
function toProviderState(raw: unknown): ProviderState {
  return PROVIDER_STATES.includes(raw as ProviderState) ? (raw as ProviderState) : "pending";
}

const MEDIA_STATES: MediaState[] = [
  "audience", "requested", "invited", "allowed-not-accepted", "speaking",
  "camera-active", "muted-by-self", "muted-by-teacher", "disconnected",
];

/**
 * Read a floor payload, or refuse it.
 *
 * The server is ours, so this is not defending against a hostile peer — it is defending against a
 * *version skew*, which is the realistic failure: a deployed app talking to an API that has moved
 * on. An unrecognised media state rendered as a label would read as a blank chip; dropped here,
 * the screen keeps the last state it understood.
 */
function toFloorView(raw: unknown): FloorView | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const mode: FloorMode = o.mode === "discussion" ? "discussion" : "classroom";
  const spotlight = typeof o.spotlight === "number" ? o.spotlight : null;
  const discussionStartedAt = typeof o.discussionStartedAt === "number" ? o.discussionStartedAt : null;
  const discussionEligible = o.discussionEligible === true;

  if (o.scope === "teacher") {
    const rows = Array.isArray(o.students) ? o.students : [];
    const students: FloorRow[] = [];
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      if (typeof r.userId !== "number" || !MEDIA_STATES.includes(r.state as MediaState)) continue;
      students.push({
        userId: r.userId,
        name: typeof r.name === "string" ? r.name : "Student",
        state: r.state as MediaState,
        requestedAt: typeof r.requestedAt === "number" ? r.requestedAt : null,
        invitedAt: typeof r.invitedAt === "number" ? r.invitedAt : null,
        invitationScope: r.invitationScope === "mic" || r.invitationScope === "mic+camera" ? r.invitationScope : null,
        connected: r.connected !== false,
        allowedMic: r.allowedMic === true,
        allowedCamera: r.allowedCamera === true,
        provider: toProviderState(r.provider),
      });
    }
    const queue = Array.isArray(o.queue) ? o.queue.filter((n): n is number => typeof n === "number") : [];
    return { scope: "teacher", mode, discussionEligible, discussionStartedAt, spotlight, students, queue };
  }

  if (o.scope === "student") {
    const you = (o.you ?? {}) as Record<string, unknown>;
    if (!MEDIA_STATES.includes(you.state as MediaState)) return null;
    return {
      scope: "student",
      mode,
      discussionEligible,
      discussionStartedAt,
      spotlight,
      you: {
        state: you.state as MediaState,
        requestedAt: typeof you.requestedAt === "number" ? you.requestedAt : null,
        invitedAt: typeof you.invitedAt === "number" ? you.invitedAt : null,
        invitationScope:
          you.invitationScope === "mic" || you.invitationScope === "mic+camera" ? you.invitationScope : null,
        allowedMic: you.allowedMic === true,
        allowedCamera: you.allowedCamera === true,
        acceptedMic: you.acceptedMic === true,
        acceptedCamera: you.acceptedCamera === true,
        provider: toProviderState(you.provider),
      },
      handsUp: typeof o.handsUp === "number" ? o.handsUp : 0,
      queuePosition: typeof o.queuePosition === "number" ? o.queuePosition : null,
    };
  }

  return null;
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
  /**
   * Set when the server refuses a picture for being too large, and cleared once shown.
   *
   * The server has always answered `material_rejected` and nothing has ever listened, so the
   * teacher saw the picture on their own board and had no way of knowing the class could not.
   * That is the worst version of this bug: it looks like it worked.
   */
  materialRejected: string | null;
  clearMaterialRejected: () => void;
  /** The coordinate space the teacher's strokes are drawn in; null until they publish it. */
  boardSize: BoardSize | null;
  /** Teacher only: publish the drawing surface size so viewers can scale strokes correctly. */
  sendBoardSize: (width: number, height: number) => void;
  /** The region of the board the teacher is looking at; null until they publish one. */
  boardView: BoardViewport | null;
  /** Teacher only: publish the visible region so students can follow along. */
  sendBoardView: (view: BoardViewport) => void;
  sessionStatus: string | null;
  /**
   * Where this person stands on the classroom floor, as the server sees it.
   *
   * Null until the first `floor_state` arrives, and null again once the class ends. Never derived
   * locally: a screen that guessed at its own permission would be a screen that disagrees with the
   * SFU, and the disagreement always shows up as somebody being told they may speak while nobody
   * can hear them.
   */
  floor: FloorView | null;
  /** The last refusal, for the person who asked. Cleared once shown. */
  floorRefusal: FloorRefusal | null;
  clearFloorRefusal: () => void;
  floorActions: FloorActions;
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
  const [materialRejected, setMaterialRejected] = useState<string | null>(null);
  const clearMaterialRejected = useCallback(() => setMaterialRejected(null), []);
  const [boardSize, setBoardSize] = useState<BoardSize | null>(null);
  const [boardView, setBoardView] = useState<BoardViewport | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [floor, setFloor] = useState<FloorView | null>(null);
  const [floorRefusal, setFloorRefusal] = useState<FloorRefusal | null>(null);
  const clearFloorRefusal = useCallback(() => setFloorRefusal(null), []);

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
        case "material_rejected":
          setMaterialRejected(
            "That picture was too large to share, so the class cannot see it. Try a smaller one.",
          );
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
        case "floor_state": {
          const next = toFloorView(msg.floor);
          // A payload this build cannot read leaves the last one it could standing, rather than
          // blanking the controls a teacher is halfway through using.
          if (next) setFloor(next);
          break;
        }
        case "floor_refused":
          setFloorRefusal({
            action: typeof msg.action === "string" ? msg.action : null,
            code: typeof msg.code === "string" ? msg.code : "unknown",
            reason:
              typeof msg.reason === "string" && msg.reason.length > 0
                ? msg.reason
                : "That could not be done.",
          });
          break;
        case "floor_ended":
          // The class stopped. Every permission went with it, so the controls go too rather than
          // sitting there offering something the server would now refuse.
          setFloor(null);
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
    // The floor belongs to one class. Carrying it across would show a teacher the previous
    // lesson's raised hands, and offer a student a microphone in a room they have just left.
    setFloor(null);
    setFloorRefusal(null);
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

  /**
   * The floor's verbs.
   *
   * **Nothing here changes local state optimistically**, and that is the whole design. Chat is
   * echoed locally because a message that appears instantly and arrives a moment later is a better
   * lie than a laggy one. A *permission* is the opposite: a screen that shows "you may speak"
   * before the server agrees is a screen that will be wrong, and the student finds out by pressing
   * unmute and being refused by LiveKit. So every one of these sends and waits, and the UI moves
   * only when `floor_state` comes back.
   *
   * A refusal is cleared as each new action is sent, so the message on screen always belongs to
   * the last thing the person actually did.
   */
  const floorActions = useMemo<FloorActions>(() => {
    const ask = (data: object) => {
      setFloorRefusal(null);
      send(data);
    };
    return {
      ask: () => ask({ type: "floor_ask" }),
      cancelAsk: () => ask({ type: "floor_cancel_ask" }),
      /*
        Sent bare, and without clearing a refusal.

        Every other action here is something the person did, so it replaces whatever the server
        last said no to. This one is the device talking about itself while the person is reading
        that message, and wiping it off their screen would be this app losing an answer they
        asked for.
      */
      mediaReady: () => send({ type: "floor_media_ready" }),
      accept: (scope) => ask({ type: "floor_accept", scope }),
      setMic: (on) => ask({ type: "floor_accept", mic: on }),
      setCamera: (on) => ask({ type: "floor_accept", camera: on }),
      decline: () => ask({ type: "floor_decline" }),
      listenOnly: () => ask({ type: "floor_listen_only" }),
      joinDiscussion: (scope) => ask({ type: "floor_join_discussion", scope }),
      leaveDiscussion: () => ask({ type: "floor_leave_discussion" }),
      allow: (userId, scope, replace = false) => ask({ type: "floor_allow", userId, scope, replace }),
      dismiss: (userId) => ask({ type: "floor_dismiss", userId }),
      cancelInvite: (userId) => ask({ type: "floor_cancel_invite", userId }),
      cancelInvites: () => ask({ type: "floor_cancel_invites" }),
      inviteAll: () => ask({ type: "floor_invite_all" }),
      mute: (userId) => ask({ type: "floor_mute", userId }),
      muteAll: () => ask({ type: "floor_mute_all" }),
      stopCamera: (userId) => ask({ type: "floor_stop_camera", userId }),
      returnToAudience: (userId) => ask({ type: "floor_return_audience", userId }),
      startDiscussion: () => ask({ type: "floor_start_discussion" }),
      endDiscussion: () => ask({ type: "floor_end_discussion" }),
      spotlight: (userId) => ask({ type: "floor_spotlight", userId }),
    };
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
    materialRejected,
    clearMaterialRejected,
    sessionStatus,
    floor,
    floorRefusal,
    clearFloorRefusal,
    floorActions,
    sendChat,
    sendReaction,
    sendDrawCommit,
    sendBoardClear,
    sendMaterial,
    clearMaterial,
  };
}
