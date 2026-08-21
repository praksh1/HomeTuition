/**
 * What a classroom's video room must have switched on, and what an existing one is missing.
 *
 * Split out from daily.ts with no imports of its own, deliberately: that file needs an API key
 * and a network, and this is the one decision inside it that was wrong. Pure, so it can be
 * tested on a laptop — the same reason sessionStart.ts is its own file.
 */
/**
 * What every classroom room must have switched on.
 *
 * Chat, hand raising and reactions come from Daily Prebuilt.
 *
 * Daily's own chat is on at the owner's decision after using both. The app's in-call chat panel
 * took over the screen on a phone and could not be closed again, which on a small screen makes
 * the call itself unusable. Daily's chat comes with the call, is built for that space, and is
 * not ours to get wrong.
 *
 * The known cost, unchanged and worth restating: Prebuilt's chat exists on **web only**. The
 * installed iOS and Android apps drive Daily's native SDK behind our own call UI, and their chat
 * is the app's Chat tab, carried by the classroom socket. A class mixing an installed app with a
 * browser therefore has two conversations that cannot see each other, and both sides look like
 * they are working. Everyone is on browsers today, so this is a real cost that is not currently
 * being paid — but it comes due the day the app ships to a store. See
 * .agents/memory/one-chat-per-class.md.
 */
export const ROOM_PROPERTIES = {
  enable_chat: true,
  enable_hand_raising: true,
  enable_emoji_reactions: true,
  enable_people_ui: true,
  enable_network_ui: true,
  enable_noise_cancellation_ui: true,
  enable_screenshare: true,
  start_video_off: false,
  start_audio_off: false,
} as const;

/** Rooms are torn down 6h after creation; a class running longer than that would drop. */
export function roomExpiry(): number {
  return Math.floor(Date.now() / 1000) + 60 * 60 * 6;
}

/**
 * Which of the settings above an existing room is missing.
 *
 * A room is created once and then reused for the rest of its life, so its settings are frozen at
 * whatever they were the day it was made — and every change to the list above reaches new rooms
 * only. That is not hypothetical: turning Daily's chat on left every room already in existence
 * without a chat panel, and a teacher in one of those was told the feature was live while their
 * call plainly had no chat in it. Reported exactly that way.
 *
 * Pure, and exported, so the comparison can be tested without an API key or a network — the two
 * things this file otherwise cannot be tested without.
 */
export function propertiesToRepair(
  config: Record<string, unknown> | undefined | null,
): Record<string, boolean> {
  const repairs: Record<string, boolean> = {};
  if (!config) return { ...ROOM_PROPERTIES };
  for (const [key, wanted] of Object.entries(ROOM_PROPERTIES)) {
    // Absent means Daily's default rather than ours, which is exactly the case worth fixing.
    if (config[key] !== wanted) repairs[key] = wanted;
  }
  return repairs;
}
