/**
 * Who gets a tile in a discussion, at what quality, and whose camera is worth paying for.
 *
 * ## This is the cost decision, not a layout preference
 *
 * LiveKit bills per participant-minute *and* per gigabyte, and in a class the download dominates:
 * one person sending a camera is one stream, ten people receiving it is ten. So the question that
 * decides whether Monthly survives contact with its own price is not "how many cameras are on" —
 * it is "how many cameras is each phone subscribed to". A ten-person discussion where everybody
 * subscribes to everybody is ninety streams; capped at four visible tiles it is forty, and the
 * ones that are left are the ones somebody is actually looking at.
 *
 * Unsubscribing is also the only saving that works on the receiving end. `adaptiveStream` already
 * asks for the smallest simulcast layer a tile needs, and `dynacast` stops encoding a layer nobody
 * wants — but both of those still carry a stream. Not subscribing carries nothing.
 *
 * ## Hysteresis, because a grid that reshuffles is unusable
 *
 * Active speakers change several times a second in a real conversation. A layout that followed
 * them exactly would swap tiles mid-sentence, and on a phone that means a person tapping "mute"
 * on somebody who was in that spot a moment ago. So a tile keeps its place for `HOLD_MS` after its
 * owner stops talking, and a newcomer only takes a place from somebody who has been quiet longer
 * than that. The result is a grid that settles.
 *
 * Pure, and tested on its own, for the reason `speakingFloor.ts` gives: a rule that can only be
 * exercised by putting ten people in a live discussion is a rule nobody exercises.
 */

/** How long a tile keeps its place after its owner stops talking. */
export const HOLD_MS = 4000;

/**
 * How many student tiles a screen of a given width can carry.
 *
 * Four on a phone is the brief's number and it is the right one: a 390-point screen split four
 * ways gives tiles about 180 points wide, which is a face. Six of them is a thumbnail nobody can
 * read an expression from, and it costs half as much again in bandwidth to be less useful.
 */
export function tileCapacity(width: number): number {
  if (width < 600) return 4;
  if (width < 1000) return 6;
  return 9;
}

/** What quality to ask the provider for. Maps onto the simulcast layers being published. */
export type TileQuality = "low" | "medium" | "high";

export interface LayoutPerson {
  id: string;
  isLocal: boolean;
  /** Whether they are sending a camera at all. Somebody audio-only takes no video budget. */
  hasCamera: boolean;
  /** As reported by the provider this moment. */
  isSpeaking: boolean;
}

/** Who last spoke and when, carried between frames. Server-independent; this is a view concern. */
export type SpeakerMemory = Readonly<Record<string, number>>;

/**
 * Fold this moment's speakers into the memory.
 *
 * Kept as plain data rather than a class so it can live in a ref and be tested by calling it.
 * Anybody who is speaking right now gets `now`; everybody else keeps whatever they had, which is
 * what makes "who has been quiet longest" answerable.
 */
export function rememberSpeakers(memory: SpeakerMemory, people: LayoutPerson[], now: number): SpeakerMemory {
  let changed = false;
  const next: Record<string, number> = { ...memory };
  const present = new Set(people.map((p) => p.id));
  for (const person of people) {
    if (person.isSpeaking && next[person.id] !== now) {
      next[person.id] = now;
      changed = true;
    }
  }
  // Somebody who left stops competing for a tile. Left in otherwise, the memory grows for the
  // whole lesson and a student who dropped an hour ago still outranks one who just arrived.
  for (const id of Object.keys(next)) {
    if (!present.has(id)) {
      delete next[id];
      changed = true;
    }
  }
  return changed ? next : memory;
}

export interface LayoutPlan {
  /** Ordered ids that get a tile, most important first. */
  visible: string[];
  /** Ids whose camera should be subscribed. A subset of `visible` — those actually sending one. */
  subscribe: string[];
  /** Ids whose camera should be dropped, because nothing on screen is showing it. */
  unsubscribe: string[];
  /** What to ask for, per visible id. */
  quality: Record<string, TileQuality>;
  /** How many people are in the discussion but off screen. Shown as "+3 more". */
  overflow: number;
}

