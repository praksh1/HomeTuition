import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { verifyToken, type JwtPayload } from "../lib/auth";
import { getSessionMembership, canAccessSession } from "../lib/membership";

interface RoomClient {
  ws: WebSocket;
  userId: number;
  role: string;
  name: string;
  /** True only for the teacher who owns *this* session — not merely any teacher account. */
  isSessionTeacher: boolean;
}

const rooms = new Map<string, Set<RoomClient>>();

const DRAW_TOOLS = new Set(["pen", "line", "arrow", "circle", "rect", "text"]);
/** Oldest strokes are dropped past this, so one long class cannot grow the room unbounded. */
const MAX_REPLAY_PATHS = 800;
/** Matches the client-side upload cap; anything larger is a bug or an abusive client. */
const MAX_MATERIAL_CHARS = 2_500_000;

interface BoardState {
  material: { kind: "image" | "pdf"; dataUrl: string } | null;
  paths: Record<string, unknown>[];
  /**
   * The size of the teacher's drawing surface. Strokes are stored as raw numbers in that
   * space, so without it a viewer cannot tell whether x=800 means "near the right edge" or
   * "far off screen". Replayed to late joiners along with the strokes themselves.
   */
  boardSize: { width: number; height: number } | null;
}

/**
 * The board is broadcast-only, so a student who joins after the teacher has drawn or shared
 * a document would otherwise stare at a blank canvas for the rest of the class. Holding the
 * current board per room lets late joiners be caught up on connect.
 */
const boards = new Map<string, BoardState>();

function getBoard(sessionId: string): BoardState {
  let board = boards.get(sessionId);
  if (!board) {
    board = { material: null, paths: [], boardSize: null };
    boards.set(sessionId, board);
  }
  return board;
}

function sendTo(ws: WebSocket, msg: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

interface Membership {
  sessionId: string;
  userId: number;
  role: string;
  name: string;
  isSessionTeacher: boolean;
}

/**
 * Decides whether a socket may join a classroom at all.
 *
 * A valid JWT only proves who someone is, not that they belong in this particular class, so
 * it is checked against the session itself: the connecting user must be the teacher who owns
 * the session, or hold an enrollment row for it. Without this, any registered account could
 * join any live class by guessing its numeric ID and receive the chat, the shared material
 * and every stroke of a course it never paid for.
 *
 * Enrollment existence — not `paymentStatus === "paid"` — is the bar, matching how the rest
 * of the app treats enrolment: `POST /sessions/:id/enroll` creates rows as "pending" and
 * nothing currently promotes them, so requiring "paid" would lock out every real student.
 * Tighten this here once payment confirmation is wired up.
 */
async function authorizeMembership(url: URL): Promise<Membership | null> {
  const rawSessionId = url.searchParams.get("sessionId") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!rawSessionId || !token) return null;

  const sessionId = Number.parseInt(rawSessionId, 10);
  if (!Number.isInteger(sessionId) || sessionId <= 0) return null;

  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    return null;
  }

  // Shared with GET /sessions/:id/room so the video door and the board door always agree.
  const membership = await getSessionMembership(sessionId, payload.userId);
  if (!canAccessSession(membership)) return null;
  const isSessionTeacher = membership!.isSessionTeacher;

  // The display name comes from the database rather than the `name` query param, which the
  // client controls and could otherwise use to impersonate the teacher in chat.
  const [userRow] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId));

  return {
    // Normalised, so "007" and "7" cannot address two different rooms — broadcasts from the
    // REST routes always key on String(numericId).
    sessionId: String(sessionId),
    userId: payload.userId,
    role: payload.role,
    name: userRow?.name ?? "Unknown",
    isSessionTeacher,
  };
}

/** Keeps unknown tools out of the board so clients never render a shape they cannot draw. */
function sanitizeDrawCommit(msg: Record<string, unknown>): Record<string, unknown> | null {
  const tool = typeof msg.tool === "string" && DRAW_TOOLS.has(msg.tool) ? msg.tool : "pen";
  if (tool === "pen" && typeof msg.d !== "string") return null;
  return {
    type: "draw_commit",
    tool,
    d: msg.d,
    color: typeof msg.color === "string" ? msg.color : "#0D0D0D",
    width: typeof msg.width === "number" ? msg.width : 3,
    x1: msg.x1, y1: msg.y1, x2: msg.x2, y2: msg.y2,
    cx: msg.cx, cy: msg.cy, r: msg.r,
    text: msg.text, x: msg.x, y: msg.y,
    // Translucency for highlighter strokes; anything outside (0,1] is treated as solid.
    opacity: typeof msg.opacity === "number" && msg.opacity > 0 && msg.opacity <= 1 ? msg.opacity : 1,
  };
}

function broadcast(sessionId: string, msg: object, excludeWs?: WebSocket): void {
  const room = rooms.get(sessionId);
  if (!room) return;
  const payload = JSON.stringify(msg);
  for (const c of room) {
    if (excludeWs && c.ws === excludeWs) continue;
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload);
  }
}

export function broadcastSessionStatus(sessionId: string, status: string): void {
  broadcast(String(sessionId), { type: "session_status", status });
}


