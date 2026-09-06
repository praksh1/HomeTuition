import { logger } from "./logger";
import { ROOM_PROPERTIES, propertiesToRepair, roomExpiry } from "./dailyRoom";
import { providerUserId } from "./video/participantIdentity";

const DAILY_API_BASE = "https://api.daily.co/v1";

export function sanitizeRoomName(rawId: string): string {
  return "sikshya" + rawId.replace(/[^a-zA-Z0-9]/g, "");
}

export interface MeetingTokenOptions {
  /** Owners can mute and eject others; only the session's own teacher should get this. */
  isOwner: boolean;
  userName: string;
  /**
   * The authenticated Sikshya user id, echoed back to us on every webhook Daily sends.
   *
   * Without it Daily can report that *an owner* joined and never *which account*, which is the
   * single limitation that stops provider events corroborating attendance for a named person.
   *
   * **It grants nothing.** Rights come from `isOwner`, which comes from this server's own
   * membership check in `lib/membership.ts`. A token is minted server-side precisely so its claims
   * are ours, and a `user_id` a client could choose would be a claim about identity with no check
   * behind it — so this value is taken from `req.user`, never from a request body.
   */
  userId: number;
}


/**
 * Mints a Daily meeting token.
 *
 * Without a token everyone joins as an ordinary participant, so nobody can mute anyone —
 * "mute everyone" is not a UI we can build, it is a permission Daily grants to a room owner.
 * The token is created server-side precisely so a student cannot mint themselves one.
 *
 * Returns null when no API key is configured, or if minting fails; the caller then joins
 * without a token, which still works but without moderator powers.
 */
export async function createMeetingToken(
  sessionId: string | number,
  { isOwner, userName, userId }: MeetingTokenOptions,
): Promise<string | null> {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) return null;

  const claimedUserId = providerUserId(userId);

  try {
    const res = await fetch(`${DAILY_API_BASE}/meeting-tokens`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: {
          room_name: sanitizeRoomName(String(sessionId)),
          is_owner: isOwner,
          user_name: userName,
          /*
            Identity, not permission.

            Daily echoes this back on `participant.joined` / `participant.left`, which is the only
            way a provider event can name an account rather than describing "somebody with
            moderator rights". Omitted entirely when it would not fit, so a wrong id never lands.
          */
          ...(claimedUserId !== null ? { user_id: claimedUserId } : {}),
          // Tokens outlive a long class but not the day.
          exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
        },
      }),
    });
    if (!res.ok) {
      logger.error({ status: res.status, body: await res.text() }, "Failed to mint Daily meeting token");
      return null;
    }
    const data = (await res.json()) as { token?: string };
    return data.token ?? null;
  } catch (err) {
    logger.error({ err }, "Error minting Daily meeting token");
    return null;
  }
}

/**
 * Ensures a Daily.co room exists for the given session, creating it via the REST API
 * if it doesn't already exist. Daily rooms are NOT created automatically just by
 * visiting a room URL — joining a URL for a room that was never created via the API
 * fails with "The meeting you're trying to join does not exist." This must be called
 * (idempotently) before any client attempts to join the room's WebView/iframe.
 *
 * Returns the room URL to join. Falls back to a best-effort URL guess (without
 * guaranteeing the room exists) if DAILY_API_KEY isn't configured, so local/dev
 * environments without a key don't hard-crash — but joining will fail in that case.
 */
export async function ensureDailyRoom(sessionId: string | number): Promise<string> {
  const roomName = sanitizeRoomName(String(sessionId));
  const apiKey = process.env.DAILY_API_KEY;

  if (!apiKey) {
    logger.warn({ roomName }, "DAILY_API_KEY not set; skipping Daily room creation");
    const domain = process.env.EXPO_PUBLIC_DAILY_DOMAIN || "sikshya.daily.co";
    return `https://${domain}/${roomName}`;
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const getRes = await fetch(`${DAILY_API_BASE}/rooms/${roomName}`, { headers });
  if (getRes.ok) {
    const room = (await getRes.json()) as { url: string; config?: Record<string, unknown> };
    const repairs = propertiesToRepair(room.config);
    if (Object.keys(repairs).length > 0) {
      // Costs one extra call, and only when something is actually wrong. A room that is already
      // right — which is every room made since it was created — goes straight through.
      logger.info({ roomName, repairs: Object.keys(repairs) }, "repairing Daily room settings");
      const patch = await fetch(`${DAILY_API_BASE}/rooms/${roomName}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ properties: repairs }),
      });
      if (!patch.ok) {
        // Not fatal. A call with the wrong settings is worth far more than no call at all, and
        // the room URL is still good — so this is logged and the lesson goes ahead.
        logger.warn(
          { roomName, status: patch.status, body: await patch.text() },
          "could not repair Daily room settings; joining anyway",
        );
      }
    }
    return room.url;
  }

  if (getRes.status !== 404) {
    const body = await getRes.text();
    logger.error({ roomName, status: getRes.status, body }, "Failed to look up Daily room");
    throw new Error(`Daily room lookup failed: ${getRes.status}`);
  }

  const createRes = await fetch(`${DAILY_API_BASE}/rooms`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: roomName,
      privacy: "public",
      properties: { ...ROOM_PROPERTIES, exp: roomExpiry() },
    }),
  });

  if (!createRes.ok) {
    // Room may have been created concurrently by a race (teacher + student both
    // triggering ensureDailyRoom at once) — treat "already exists" as success.
    if (createRes.status === 400) {
      const body = await createRes.text();
      if (body.includes("already exists")) {
        const domain = process.env.EXPO_PUBLIC_DAILY_DOMAIN || "sikshya.daily.co";
        return `https://${domain}/${roomName}`;
      }
    }
    const body = await createRes.text();
    logger.error({ roomName, status: createRes.status, body }, "Failed to create Daily room");
    throw new Error(`Daily room creation failed: ${createRes.status}`);
  }

  const created = (await createRes.json()) as { url: string };
  return created.url;
}