export interface LayoutInput {
  people: LayoutPerson[];
  /** The class's teacher, who is never dropped. Null when their id is not known yet. */
  teacherId: string | null;
  /** Whoever the teacher has featured, from the floor. Null for the ordinary grid. */
  spotlightId: string | null;
  memory: SpeakerMemory;
  now: number;
  /** From `tileCapacity`, or a caller that knows better about its own box. */
  capacity: number;
}

/**
 * Decide the grid.
 *
 * Order of claim, and each step is a rule somebody would otherwise argue about mid-lesson:
 *
 * 1. **The local participant.** Always on screen; their own tile costs no download at all.
 * 2. **The teacher.** The class is a lesson, not a conference — losing the teacher's face because
 *    four students are talking would be absurd, so they hold a place unconditionally.
 * 3. **The spotlight.** The teacher chose it explicitly, which outranks anything automatic.
 * 4. **Recent speakers**, most recent first, with the hold below.
 * 5. **Everybody else**, by id, so the grid is stable rather than in arrival order.
 */
export function planDiscussionLayout(input: LayoutInput): LayoutPlan {
  const { people, teacherId, spotlightId, memory, now, capacity } = input;

  const claimed: string[] = [];
  const claim = (id: string | null | undefined) => {
    if (!id) return;
    if (claimed.includes(id)) return;
    if (!people.some((p) => p.id === id)) return;
    claimed.push(id);
  };

  const local = people.find((p) => p.isLocal);
  claim(local?.id);
  claim(teacherId);
  claim(spotlightId);

  /*
    Everybody else, ranked by how recently they spoke — with the hold applied.

    The hysteresis is in the *age*, not the timestamp. Everyone's silence is measured from `now`
    and rounded down to a whole `HOLD_MS`, so two people whose last words were three seconds apart
    are equally recent and are then ordered by id — a tile does not change hands over a cough.
    Somebody who has never spoken has an age of `now` itself, an enormous bucket, and sorts last.
    Ordering among people who spoke a while ago is kept, which is what a listener expects: thirty
    seconds ago still beats never.
  */
  const rest = people
    .filter((p) => !claimed.includes(p.id))
    .map((p) => {
      const spokeAt = p.isSpeaking ? now : (memory[p.id] ?? 0);
      /*
        Bucketed against `now` rather than against the epoch.

        An earlier version floored the timestamp itself, which made the hold depend on where the
        clock happened to fall inside a four-second window: two people a second apart landed in
        one bucket or two according to the time of day. Nothing about that is reproducible, which
        is exactly the property a test needs and a teacher deserves.
      */
      return { p, age: Math.floor(Math.max(0, now - spokeAt) / HOLD_MS) };
    })
    .sort((a, b) => (a.age - b.age) || a.p.id.localeCompare(b.p.id));

  for (const { p } of rest) {
    if (claimed.length >= capacity) break;
    claimed.push(p.id);
  }

  /*
    Quality, and it is deliberately coarse.

    The three levels map onto the three simulcast layers the app publishes — 180p, 360p and 480p —
    so asking for "low" is asking for the layer that is already being sent rather than for a
    transcode nobody is doing. `high` goes only to the one tile that is large: whoever is featured,
    or the teacher when nobody is. Everything else is a thumbnail and a thumbnail wants 180p.
  */
  const focus = spotlightId && claimed.includes(spotlightId) ? spotlightId : teacherId;
  const quality: Record<string, TileQuality> = {};
  for (const id of claimed) {
    quality[id] = id === focus ? "high" : claimed.length <= 2 ? "medium" : "low";
  }

  const visibleSet = new Set(claimed);
  const subscribe: string[] = [];
  const unsubscribe: string[] = [];
  for (const person of people) {
    // The local camera is never subscribed to — it is already in this browser.
    if (person.isLocal) continue;
    if (!person.hasCamera) continue;
    (visibleSet.has(person.id) ? subscribe : unsubscribe).push(person.id);
  }

  return {
    visible: claimed,
    subscribe,
    unsubscribe,
    quality,
    overflow: Math.max(0, people.length - claimed.length),
  };
}
