import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { eq } from "drizzle-orm";
import { db, sessionMessagesTable, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { verifyToken, type JwtPayload } from "../lib/auth";
import { getSessionMembership, canAccessSession } from "../lib/membership";
import { threadTargetFor } from "../lib/monthlyStore";
import { addUserChannel } from "./userHub";
import { markTeacherPresent } from "../lib/sessionLifecycle";
import { recordParticipation } from "../lib/participation";
import { forgetBoard, loadBoard, saveBoardNow, saveBoardSoon } from "../lib/boardStore";
import { startHeartbeat, watchHeartbeat } from "./heartbeat";

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
/** A whole lesson of diagrams sits far below this; beyond it something has gone wrong. */
const MAX_SCENE_ELEMENTS = 5_000;
/** Pictures are orders of magnitude larger than shapes, so they get their own, much lower cap. */
const MAX_SCENE_FILES = 40;
/**
 * How often a connected teacher's presence is written down.
 *
 * Comfortably shorter than the two minutes after which a class counts as abandoned, so a
 * teacher who is really there is never mistaken for one who has gone.
 */
const TEACHER_PRESENCE_INTERVAL_MS = 30_000;
/**
 * How often each person's time in the room is written down.
 *
 * The same half-minute as the teacher's presence above, and for the same reason: fine enough
 * that a class ended by a browser crash is recorded to within thirty seconds, coarse enough
 * that a room of ten people costs twenty rows a minute rather than one per stroke.
 */
const PARTICIPATION_FLUSH_INTERVAL_MS = 30_000;

interface BoardState {
  material: { kind: "image" | "pdf"; dataUrl: string } | null;
  paths: Record<string, unknown>[];
  /**
   * The size of the teacher's drawing surface. Strokes are stored as raw numbers in that
   * space, so without it a viewer cannot tell whether x=800 means "near the right edge" or
   * "far off screen". Replayed to late joiners along with the strokes themselves.
   */
  boardSize: { width: number; height: number } | null;
  /**
   * The rectangle of the infinite canvas the teacher is looking at, in scene coordinates.
   *
   * Replayed to late joiners for the same reason the elements are: on a canvas with no edges,
   * arriving at the right coordinates matters as much as being told what is drawn there. A
   * student who joins mid-lesson otherwise lands at the origin, which may be nowhere near the
   * work, and has to hunt for it.
   */
  view: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /**
   * The object board, keyed by element id.
   *
   * The stroke list above is append-only: it can say "a line was drawn" but has no way to say
   * "that line moved" or "that line is gone". An object board needs both, so scene elements are
   * held in a map and merged by id. Each element carries its own `version`, and a higher
   * version always wins — which makes the merge safe to apply in any order, so a message that
   * arrives late cannot resurrect a deleted shape or undo a move.
   */
  scene: Map<string, SceneElement>;
  /**
   * Picture data for the image elements above, keyed by file id.
   *
   * Excalidraw keeps these apart from the elements, and both halves have to be replayed or a
   * student joining mid-lesson gets picture frames with nothing in them.
   */
  files: Map<string, SceneFile>;
}

interface SceneFile {
  id: string;
  dataURL: string;
  [key: string]: unknown;
}

/** Only the fields the server needs to reason about; the rest is passed through untouched. */
interface SceneElement {
  id: string;
  version: number;
  isDeleted?: boolean;
  [key: string]: unknown;
}

/**
 * The board is broadcast-only, so a student who joins after the teacher has drawn or shared
 * a document would otherwise stare at a blank canvas for the rest of the class. Holding the
 * current board per room lets late joiners be caught up on connect.
 */
const boards = new Map<string, BoardState>();

/**
 * Sessions whose stored whiteboard has already been read back, and the reads in flight.
 *
 * The board lives in memory, so a restart used to erase a lesson — and the API redeploys on
 * every push, which made that an ordinary event rather than a rare one. It is read back once
 * per session, before anyone is told what is on the board, and never again: after that the
 * memory copy is the truth.
 */
const restored = new Set<string>();
const restoring = new Map<string, Promise<void>>();

/** What is worth keeping of a board. Deleted elements included: erasing is an edit. */
function boardToStore(board: BoardState) {
  return {
    scene: [...board.scene.values()],
    files: [...board.files.values()],
    view: board.view,
  };
}

/**
 * Reads a session's whiteboard back into memory, once.
 *
 * Anything already in memory wins: a class that has been running since the process started
 * has the newer copy, and overwriting it with a stored one would undo live work.
 */
async function restoreBoard(sessionId: string): Promise<void> {
  if (restored.has(sessionId)) return;
  const existing = restoring.get(sessionId);
  if (existing) return existing;

  const numericId = Number(sessionId);
  if (!Number.isFinite(numericId)) {
    restored.add(sessionId);
    return;
  }

  const work = (async () => {
    const stored = await loadBoard(numericId);
    const board = getBoard(sessionId);
    // Only fill an empty board. A live one is ahead of anything written down.
    if (stored && board.scene.size === 0) {
      for (const element of stored.scene) {
        const el = element as SceneElement;
        if (el && typeof el.id === "string") board.scene.set(el.id, el);
      }
      for (const file of stored.files) {
        const f = file as SceneFile;
        if (f && typeof f.id === "string") board.files.set(f.id, f);
      }
      if (stored.view && !board.view) board.view = stored.view as BoardState["view"];
      logger.info({ sessionId, elements: board.scene.size }, "whiteboard restored after restart");
    }
  })()
    .catch((err) => {
      logger.warn({ err, sessionId }, "could not restore the whiteboard");
    })
    .finally(() => {
      restoring.delete(sessionId);
      restored.add(sessionId);
    });

  restoring.set(sessionId, work);
  return work;
}

/** Ask for this board to be written down shortly. Collapses repeated calls. */
function rememberBoard(sessionId: string): void {
  const numericId = Number(sessionId);
  if (!Number.isFinite(numericId)) return;
  saveBoardSoon(numericId, () => boardToStore(getBoard(sessionId)));
}

function getBoard(sessionId: string): BoardState {
  let board = boards.get(sessionId);
  if (!board) {
    board = { material: null, paths: [], boardSize: null, view: null, scene: new Map(), files: new Map() };
    boards.set(sessionId, board);
  }
  return board;
}

/**
 * Keeps erased work from filling the room's memory for the rest of the lesson.
 *
 * A deleted element is kept as a tombstone rather than removed, because it is what lets a
 * stale update for something already rubbed out be recognised and dropped. That is worth a
 * little memory but not an unbounded amount, so once a board is implausibly large the oldest
 * tombstones go: the worst case if a very late message then arrives for one is that a stroke
 * briefly reappears, which is a far smaller problem than a lesson that leaks.
 */
function pruneScene(board: BoardState): void {
  if (board.scene.size <= MAX_SCENE_ELEMENTS) return;
  for (const [id, el] of board.scene) {
    if (board.scene.size <= MAX_SCENE_ELEMENTS) break;
    if (el.isDeleted) board.scene.delete(id);
  }
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
  /**
   * The stored copy has to go too, and the "already restored" mark with it.
   *
   * Without this, starting a class would empty the board in memory and then the next person
   * to join would have the *previous* lesson read back over the top of it — the exact thing
   * this reset exists to prevent, reintroduced by the act of making boards survive a restart.
   * Marked as restored so nothing reads it back before the deletion lands.
   */
  restored.add(id);
  const numericId = Number(id);
  if (Number.isFinite(numericId)) void forgetBoard(numericId);

  broadcast(id, { type: "board_clear" });
  broadcast(id, { type: "material_clear" });
}

export function attachClassroomHub(server: http.Server): void {
  // Well above the client's own material cap but far below the library's 100MB default, so a
  // runaway or hostile client cannot buffer an arbitrarily large frame in server memory.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });

  // Both kinds of connection on this server — a classroom and a user channel — are watched by
  // the same heartbeat. See ws/heartbeat.ts for why it has to exist.
  startHeartbeat(wss);

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (!url.pathname.startsWith("/api/ws")) {
      socket.destroy();
      return;
    }

    // A destroyed or reset socket emits 'error'; without a listener that would crash the
    // process, and the membership lookup below gives it time to happen.
    socket.on("error", () => {});

    /**
     * A connection with no `sessionId` is a *user* channel rather than a classroom one: the
     * app opens it once, signed in, to hear about things that happen outside a lesson — a new
     * follower, a message, a class about to start. It still has to prove who it is.
     */
    if (!url.searchParams.get("sessionId")) {
      const token = url.searchParams.get("token") ?? "";
      let payload: JwtPayload;
      try {
        payload = verifyToken(token);
      } catch {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      if (socket.destroyed) return;
      const userId = payload.userId;
      wss.handleUpgrade(req, socket, head, (ws) => {
        const remove = addUserChannel(ws, userId);
        watchHeartbeat(ws);
        logger.info({ userId }, "ws user channel open");
        ws.on("close", remove);
        ws.on("error", () => remove());
      });
      return;
    }

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

/** Tells one client what is already on the board. Called once the stored copy is back. */
function replayBoardTo(ws: WebSocket, sessionId: string): void {
    const board = getBoard(sessionId);
    if (board.material || board.paths.length > 0 || board.boardSize) {
      sendTo(ws, {
        type: "board_state",
        material: board.material,
        paths: board.paths,
        boardSize: board.boardSize,
      });
    }

    // Catch the new arrival up on the object board. Deleted elements are not replayed — nobody
    // joining needs to know what used to be there, and sending them grows the payload forever.
    if (board.scene.size > 0) {
      const elements = [...board.scene.values()].filter((e) => !e.isDeleted);
      // The pictures travel with the elements that reference them, not separately, so a
      // late joiner never renders an image element it has no bytes for.
      const fileIds = new Set(
        elements.map((e) => (typeof e.fileId === "string" ? e.fileId : "")).filter(Boolean),
      );
      const files = [...board.files.values()].filter((f) => fileIds.has(f.id));
      if (elements.length > 0) sendTo(ws, { type: "scene_state", elements, files });
    }

    // Sent after the elements, so the board is pointed at content it already holds.
    if (board.view) sendTo(ws, { type: "board_view", ...board.view });
}


  // Called only from the upgrade handler above, which has already proven this user belongs in
  // this session. Identity is never re-read from the query string here.
  function handleConnection(ws: WebSocket, member: Membership): void {
    const { sessionId, userId, role, name, isSessionTeacher } = member;

    watchHeartbeat(ws);
    const client: RoomClient = { ws, userId, role, name, isSessionTeacher };
    if (!rooms.has(sessionId)) rooms.set(sessionId, new Set());
    rooms.get(sessionId)!.add(client);
    logger.info({ sessionId, userId, role, isSessionTeacher }, "ws join");

    /**
     * The teacher being here is what keeps the class open.
     *
     * Recorded on joining and refreshed while they are connected, so a browser that was
     * force-quit can be told apart from a lesson in progress. Without this a teacher who
     * force-closed was locked out of starting anything else until the class's own length ran
     * out — and had no way back into the class either.
     */
    let presenceTimer: ReturnType<typeof setInterval> | null = null;
    if (isSessionTeacher) {
      const numericId = Number(sessionId);
      if (Number.isFinite(numericId)) {
        void markTeacherPresent(numericId);
        presenceTimer = setInterval(() => {
          if (ws.readyState === 1) void markTeacherPresent(numericId);
        }, TEACHER_PRESENCE_INTERVAL_MS);
        ws.on("close", () => {
          if (presenceTimer) clearInterval(presenceTimer);
        });
      }
    }

    /**
     * The attendance ledger for this connection.
     *
     * Counted here and written in batches, because the alternative is a database round trip
     * per stroke on the busiest path in the product. See lib/participation.ts; the reason any
     * of this is recorded at all is REFUNDS.md — a refund argued three weeks after a lesson
     * has nothing to read unless somebody wrote down who was in the room.
     */
    const numericSessionId = Number(sessionId);
    const ledger = { since: Date.now(), draws: 0, messages: 0, opened: true };
    let ledgerTimer: ReturnType<typeof setInterval> | null = null;

    function flushLedger(): void {
      if (!Number.isFinite(numericSessionId)) return;
      const now = Date.now();
      const delta = {
        presentMs: now - ledger.since,
        drawCount: ledger.draws,
        messageCount: ledger.messages,
        opened: ledger.opened,
      };
      ledger.since = now;
      ledger.draws = 0;
      ledger.messages = 0;
      ledger.opened = false;
      void recordParticipation(
        numericSessionId,
        userId,
        isSessionTeacher ? "teacher" : "student",
        delta,
      );
    }

    if (Number.isFinite(numericSessionId)) {
      // Written immediately rather than on the first flush: a student who opens a class and
      // finds no teacher may well close it inside thirty seconds, and "I was there and nobody
      // came" is exactly the case this ledger exists to be able to answer.
      flushLedger();
      ledgerTimer = setInterval(() => {
        if (ws.readyState === 1) flushLedger();
      }, PARTICIPATION_FLUSH_INTERVAL_MS);
    }

    const count = rooms.get(sessionId)!.size;
    broadcast(sessionId, { type: "presence", count });

    // Read the stored board back before telling this person what is on it. Without this a
    // joiner arriving after a restart is told the board is empty, and that answer is then the
    // one everybody keeps.
    void restoreBoard(sessionId).then(() => {
      replayBoardTo(ws, sessionId);
    });

    ws.on("message", (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()) as Record<string, unknown>; } catch { return; }

      switch (msg.type) {
        case "chat": {
          ledger.messages += 1;
          const text = typeof msg.text === "string" ? msg.text.trim() : "";
          broadcast(sessionId, {
            type: "chat",
            senderName: name,
            // The classroom role, not the account role: a teacher account that enrolled in
            // someone else's class must not be badged as that class's teacher.
            role: isSessionTeacher ? "teacher" : "student",
            text: msg.text,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }, ws);

          /**
           * And kept, which it never was.
           *
           * The in-room chat used to be broadcast and nothing else: it lived in memory and went
           * with the room. That is the whole reason this app has two conversations a person can
           * get lost between — say something during a lesson, watch it vanish, and say it again
           * in the class thread afterwards. Now there is one conversation, and the room is
           * simply another way into it.
           *
           * Written after the broadcast, and never allowed to break the send. Chat that
           * arrives is the live thing people are relying on; a database that is briefly unwell
           * must not stop a teacher answering a question mid-lesson.
           */
          if (text) {
            void (async () => {
              try {
                const target = await threadTargetFor(Number(sessionId));
                await db.insert(sessionMessagesTable).values({
                  ...target,
                  senderId: userId,
                  senderName: name,
                  senderRole: isSessionTeacher ? "teacher" : "student",
                  body: text.slice(0, 4000),
                });
              } catch (err) {
                logger.warn({ err, sessionId }, "could not keep a message said during a class");
              }
            })();
          }
          break;
        }
        // Board writes are gated on owning this session, not on merely holding a teacher
        // role — otherwise any teacher account could draw on and replace the material of
        // another teacher's live class.
        case "draw_commit": {
          if (!isSessionTeacher) break;
          const shape = sanitizeDrawCommit(msg);
          if (!shape) break;
          ledger.draws += 1;
          const board = getBoard(sessionId);
          board.paths.push(shape);
          if (board.paths.length > MAX_REPLAY_PATHS) board.paths.shift();
          broadcast(sessionId, shape, ws);
          break;
        }
        case "scene_update": {
          // Only the teacher may change the board, exactly as with strokes.
          if (!isSessionTeacher) break;
          const incoming = Array.isArray(msg.elements) ? (msg.elements as SceneElement[]) : [];
          if (incoming.length === 0 || incoming.length > MAX_SCENE_ELEMENTS) break;

          // One per board-changing message, not per element: Excalidraw re-sends an element on
          // every frame of a drag, so counting elements would say a teacher who drew one line
          // and moved it about had drawn four hundred things.
          ledger.draws += 1;

          const board = getBoard(sessionId);
          const accepted: SceneElement[] = [];
          for (const el of incoming) {
            if (!el || typeof el.id !== "string" || typeof el.version !== "number") continue;
            const existing = board.scene.get(el.id);
            // A lower version is a stale message that overtook a newer one. Dropping it here
            // rather than forwarding it keeps every client's copy identical to the server's.
            if (existing && existing.version >= el.version) continue;
            board.scene.set(el.id, el);
            accepted.push(el);
          }
          // Picture data for any images in this batch. Each is stored once and replayed to
          // whoever joins later; anything implausibly large is dropped rather than relayed,
          // because a single oversized frame stalls every phone in the room.
          const incomingFiles = Array.isArray(msg.files) ? (msg.files as SceneFile[]) : [];
          const acceptedFiles: SceneFile[] = [];
          /** Pictures refused here, so the frames that need them are refused too. */
          const refusedFiles = new Set<string>();
          for (const file of incomingFiles) {
            if (!file || typeof file.id !== "string" || typeof file.dataURL !== "string") continue;
            if (file.dataURL.length > MAX_MATERIAL_CHARS) {
              logger.warn({ sessionId, userId, size: file.dataURL.length }, "ws board image too large, dropped");
              sendTo(ws, { type: "material_rejected", reason: "too_large" });
              refusedFiles.add(file.id);
              continue;
            }
            if (board.files.size >= MAX_SCENE_FILES && !board.files.has(file.id)) {
              logger.warn({ sessionId, userId, files: board.files.size }, "ws board has too many pictures, dropped");
              sendTo(ws, { type: "material_rejected", reason: "too_many" });
              refusedFiles.add(file.id);
              continue;
            }
            board.files.set(file.id, file);
            acceptedFiles.push(file);
          }

          /**
           * A picture frame is never sent without its picture.
           *
           * Elements and their pictures were filtered independently, so a picture refused just
           * above — too large, or past the limit on how many a board may hold — left its
           * element to travel on alone. Every student then rendered a grey placeholder where
           * the page should be, permanently, while the teacher's own board looked right because
           * it draws from local memory. That is the worst shape a bug can take here: the two
           * sides disagree and neither person is told.
           *
           * A frame whose picture the board already holds is fine — that is an element being
           * re-sent after a move, and its picture went out the first time.
           */
          const deliverable = accepted.filter((el) => {
            const fileId = typeof el.fileId === "string" ? el.fileId : null;
            if (!fileId) return true;
            if (board.files.has(fileId)) return true;
            return !refusedFiles.has(fileId);
          });

          // Dropped from the stored board too, or a late joiner is replayed the same empty frame.
          for (const el of accepted) {
            if (!deliverable.includes(el)) board.scene.delete(el.id);
          }

          pruneScene(board);
          if (deliverable.length > 0) {
            broadcast(sessionId, { type: "scene_update", elements: deliverable, files: acceptedFiles }, ws);
            // Written down shortly, so a restart mid-lesson does not erase the board.
            rememberBoard(sessionId);
          }
          break;
        }

        case "board_clear":
          if (isSessionTeacher) {
            getBoard(sessionId).paths = [];
            getBoard(sessionId).scene.clear();
            getBoard(sessionId).files.clear();
            broadcast(sessionId, { type: "board_clear" }, ws);
            // Cleared means cleared, including through a restart — otherwise wiping the board
            // and restarting would bring the whole lesson back.
            const cleared = Number(sessionId);
            if (Number.isFinite(cleared)) void forgetBoard(cleared);
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
        case "board_view": {
          // Only the teacher leads the class, so only the teacher moves everyone's view.
          if (!isSessionTeacher) break;
          const minX = typeof msg.minX === "number" ? msg.minX : NaN;
          const minY = typeof msg.minY === "number" ? msg.minY : NaN;
          const maxX = typeof msg.maxX === "number" ? msg.maxX : NaN;
          const maxY = typeof msg.maxY === "number" ? msg.maxY : NaN;
          if (![minX, minY, maxX, maxY].every(Number.isFinite)) break;
          if (maxX <= minX || maxY <= minY) break;
          const view = { minX, minY, maxX, maxY };
          getBoard(sessionId).view = view;
          broadcast(sessionId, { type: "board_view", ...view }, ws);
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
      // Before anything else: whatever this connection did is written down even if the room
      // teardown below throws. A lesson's evidence is not worth losing to a tidying-up bug.
      if (ledgerTimer) clearInterval(ledgerTimer);
      flushLedger();

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
