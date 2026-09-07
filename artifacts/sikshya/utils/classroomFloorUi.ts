import type {
  FloorRow,
  InvitationScope,
  MediaState,
  StudentFloorView,
  TeacherFloorView,
} from "@/hooks/useClassroomSocket";

/**
 * What each person is *offered*, worked out apart from how it is drawn.
 *
 * ## Why this is a file and not a pile of ternaries in a component
 *
 * The classroom floor has nine media states, two modes, an invitation that may or may not be
 * outstanding, and a camera limit that applies in one mode and not the other. Rendered inline that
 * is roughly forty branches inside a `<View>`, and the ones that are wrong are the ones nobody
 * looks at — a student invited to speak in a discussion, a teacher's row for somebody who dropped
 * mid-answer. Here they are ordinary function calls with a test each.
 *
 * ## It offers; it never decides
 *
 * Nothing in this file grants anything. Every button it produces carries an *intent* that the
 * component sends to the server, and the server checks it again from scratch. A button that
 * should not be there is a cosmetic bug; a button that works when it should not would be a
 * security one, and this file is structurally incapable of causing the second.
 *
 * ## The words
 *
 * Written for a fifteen-year-old on a borrowed phone and for an eighty-year-old teacher, which is
 * the range CLAUDE.md names. So: "Ask to speak", not "Request floor". "Your teacher turned your
 * microphone off", not "Muted by moderator" — the second reads as a system event and leaves a
 * child wondering what they did.
 */

/** How a state should look: a colour role, not a colour. */
export type FloorTone = "neutral" | "waiting" | "live" | "stopped";

export interface FloorChip {
  label: string;
  tone: FloorTone;
}

/**
 * The label somebody reads for one media state.
 *
 * Two vocabularies, because "Speaking" is right on a teacher's list and wrong on your own screen,
 * where it should say "You're speaking". Sharing one string would make one of the two read like a
 * status report about somebody else.
 */
export function mediaChip(state: MediaState, mine = false): FloorChip {
  switch (state) {
    case "requested":
      return { label: mine ? "Hand up" : "Hand up", tone: "waiting" };
    case "invited":
      return { label: mine ? "You've been asked to speak" : "Asked to speak", tone: "waiting" };
    case "allowed-not-accepted":
      return { label: mine ? "You can speak" : "Can speak — not on yet", tone: "waiting" };
    case "speaking":
      return { label: mine ? "You're speaking" : "Speaking", tone: "live" };
    case "camera-active":
      return { label: mine ? "You're on camera" : "On camera", tone: "live" };
    case "muted-by-teacher":
      return { label: mine ? "You were turned off" : "Turned off", tone: "stopped" };
    case "muted-by-self":
      return { label: mine ? "Your microphone is off" : "Microphone off", tone: "stopped" };
    case "disconnected":
      return { label: "Lost connection", tone: "stopped" };
    case "audience":
    default:
      return { label: mine ? "Listening" : "Listening", tone: "neutral" };
  }
}

/** What pressing a button asks the server for. The component does not invent these. */
export type FloorIntent =
  | { do: "ask" }
  | { do: "cancelAsk" }
  | { do: "accept"; scope: InvitationScope }
  | { do: "setCamera"; on: boolean }
  | { do: "decline" }
  | { do: "listenOnly" }
  | { do: "joinDiscussion"; scope: InvitationScope }
  | { do: "leaveDiscussion" };

export interface FloorButton {
  /** Stable across renders and across states, so a test can name one control. */
  id: string;
  label: string;
  /** What a press does, spoken. "Speak" alone does not say whether it starts or stops. */
  spoken: string;
  emphasis: "primary" | "secondary" | "quiet";
  intent: FloorIntent;
}

export interface FloorOffer {
  /** The heading. Null when the student has nothing to be told and nothing to do. */
  title: string | null;
  /** One line under it. Null when the title says everything. */
  body: string | null;
  buttons: FloorButton[];
  /** True when this needs to interrupt — an invitation, or being turned off mid-sentence. */
  urgent: boolean;
}

/**
 * "3rd", "21st", "42nd".
 *
 * Written out properly rather than as a lookup with a "th" fallback, because a monthly class can
 * hold forty-five students and "42th in line" is the kind of small wrongness that makes a person
 * trust the rest of the screen less. The three teens are the exception every implementation of
 * this gets wrong first: 11, 12 and 13 take "th", not "st", "nd" and "rd".
 */
