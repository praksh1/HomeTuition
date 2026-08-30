/**
 * How a classroom's video room must be configured, and what an existing one is missing.
 *
 * Split out from daily.ts with no imports of its own, deliberately: that file needs an API key
 * and a network, and this is the one decision inside it that was wrong. Pure, so it can be
 * tested on a laptop — the same reason sessionStart.ts is its own file.
 */
/**
 * What every classroom room must enforce.
 *
 * The classroom owns chat and the only floating video window.
 *
 * Daily Prebuilt's chat is deliberately off: it is a second conversation that does not share
 * messages with the classroom socket or the installed apps. Its Picture in Picture control is
 * also off because both classroom screens already provide one draggable PIP. Repairing these
 * false values matters for old rooms as much as including them when a new room is created.
 */
export const ROOM_PROPERTIES = {
  enable_chat: false,
  enable_pip_ui: false,
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
 * only. That is not hypothetical: an earlier chat change reached new rooms but not old ones,
 * leaving classrooms with different controls. Both true and false settings therefore need the
 * same repair path.
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
