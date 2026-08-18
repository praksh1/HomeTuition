import { logger } from "./logger";

const DAILY_API_BASE = "https://api.daily.co/v1";

export function sanitizeRoomName(rawId: string): string {
  return "sikshya" + rawId.replace(/[^a-zA-Z0-9]/g, "");
}

export interface MeetingTokenOptions {
  /** Owners can mute and eject others; only the session's own teacher should get this. */
  isOwner: boolean;
  userName: string;
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
  { isOwner, userName }: MeetingTokenOptions,
): Promise<string | null> {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(`${DAILY_API_BASE}/meeting-tokens`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: {
          room_name: sanitizeRoomName(String(sessionId)),
          is_owner: isOwner,
          user_name: userName,
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
    const room = (await getRes.json()) as { url: string };
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
      properties: {
        // Chat, hand raising and reactions come from Daily Prebuilt.
        //
        // Caveat worth remembering: Prebuilt is the *web* experience. The installed
        // Android/iOS app uses Daily's native SDK behind our own call interface (a WebView
        // cannot capture the screen for screen sharing), and that has no Prebuilt panels, so
        // it does not get these. Browsers on a phone do — they run the web build. Until the
        // native app grows its own chat, a class mixing installed-app and browser users would
        // have two separate conversations.
        // Daily's chat is deliberately off. Prebuilt's chat exists only on web, and the
        // installed app uses the native SDK behind our own call UI, which now carries the
        // app's own chat. Enabling both would split one class into two conversations —
        // browser users talking inside the iframe, phone-app users talking in the app, with
        // neither able to see the other. One chat, carried by our websocket, reaches both.
        enable_chat: false,
        enable_hand_raising: true,
        enable_emoji_reactions: true,
        enable_people_ui: true,
        enable_network_ui: true,
        enable_noise_cancellation_ui: true,
        enable_screenshare: true,
        start_video_off: false,
        start_audio_off: false,
        // Rooms are torn down 6h after creation; a class running longer than that would drop.
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 6,
      },
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