export function ordinal(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * Everything a student is shown about their own place, in one answer.
 *
 * Ordered by what interrupts. An invitation and a teacher's mute come first because both happen
 * *to* the student and both need answering; the rest is what they can choose to do next.
 */
export function studentOffer(view: StudentFloorView): FloorOffer {
  const you = view.you;
  const discussion = view.mode === "discussion";

  /*
    An invitation, which is the one thing that must interrupt.

    Recognised by `invitedAt` rather than by the state, because the state is already
    `allowed-not-accepted`: the invitation carries the permission, and the permission is inert
    until the student answers. Reading only the state would show "you can speak" to a child who
    has no idea their teacher just asked them a question.
  */
  if (you.invitedAt !== null && (you.allowedMic || you.allowedCamera)) {
    const withCamera = you.allowedCamera;
    return {
      title: "Your teacher has asked you to speak",
      body: withCamera ? "You can turn your camera on too, if you want to." : null,
      urgent: true,
      buttons: [
        {
          id: "accept-mic",
          label: "Speak",
          spoken: "Turn my microphone on and speak",
          emphasis: "primary",
          intent: { do: "accept", scope: "mic" },
        },
        ...(withCamera
          ? [
              {
                id: "accept-camera",
                label: "Speak with camera",
                spoken: "Turn my microphone and camera on",
                emphasis: "secondary" as const,
                intent: { do: "accept" as const, scope: "mic+camera" as InvitationScope },
              },
            ]
          : []),
        {
          id: "decline",
          label: "Not now",
          spoken: "Decline, and stay listening",
          emphasis: "quiet",
          intent: { do: "decline" },
        },
      ],
    };
  }

  if (you.state === "muted-by-teacher") {
    return {
      title: "Your teacher turned your microphone off",
      // Deliberately says what happens next. A child who does not know they may ask again reads
      // this as a punishment rather than as a classroom being run.
      body: "You can put your hand up again whenever you like.",
      urgent: true,
      buttons: [
        {
          id: "ask",
          label: "Ask to speak",
          spoken: "Put my hand up to speak",
          emphasis: "secondary",
          intent: { do: "ask" },
        },
      ],
    };
  }

  // Already speaking, or on camera.
  if (you.state === "speaking" || you.state === "camera-active") {
    const onCamera = you.state === "camera-active";
    return {
      title: onCamera ? "You're on camera" : "You're speaking",
      body: null,
      urgent: false,
      buttons: [
        ...(you.allowedCamera
          ? [
              {
                id: "camera",
                label: onCamera ? "Turn camera off" : "Turn camera on",
                spoken: onCamera
                  ? "Turn my camera off and carry on speaking"
                  : "Turn my camera on as well",
                emphasis: "secondary" as const,
                intent: { do: "setCamera", on: !onCamera } as FloorIntent,
              },
            ]
          : []),
        {
          id: "stop",
          label: "Stop speaking",
          spoken: "Stop speaking and go back to listening",
          emphasis: "quiet",
          intent: discussion ? { do: "leaveDiscussion" } : { do: "listenOnly" },
        },
      ],
    };
  }

  // Permitted, but nothing switched on — either a standing grant or a discussion they opted into.
  if (you.allowedMic || you.allowedCamera) {
    return {
      title: "You can speak",
      body: "Nothing is on until you tap.",
      urgent: false,
      buttons: [
        {
          id: "accept-mic",
          label: "Turn my microphone on",
          spoken: "Turn my microphone on and speak",
          emphasis: "primary",
          intent: { do: "accept", scope: "mic" },
        },
        ...(you.allowedCamera
          ? [
              {
                id: "accept-camera",
                label: "Camera too",
                spoken: "Turn my microphone and camera on",
                emphasis: "secondary" as const,
                intent: { do: "accept" as const, scope: "mic+camera" as InvitationScope },
              },
            ]
          : []),
        {
          id: "stop",
          label: "No thanks",
          spoken: "Give up my turn and go back to listening",
          emphasis: "quiet",
          intent: discussion ? { do: "leaveDiscussion" } : { do: "listenOnly" },
        },
      ],
    };
  }

  /*
    A discussion is open and this student has not joined it.

    Offered rather than switched on, which is the whole shape of this feature: the teacher opened a
    door, and walking through it is the student's decision. "Just listen" is a real option and is
    listed as one — a student who does not want to be seen must not have to work out that doing
    nothing is allowed.
  */
  if (discussion) {
    return {
      title: "Group discussion is open",
      body: "You can join in, or carry on listening.",
      urgent: false,
      buttons: [
        {
          id: "discussion-mic",
          label: "Join with microphone",
          spoken: "Join the discussion with my microphone",
          emphasis: "primary",
          intent: { do: "joinDiscussion", scope: "mic" },
        },
        {
          id: "discussion-camera",
          label: "Join with camera",
          spoken: "Join the discussion with my microphone and camera",
          emphasis: "secondary",
          intent: { do: "joinDiscussion", scope: "mic+camera" },
        },
        {
          id: "discussion-listen",
          label: "Just listen",
          spoken: "Stay listening, and do not join in",
          emphasis: "quiet",
          intent: { do: "leaveDiscussion" },
        },
      ],
    };
  }

  if (you.state === "requested") {
    const place = view.queuePosition;
    return {
      title: "Your hand is up",
      body:
        place === null
          ? "Your teacher can see it."
          : place === 1
            ? "You're next."
            : `You're ${ordinal(place)} in line.`,
      urgent: false,
      buttons: [
        {
          id: "cancel",
          label: "Put my hand down",
          spoken: "Cancel my request to speak",
          emphasis: "quiet",
          intent: { do: "cancelAsk" },
        },
      ],
    };
  }

  return {
    title: null,
    body: null,
    urgent: false,
    buttons: [
      {
        id: "ask",
        label: "Ask to speak",
        spoken: "Put my hand up to speak",
        emphasis: "primary",
        intent: { do: "ask" },
      },
    ],
  };
}

/* ========================================================================== *
 * The teacher's side                                                          *
 * ========================================================================== */

export interface FloorSummary {
  handsUp: number;
  speaking: number;
  onCamera: number;
  /** Invited and not yet answered. A teacher who invited everybody needs to see it land. */
  waitingToAnswer: number;
  connected: number;
  /** People the class knows about who are not connected right now. */
  away: number;
}

export function floorSummary(view: TeacherFloorView): FloorSummary {
  let speaking = 0, onCamera = 0, waitingToAnswer = 0, connected = 0, away = 0;
  for (const row of view.students) {
    if (row.connected) connected += 1;
    else away += 1;
    if (row.state === "speaking") speaking += 1;
    if (row.state === "camera-active") onCamera += 1;
    if (row.invitedAt !== null && row.state === "allowed-not-accepted") waitingToAnswer += 1;
  }
  return { handsUp: view.queue.length, speaking, onCamera, waitingToAnswer, connected, away };
}

/** What the teacher may do to one student, given where that student currently is. */
export type TeacherIntent =
  | { do: "allow"; scope: InvitationScope; replace: boolean }
  | { do: "dismiss" }
  | { do: "cancelInvite" }
  | { do: "mute" }
  | { do: "stopCamera" }
  | { do: "returnToAudience" }
  | { do: "spotlight" };

export interface TeacherButton {
  id: string;
  label: string;
  spoken: string;
  emphasis: "primary" | "secondary" | "quiet" | "danger";
  intent: TeacherIntent;
}

/**
 * The controls for one row of the participant list.
 *
 * The camera limit is applied here as well as on the server, and the difference matters: the
 * server *refuses* a second camera, and this decides whether the button says "Camera" or "Take the
 * camera". A teacher who is about to interrupt a child mid-sentence should be able to read that
 * from the button before pressing it, not from the error afterwards.
 */
export function teacherRowButtons(row: FloorRow, view: TeacherFloorView): TeacherButton[] {
  const out: TeacherButton[] = [];
  const discussion = view.mode === "discussion";
  const someoneElseHasTheCamera =
    !discussion && view.students.some((r) => r.userId !== row.userId && r.allowedCamera);

  if (row.state === "requested") {
    out.push({
      id: "allow-mic",
      label: "Let them speak",
      spoken: `Let ${row.name} speak`,
      emphasis: "primary",
      intent: { do: "allow", scope: "mic", replace: false },
    });
    out.push({
      id: "allow-camera",
      label: someoneElseHasTheCamera ? "Take the camera" : "With camera",
      spoken: someoneElseHasTheCamera
        ? `Give ${row.name} the camera, taking it from whoever has it`
        : `Let ${row.name} speak and turn their camera on`,
      emphasis: "secondary",
      intent: { do: "allow", scope: "mic+camera", replace: someoneElseHasTheCamera },
    });
    out.push({
      id: "dismiss",
      label: "Not now",
      spoken: `Put ${row.name}'s hand down without letting them speak`,
      emphasis: "quiet",
      intent: { do: "dismiss" },
    });
    return out;
  }

  if (row.invitedAt !== null && row.state === "allowed-not-accepted") {
    out.push({
      id: "cancel-invite",
      label: "Take it back",
      spoken: `Withdraw the invitation to ${row.name}`,
      emphasis: "quiet",
      intent: { do: "cancelInvite" },
    });
    return out;
  }

  if (row.state === "speaking" || row.state === "camera-active") {
    out.push({
      id: "mute",
      label: "Turn off",
      spoken: `Turn ${row.name}'s microphone off`,
      emphasis: "danger",
      intent: { do: "mute" },
    });
    if (row.state === "camera-active") {
      out.push({
        id: "stop-camera",
        label: "Camera off",
        spoken: `Turn ${row.name}'s camera off, leaving their microphone on`,
        emphasis: "secondary",
        intent: { do: "stopCamera" },
      });
    } else if (!row.allowedCamera) {
      out.push({
        id: "allow-camera",
        label: someoneElseHasTheCamera ? "Take the camera" : "Camera on",
        spoken: someoneElseHasTheCamera
          ? `Give ${row.name} the camera, taking it from whoever has it`
          : `Let ${row.name} turn their camera on`,
        emphasis: "secondary",
        intent: { do: "allow", scope: "mic+camera", replace: someoneElseHasTheCamera },
      });
    }
    out.push({
      id: "spotlight",
      label: view.spotlight === row.userId ? "Stop featuring" : "Feature",
      spoken:
        view.spotlight === row.userId
          ? `Stop making ${row.name}'s picture the big one`
          : `Make ${row.name}'s picture the big one for everybody`,
      emphasis: "quiet",
      intent: { do: "spotlight" },
    });
    out.push({
      id: "return",
      label: "Back to listening",
      spoken: `Take ${row.name}'s turn back`,
      emphasis: "quiet",
      intent: { do: "returnToAudience" },
    });
    return out;
  }

  if (row.state === "muted-by-teacher" || row.allowedMic || row.allowedCamera) {
    out.push({
      id: "return",
      label: "Back to listening",
      spoken: `Take ${row.name}'s turn back`,
      emphasis: "quiet",
      intent: { do: "returnToAudience" },
    });
    if (row.state === "muted-by-teacher") {
      out.push({
        id: "allow-mic",
        label: "Let them speak again",
        spoken: `Let ${row.name} speak again`,
        emphasis: "primary",
        intent: { do: "allow", scope: "mic", replace: false },
      });
    }
    return out;
  }

  /*
    An ordinary listening student.

    A disconnected one gets nothing at all: every action here would be applied to somebody who
    cannot answer it, and a teacher pressing "let them speak" and watching nothing happen learns
    to distrust the whole panel. Their row still shows, because they are still in the class.
  */
  if (!row.connected) return out;

  out.push({
    id: "allow-mic",
    label: "Let them speak",
    spoken: `Let ${row.name} speak`,
    emphasis: "secondary",
    intent: { do: "allow", scope: "mic", replace: false },
  });
  out.push({
    id: "allow-camera",
    label: someoneElseHasTheCamera ? "Take the camera" : "With camera",
    spoken: someoneElseHasTheCamera
      ? `Give ${row.name} the camera, taking it from whoever has it`
      : `Let ${row.name} speak and turn their camera on`,
    emphasis: "quiet",
    intent: { do: "allow", scope: "mic+camera", replace: someoneElseHasTheCamera },
  });
  return out;
}

/**
 * The discussion control, and what it is allowed to say.
 *
 * Three answers, and they are different things a teacher acts on differently:
 *
 * - not on this plan → the control is not drawn at all, because it will never become available
 *   and a permanently greyed button is a promise the product does not keep;
 * - not yet → drawn, disabled, and told when. A countdown is what makes "not yet" bearable;
 * - open → drawn and live.
 *
 * `opensAt` comes from the room payload, which the server computed. `now` is passed in rather than
 * read, because this project has been bitten by device clocks before — the class page takes its
 * time from the server for exactly that reason.
 */
export function discussionControl(
  view: TeacherFloorView,
  opensAt: number | null,
  now: number,
): { show: boolean; enabled: boolean; label: string; hint: string | null; ending: boolean } {
  if (!view.discussionEligible) {
    return { show: false, enabled: false, label: "", hint: null, ending: false };
  }
  if (view.mode === "discussion") {
    return {
      show: true,
      enabled: true,
      label: "End discussion",
      hint: "Everyone goes back to listening.",
      ending: true,
    };
  }
  if (opensAt !== null && now < opensAt) {
    const minutes = Math.max(1, Math.ceil((opensAt - now) / 60_000));
    return {
      show: true,
      enabled: false,
      label: "Start discussion",
      hint: `Opens in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
      ending: false,
    };
  }
  return {
    show: true,
    enabled: true,
    label: "Start discussion",
    hint: "Everyone can join in with a microphone or camera.",
    ending: false,
  };
}
