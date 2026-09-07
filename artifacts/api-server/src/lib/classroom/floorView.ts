/**
 * What each person is told about the floor — and, more to the point, what they are not.
 *
 * The floor holds every student's request, invitation and permission. The teacher needs all of
 * that: it is their queue and their moderation panel. A student needs their own row and a few
 * facts about the room, and nothing whatever about anybody else's.
 *
 * ## Why that is a separate file rather than a filter at the send site
 *
 * Because the mistake it prevents is invisible. A hub that builds one payload and sends it to
 * everybody works perfectly, looks right in every screenshot, and quietly tells a fifteen-year-old
 * which of their classmates has their hand up and whose microphone the teacher just took away.
 * Nobody would notice until somebody read the frames. Two named functions with two shapes cannot
 * be got wrong by accident: `studentView` has no way to express another student.
 *
 * ## The queue position is the one exception, and it is deliberate
 *
 * A student is told *how many* hands are up and *where in the line* they are. No names, no ids.
 * The alternative — a spinner that says "waiting" for eight minutes — is the thing that makes a
 * child on a bad connection tap the button four more times, which is the behaviour the
 * idempotence in `speakingFloor.ts` exists to survive. Telling them "you are third" costs nothing
 * and answers the question they are actually asking.
 */
import {
  mediaStateOf,
  requestQueue,
  type Floor,
  type InvitationScope,
  type MediaState,
} from "./speakingFloor.ts";

/** One row of the teacher's participant list. */
export interface FloorRow {
  userId: number;
  /** Last known display name, from the database rather than anything the client said. */
  name: string;
  state: MediaState;
  /** Server time, so the queue is ordered by one clock. Null when they are not waiting. */
  requestedAt: number | null;
  invitedAt: number | null;
  invitationScope: InvitationScope | null;
  connected: boolean;
  /** What the server permits, as against what they have switched on. Both matter to a teacher. */
  allowedMic: boolean;
  allowedCamera: boolean;
}

export interface TeacherFloorView {
  scope: "teacher";
  mode: Floor["mode"];
  discussionEligible: boolean;
  discussionStartedAt: number | null;
  spotlight: number | null;
  /** Everybody the class knows about, including people who have dropped off. */
  students: FloorRow[];
  /** Who is waiting, oldest first. The same order `requestQueue` gives, sent rather than re-derived. */
  queue: number[];
}

export interface StudentFloorView {
  scope: "student";
  mode: Floor["mode"];
  /** Whether this class carries the Monthly benefit at all. Decides whether to draw anything. */
  discussionEligible: boolean;
  discussionStartedAt: number | null;
  spotlight: number | null;
  /** This viewer's own row, and only this viewer's. */
  you: {
    state: MediaState;
    requestedAt: number | null;
    invitedAt: number | null;
    invitationScope: InvitationScope | null;
    allowedMic: boolean;
    allowedCamera: boolean;
    acceptedMic: boolean;
    acceptedCamera: boolean;
  };
  /** How many hands are up, without saying whose. */
  handsUp: number;
  /** This viewer's place in that line, 1-based. Null when they are not in it. */
  queuePosition: number | null;
}

export type FloorView = TeacherFloorView | StudentFloorView;

/** The whole floor, for the one person entitled to see it. */
export function teacherView(floor: Floor, names: ReadonlyMap<number, string>): TeacherFloorView {
  const students: FloorRow[] = [];
  for (const [userId, s] of floor.students) {
    students.push({
      userId,
      name: names.get(userId) ?? "Student",
      state: mediaStateOf(s),
      requestedAt: s.requestedAt,
      invitedAt: s.invitedAt,
      invitationScope: s.invitationScope,
      connected: s.connected,
      allowedMic: s.allowed.mic,
      allowedCamera: s.allowed.camera,
    });
  }
  return {
    scope: "teacher",
    mode: floor.mode,
    discussionEligible: floor.discussionEligible,
    discussionStartedAt: floor.discussionStartedAt,
    spotlight: floor.spotlight,
    students,
    queue: requestQueue(floor).map((r) => r.userId),
  };
}

/** One student's own row, plus the two room facts their screen needs. */
export function studentView(floor: Floor, userId: number): StudentFloorView {
  const s = floor.students.get(userId);
  const queue = requestQueue(floor);
  const at = queue.findIndex((r) => r.userId === userId);
  return {
    scope: "student",
    mode: floor.mode,
    discussionEligible: floor.discussionEligible,
    discussionStartedAt: floor.discussionStartedAt,
    spotlight: floor.spotlight,
    you: s
      ? {
          state: mediaStateOf(s),
          requestedAt: s.requestedAt,
          invitedAt: s.invitedAt,
          invitationScope: s.invitationScope,
          allowedMic: s.allowed.mic,
          allowedCamera: s.allowed.camera,
          acceptedMic: s.accepted.mic,
          acceptedCamera: s.accepted.camera,
        }
      : {
          // A student who has done nothing yet has no row, and "audience" is the truthful answer
          // rather than a placeholder: nothing is granted and nothing is pending.
          state: "audience",
          requestedAt: null,
          invitedAt: null,
          invitationScope: null,
          allowedMic: false,
          allowedCamera: false,
          acceptedMic: false,
          acceptedCamera: false,
        },
    handsUp: queue.length,
    queuePosition: at === -1 ? null : at + 1,
  };
}