/**
 * Wipes the board at the start of a class without disturbing who is in the room.
 *
 * A teacher starting their next class inherited the previous one's scribbles, which looked
 * like the app had leaked another lesson onto their board. An earlier version also hung up on
 * everyone in order to do it, and that is now the wrong trade: students are
 * allowed to gather in the room up to five minutes before the start, so disconnecting them at
 * the exact moment the teacher begins would empty the class it was meant to fill.
 *
 * Clients are told to clear too, because each one keeps its own copy of the strokes for
 * rendering and would otherwise keep drawing a board the server has already forgotten.
 */
export function resetBoardFor(sessionId: string): void {
  const id = String(sessionId);
  boards.delete(id);
  broadcast(id, { type: "board_clear" });
  broadcast(id, { type: "material_clear" });
}

export function attachClassroomHub(server: http.Server): void {
  // Well above the client's own material cap but far below the library's 100MB default, so a
  // runaway or hostile client cannot buffer an arbitrarily large frame in server memory.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (!url.pathname.startsWith("/api/ws")) {
      socket.destroy();
      return;
    }

    // A destroyed or reset socket emits 'error'; without a listener that would crash the
    // process, and the membership lookup below gives it time to happen.
    socket.on("error", () => {});

    // Membership is settled before the handshake completes, so an unauthorized peer never
    // gets an open WebSocket at all.
    void (async () => {
      let member: Membership | null = null;
      try {
        member = await authorizeMembership(url);
      } catch (err) {
        logger.error({ err }, "ws authorization failed");
      }

      if (!member) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      if (socket.destroyed) return;
      const approved = member;
      wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, approved));
    })();
  });

  // Called only from the upgrade handler above, which has already proven this user belongs in
  // this session. Identity is never re-read from the query string here.
  function handleConnection(ws: WebSocket, member: Membership): void {
    const { sessionId, userId, role, name, isSessionTeacher } = member;

    const client: RoomClient = { ws, userId, role, name, isSessionTeacher };
    if (!rooms.has(sessionId)) rooms.set(sessionId, new Set());
    rooms.get(sessionId)!.add(client);
    logger.info({ sessionId, userId, role, isSessionTeacher }, "ws join");

    const count = rooms.get(sessionId)!.size;
    broadcast(sessionId, { type: "presence", count });

    const board = getBoard(sessionId);
    if (board.material || board.paths.length > 0 || board.boardSize) {
      sendTo(ws, {
        type: "board_state",
        material: board.material,
        paths: board.paths,
        boardSize: board.boardSize,
      });
    }

    ws.on("message", (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()) as Record<string, unknown>; } catch { return; }

      switch (msg.type) {
        case "chat":
          broadcast(sessionId, {
            type: "chat",
            senderName: name,
            // The classroom role, not the account role: a teacher account that enrolled in
            // someone else's class must not be badged as that class's teacher.
            role: isSessionTeacher ? "teacher" : "student",
            text: msg.text,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }, ws);
          break;
        // Board writes are gated on owning this session, not on merely holding a teacher
        // role — otherwise any teacher account could draw on and replace the material of
        // another teacher's live class.
        case "draw_commit": {
          if (!isSessionTeacher) break;
          const shape = sanitizeDrawCommit(msg);
          if (!shape) break;
          const board = getBoard(sessionId);
          board.paths.push(shape);
          if (board.paths.length > MAX_REPLAY_PATHS) board.paths.shift();
          broadcast(sessionId, shape, ws);
          break;
        }
        case "board_clear":
          if (isSessionTeacher) {
            getBoard(sessionId).paths = [];
            broadcast(sessionId, { type: "board_clear" }, ws);
          }
          break;
        case "board_size": {
          if (!isSessionTeacher) break;
          const width = typeof msg.width === "number" ? msg.width : NaN;
          const height = typeof msg.height === "number" ? msg.height : NaN;
          if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) break;
          getBoard(sessionId).boardSize = { width, height };
          broadcast(sessionId, { type: "board_size", width, height }, ws);
          break;
        }
        case "reaction":
          broadcast(sessionId, { type: "reaction", emoji: msg.emoji, senderName: name });
          break;
        case "material_set": {
          if (!isSessionTeacher) break;
          const kind = msg.kind === "image" ? "image" : msg.kind === "pdf" ? "pdf" : null;
          const dataUrl = msg.dataUrl;
          if (kind === null || typeof dataUrl !== "string") break;
          if (dataUrl.length > MAX_MATERIAL_CHARS) {
            logger.warn({ sessionId, userId, size: dataUrl.length }, "ws material too large, dropped");
            sendTo(ws, { type: "material_rejected", reason: "too_large" });
            break;
          }
          getBoard(sessionId).material = { kind, dataUrl };
          broadcast(sessionId, { type: "material_set", kind, dataUrl }, ws);
          break;
        }
        case "material_clear":
          if (isSessionTeacher) {
            getBoard(sessionId).material = null;
            broadcast(sessionId, { type: "material_clear" }, ws);
          }
          break;
      }
    });

    ws.on("close", () => {
      rooms.get(sessionId)?.delete(client);
      const remaining = rooms.get(sessionId);
      if (!remaining?.size) {
        rooms.delete(sessionId);
        boards.delete(sessionId);
      }
      const newCount = rooms.get(sessionId)?.size ?? 0;
      broadcast(sessionId, { type: "presence", count: newCount });
    });

    ws.on("error", (err: Error) => logger.error({ err, sessionId }, "ws error"));
  }
}
