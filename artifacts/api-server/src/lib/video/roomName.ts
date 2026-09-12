/**
 * What a class's room is called, whoever is carrying the call.
 *
 * Daily, LiveKit and the evidence parser now share this rule. Without a namespace it retains
 * the original `sikshya42` identity. Preview can opt into a distinct server-only namespace so
 * equal session IDs in separate databases never send people into the same provider room.
 * This does not select or enable a video provider, nor change membership.
 */

/**
 * The room for a class, from its id.
 *
 * Lossy in general — an id of `1-2` and one of `12` both give `sikshya12` — which is why the
 * inverse in `providerEvents.ts` is strict and refuses anything that is not `sikshya` followed
 * by digits. Session ids are integers, so for this product the mapping is one to one.
 */
export function roomNameForSession(rawId: string | number, namespace?: string): string {
  return videoRoomPrefix(namespace) + String(rawId).replace(/[^a-zA-Z0-9]/g, "");
}

/** Default stays unchanged. Invalid preview configuration must never select a production room. */
export function videoRoomPrefix(namespace: string | undefined = process.env.VIDEO_ROOM_NAMESPACE): string {
  if (namespace === undefined || namespace === "") return "sikshya";
  if (!/^[a-z][a-z0-9-]{2,31}$/.test(namespace)) throw new Error("Invalid video room namespace");
  return `${namespace}-sikshya`;
}

/** Strict inverse: another deployment's rooms cannot become this database's evidence. */
export function sessionIdForRoom(room: string | null | undefined, namespace?: string): number | null {
  const prefix = videoRoomPrefix(namespace);
  if (typeof room !== "string" || !room.trim().startsWith(prefix)) return null;
  const digits = room.trim().slice(prefix.length);
  if (!/^[1-9][0-9]*$/.test(digits)) return null;
  const id = Number(digits);
  return Number.isSafeInteger(id) && String(id) === digits ? id : null;
}
