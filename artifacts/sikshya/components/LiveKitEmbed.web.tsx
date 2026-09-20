import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import palette from "@/constants/colors";
import { HIT_SLOP_MIN, radius, space } from "@/constants/layout";
import * as typography from "@/constants/typography";
import {
  joinRoom,
  leaveRoom,
  type MediaProblem,
  type VideoConnectionState,
  type VideoMediaHandle,
  type VideoParticipant,
  type VideoSession,
} from "@/lib/video";
/*
  Shared with the Daily embed on purpose.

  These helpers are pure and provider-independent — Codex wrote them that way when the Daily
  embeds were tokenized, and a control that says "Mute microphone" on one provider and something
  else on the other is a difference a screen-reader user would hear and nobody else would ever
  notice. One wording, both providers.

  The file is still called `dailyEmbedUi` because that is where it was born. Worth renaming to
  `videoEmbedUi` once the Daily branch has landed — doing it here would collide with work that
  is still in flight.
*/
import {
  planDiscussionLayout,
  rememberSpeakers,
  tileCapacity,
  type SpeakerMemory,
} from "@/utils/discussionLayout";
import {
  cameraActionLabel,
  microphoneActionLabel,
  screenShareActionLabel,
  watchedParticipantLeft,
} from "@/utils/dailyEmbedUi";

/**
 * The LiveKit call surface, on the web.
 *
 * Daily brings its own interface — a whole iframe of it — and LiveKit brings none at all: it
 * hands over tracks and this file decides what a class looks like. That is most of the work in
 * this file, and it is also the reason LiveKit is worth trying: the classroom stops being
 * somebody else's UI with our buttons taped to the outside of it.
 *
 * Nothing here talks to LiveKit. Everything goes through `lib/video`, so the day a third
 * provider arrives this file does not change.
 *
 * ## The whiteboard is untouched
 *
 * This component fills the call panel and nothing else. The board is a sibling in the
 * classroom screen, on its own socket, and it neither knows nor cares which company is carrying
 * the video. Audio-only exists precisely so that the board keeps working when the cameras
 * cannot.
 *
 * ## Colours
 *
 * Every one comes from `constants/colors.ts`. A call surface is dark and the palette is built
 * for a light app, so the dark tokens do the work: `ink` for the ground, `secondary` for a
 * raised tile, `onInverse` and `onInverseMuted` for text on top of them. The traffic-light
 * colours for connection quality are the semantic tokens — `online`, `accent`, `destructive` —
 * which is what they exist for and keeps them separate from the brand.
 */

const colors = palette.light;
/**
 * The type scale, at phone size.
 *
 * Taken through the namespace because the export is called `type`, and `import { type as t }`
 * collides with TypeScript's type-only import syntax — legal, and the kind of legal that breaks
 * the day a bundler's parser disagrees.
 *
 * The phone-sized scale rather than the responsive hook's, because this panel is small on every
 * screen: it is a corner of the classroom next to the board, not a page that grows with the
 * window.
 */
const t = typography.type;

interface ChatMessage {
  id: string;
  senderName: string;
  text: string;
  time: string;
  isMe: boolean;
}

interface Props {
  /** The LiveKit project's `wss://` address, from the server. */
  roomUrl: string;
  /**
   * The class's teacher, by account id, so their tile is never dropped for a talkative student.
   *
   * The id rather than the name: `providerUserId` puts the account id in the participant identity
   * precisely so two students called Sita are two people, and matching on a display name here
   * would reintroduce the ambiguity one layer up.
   */
  teacherUserId?: string | null;
  /** Whoever the teacher has featured, from the classroom floor. Null for the ordinary grid. */
  spotlightUserId?: string | null;
  /**
   * The signed join token, minted by the API.
   *
   * It carries the room, the identity and the rights: only a teacher's token permits screen
   * sharing or moderation. Nothing this component does can widen them, which is the point of
   * minting it server-side.
   */
  meetingToken?: string | null;
  displayName: string;
  onLeft?: () => void;
  /**
   * This device's media connection has come up, and the classroom needs to hear about it.
   *
   * The classroom WebSocket connects first and the SFU connection follows a moment later, so a
   * teacher granting the floor in that gap grants it to somebody LiveKit has never seen. The
   * server keeps such a grant pending rather than pretending, and this is what tells it to finish.
   *
   * Fired on every arrival at `connected`, reconnections included — a reconnection is a *new*
   * participant to LiveKit, minted from the same locked token, so the standing grant has to be
   * pushed again. The server bounds how often it will act on it.
   */
  onMediaReady?: () => void;
  /** Watch for one named person leaving — how a student learns the teacher has gone. */
  watchUserName?: string;
  onWatchedParticipantLeft?: () => void;
  onWatchedParticipantReturned?: () => void;
  /** Accepted so a parent can pass `StyleSheet.absoluteFill`; this component fills its box. */
  style?: unknown;
  /** Show the screen-share control. The token enforces the same rule independently. */
  canScreenShare?: boolean;
  /**
   * Accepted and deliberately not rendered, exactly as the Daily web build does.
   *
   * The classroom owns the class conversation in its own slide-over panel. A second copy inside
   * a panel this size would be the same messages twice — see
   * `.agents/memory/one-chat-per-class.md`. The props stay in the contract so both providers
   * take the same ones and `VideoCall.tsx` needs no special case.
   */
  chatMessages?: ChatMessage[];
  onSendChat?: (text: string) => void;
  enableInCallChat?: boolean;
  /** False while the app-owned call window is a compact preview. */
  showControls?: boolean;
  /** Product role and permission state; neither is inferred from a device failure. */
  isTeacher?: boolean;
  canUseMicrophone?: boolean;
  canUseCamera?: boolean;
  onLocalMediaChange?: (media: { micEnabled: boolean; cameraEnabled: boolean }) => void;
}

/** Long enough that a slow first join is not called a failure, short enough to be honest. */
const JOIN_TIMEOUT_MS = 20000;

/** Quality, as a colour and a word. Semantic tokens, not the brand. */
const QUALITY: Record<string, { colour: string; label: string }> = {
  excellent: { colour: colors.online, label: "Connection: strong" },
  good: { colour: colors.online, label: "Connection: good" },
  poor: { colour: colors.accent, label: "Connection: weak" },
  lost: { colour: colors.destructive, label: "Connection: lost" },
  unknown: { colour: colors.offline, label: "Connection: checking" },
};

/** What to say about a device that would not start, and what to do about it. */
function explain(problem: MediaProblem): string {
  const device = problem.kind === "camera" ? "camera" : problem.kind === "screen" ? "screen" : "microphone";
  switch (problem.reason) {
    case "denied":
      return `${device === "camera" ? "Camera access" : device === "microphone" ? "Microphone access" : "Screen sharing"} is blocked. Allow it in your browser or site settings, then try again. You can continue the class without it.`;
    case "missing":
      return `No ${device} was found on this device. The class carries on without it.`;
    case "in-use":
      return `Your ${device} is being used by another app. Close it, then turn the ${device} back on.`;
    default:
      return `Your ${device} could not be started. The class carries on without it.`;
  }
}

/**
 * One person's video.
 *
 * Attaching is done here rather than in the parent because the element is created here: a
 * `<video>` that appears and disappears with a tile needs the track attached the instant its
 * element exists and detached the instant it does not, and a parent holding a map of refs gets
 * that wrong at exactly the moments that matter — a reconnect, and a person leaving.
 */
function Media({
  handle,
  kind,
  muted,
  cover,
}: {
  handle: VideoMediaHandle | null;
  kind: "video" | "audio";
  muted?: boolean;
  cover?: boolean;
}) {
  const ref = useRef<HTMLMediaElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !handle) return;
    handle.attach(element);
    return () => handle.detach(element);
    // Keyed on the publication id: a track replaced by a reconnect is a different publication
    // and has to be re-attached, while a re-render that changes nothing must not disturb it.
  }, [handle?.id, handle]);

  if (kind === "audio") {
    return <audio ref={ref as React.Ref<HTMLAudioElement>} autoPlay playsInline />;
  }
  return (
    <video
      ref={ref as React.Ref<HTMLVideoElement>}
      autoPlay
      playsInline
      // The local preview is always muted: a browser playing your own microphone back at you is
      // feedback, and it is loud.
      muted={muted}
      style={{
        width: "100%",
        height: "100%",
        // A face fills its tile; a shared screen must not be cropped, or the edge of the
        // document a teacher is pointing at is the part that gets cut off.
        objectFit: cover ? "cover" : "contain",
        background: colors.ink,
        display: "block",
      }}
    />
  );
}

/**
 * How many columns give the biggest tiles in the space there is.
 *
 * Without this the grid guesses, and it guesses badly at both ends: two people in a phone-shaped
 * panel became two tall slivers, and the same rule on a laptop wasted a third of the height.
 * So the column count is computed from the panel's real shape rather than assumed.
 *
 * For each possible number of columns, work out how large a 4:3 tile could be; take the best.
 * With one person it returns 1, which is the whole panel — as it should be.
 */
function bestColumns(count: number, width: number, height: number): number {
  if (count <= 1 || width <= 0 || height <= 0) return 1;
  let best = 1;
  let bestScale = 0;
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const scale = Math.min(width / columns / 4, height / rows / 3);
    if (scale > bestScale) {
      bestScale = scale;
      best = columns;
    }
  }
  return best;
}

/**
 * Watches an element's size, so the grid can be laid out from what is actually there.
 *
 * A callback ref rather than a `useRef` plus a mount effect. The grid it measures does not
 * exist until somebody else joins, so an effect that read `ref.current` on mount found null and
 * never looked again — which left the column count stuck at its zero-width answer of 1, and a
 * laptop stacking two people vertically down a very wide panel.
 */
function useBoxSize(): [(node: HTMLDivElement | null) => void, { width: number; height: number }] {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);

  const measure = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof ResizeObserver === "undefined") {
      setBox({ width: 0, height: 0 });
      return;
    }
    const next = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      // Ignored when unchanged, so a resize that is not one cannot loop through setState.
      if (rect) {
        setBox((prev) =>
          prev.width === rect.width && prev.height === rect.height
            ? prev
            : { width: rect.width, height: rect.height },
        );
      }
    });
    next.observe(node);
    observer.current = next;
    const rect = node.getBoundingClientRect();
    setBox({ width: rect.width, height: rect.height });
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [measure, box];
}

/** Initials, for somebody whose camera is off. Better than an empty rectangle. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : "")).toUpperCase();
}

/**
 * One person.
 *
 * `inset` is the small self-view in the corner. Everyone else fills the cell they are given —
 * the grid decides how big that is, so the tiles always use the whole panel rather than
 * leaving a band of black under them.
 */
function Tile({ participant, inset }: { participant: VideoParticipant; inset?: boolean }) {
  const quality = QUALITY[participant.quality] ?? QUALITY.unknown!;
  const showVideo = participant.camera !== null && participant.cameraEnabled;

  return (
    <div
      data-testid={`livekit-tile-${participant.id}`}
      style={{
        position: inset ? "absolute" : "relative",
        ...(inset
          ? {
              // Small, and proportional to the panel rather than a fixed size: this component
              // is a corner of the classroom on a laptop and nearly the whole screen when a
              // teacher expands it, and a 160px square is wrong in one of those.
              //
              // Top right, leaving the tile's identity pill clear at top left and the floating
              // call controls clear along the bottom.
              right: `${space.xs}px`,
              top: `${space.xs}px`,
              width: "clamp(76px, 24%, 168px)",
              aspectRatio: "4 / 3",
              zIndex: 1,
              // A light ring, because the inset sits on top of another tile: an outline in the
              // ground colour is black on black and the self-view has no edge at all.
              boxShadow: `0 0 0 1px ${colors.onInverseMuted}`,
            }
          : { width: "100%", height: "100%", minWidth: 0, minHeight: 0 }),
        borderRadius: `${radius.sm}px`,
        overflow: "hidden",
        /*
          The same ground as a video, so the name band always has an edge.

          It was `secondary` — the same colour as the name band that sits on it — which read
          correctly over a camera but merged into a single navy rectangle the moment somebody
          turned their camera off. The text stayed legible; the band stopped looking like one.
        */
        background: colors.ink,
        border: `1px solid ${participant.isSpeaking ? colors.online : colors.onInverseMuted}`,
        // A speaking person is outlined rather than enlarged: re-laying out the grid every time
        // somebody says "yes" is unusable on a small panel.
        boxShadow: participant.isSpeaking
          ? `0 0 0 2px ${colors.online}, 0 14px 34px rgba(0, 0, 0, 0.24)`
          : "0 10px 26px rgba(0, 0, 0, 0.18)",
        transition: "border-color 180ms ease, box-shadow 180ms ease",
      }}
    >
      {showVideo ? (
        <Media handle={participant.camera} kind="video" muted={participant.isLocal} cover />
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: colors.onInverseMuted,
            fontFamily: t.title2.fontFamily,
            fontSize: `${t.title2.fontSize}px`,
          }}
        >
          {initials(participant.name)}
        </div>
      )}

      {participant.microphone ? <Media handle={participant.microphone} kind="audio" /> : null}

      <div
        style={{
          position: "absolute",
          left: `${space.xs}px`,
          top: `${space.xs}px`,
          maxWidth: `calc(100% - ${space.sm}px)`,
          display: "flex",
          alignItems: "center",
          gap: `${space.xxs}px`,
          padding: `${space.xxs}px ${space.sm}px`,
          /*
            A compact glass identity pill rather than a full-width television-style name bar.
            The dark fill stays nearly opaque, with a light edge and white ink, so a bright
            camera frame cannot wash the name out. It sits at top left because the premium call
            rail floats over the bottom centre on both phone and laptop.
          */
          background: "rgba(10, 20, 37, 0.88)",
          color: colors.secondaryForeground,
          border: "1px solid rgba(255, 255, 255, 0.16)",
          borderRadius: `${radius.pill}px`,
          boxShadow: "0 6px 20px rgba(0, 0, 0, 0.2)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          fontFamily: t.caption.fontFamily,
          fontSize: `${t.caption.fontSize}px`,
        }}
      >
        <span
          aria-label={quality.label}
          title={quality.label}
          style={{
            width: `${space.xs}px`,
            height: `${space.xs}px`,
            borderRadius: `${radius.pill}px`,
            background: quality.colour,
            flex: "0 0 auto",
          }}
        />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {participant.isLocal ? "You" : participant.name}
        </span>
        {participant.micEnabled ? null : (
          <span style={{ color: colors.onInverseMuted, flex: "0 0 auto" }}>muted</span>
        )}
      </div>
    </div>
  );
}

/**
 * A control.
 *
 * `minWidth`/`minHeight` of `HIT_SLOP_MIN` because these are pressed by somebody who is halfway
 * through teaching, on a phone, and the button next to the one they want ends the class.
 */
type CallIconName =
  | "mic" | "mic-off" | "video" | "video-off" | "monitor"
  | "more-horizontal" | "x" | "phone-off" | "refresh-cw" | "headphones";

/**
 * Tiny provider-owned icons.
 *
 * This web component intentionally does not import the native icon bridge. The real Expo bundle
 * can resolve it, but the lightweight browser/real-media harness cannot—and a call surface should
 * not depend on a native module just to draw ten lines. These use the same 24-point geometry as
 * the rest of Fadko's Feather icons, with currentColor so every state keeps its semantic colour.
 */
function CallIcon({ name, colour }: { name: CallIconName; colour: string }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  let shape: React.ReactNode;
  switch (name) {
    case "mic": shape = <><path {...common} d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path {...common} d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"/></>; break;
    case "mic-off": shape = <><path {...common} d="m1 1 22 22M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.8-1M17 16.9A7 7 0 0 1 5 12v-2M19 10v2c0 .9-.2 1.8-.5 2.6M12 19v3M8 22h8"/></>; break;
    case "video": shape = <><rect {...common} x="1" y="5" width="15" height="14" rx="2"/><path {...common} d="m23 7-7 5 7 5V7Z"/></>; break;
    case "video-off": shape = <><path {...common} d="m1 1 22 22M15 15v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7c0-.6.2-1.1.6-1.5M9.5 5H13a2 2 0 0 1 2 2v3.5M23 7l-7 5 3.5 2.5"/></>; break;
    case "monitor": shape = <><rect {...common} x="2" y="3" width="20" height="14" rx="2"/><path {...common} d="M8 21h8M12 17v4"/></>; break;
    case "more-horizontal": shape = <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>; break;
    case "x": shape = <path {...common} d="M18 6 6 18M6 6l12 12"/>; break;
    case "phone-off": shape = <><path {...common} d="M10.7 13.7a16 16 0 0 0 3.6 3.6l2.4-2.4a1 1 0 0 1 1-.2 11 11 0 0 0 3.5.6 1 1 0 0 1 1 1V20a2 2 0 0 1-2 2C10.1 22 2 13.9 2 4a2 2 0 0 1 2-2h3.7a1 1 0 0 1 1 1 11 11 0 0 0 .6 3.5 1 1 0 0 1-.2 1L6.7 9.9M23 1 1 23"/></>; break;
    case "refresh-cw": shape = <><path {...common} d="M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/></>; break;
    case "headphones": shape = <><path {...common} d="M3 18v-6a9 9 0 0 1 18 0v6"/><path {...common} d="M21 19a2 2 0 0 1-2 2h-1v-6h3v4ZM3 19a2 2 0 0 0 2 2h1v-6H3v4Z"/></>; break;
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" style={{ color: colour, display: "block" }}>{shape}</svg>;
}

function Control({
  label,
  icon,
  accessibilityLabel,
  onPress,
  active,
  danger,
  testID,
  disabled,
}: {
  /** What the button says. Short, because the panel is narrow. */
  label: string;
  icon: CallIconName;
  /**
   * What the button *does*, for somebody who cannot see it.
   *
   * "Mute" alone does not say whether it mutes or is currently muted. The spoken name describes
   * the action a press will take — the same wording the Daily embed uses, from the same helpers.
   */
  accessibilityLabel?: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  testID: string;
  disabled?: boolean;
}) {
  /*
    Leave is an outline, not a second filled red button.

    The design rule: crimson is identity, blue is action, and destructive is a state rather than
    a colour to fill a button with. A solid red Leave sitting beside a solid blue Mute reads as
    two equal actions, and the one that ends a class should not compete for the thumb. Destructive
    ink and border on `destructiveSoft` is 6.30:1 — the pairing Codex settled on for the Daily
    embed's Leave, kept identical here so the two providers do not disagree about what red means.
  */
  const background = danger ? colors.destructiveSoft : active ? colors.primary : colors.secondary;
  const ink = danger ? colors.destructive : colors.onInverse;
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={accessibilityLabel ?? label}
      aria-pressed={active}
      title={accessibilityLabel ?? label}
      data-testid={testID}
      style={{
        width: `${HIT_SLOP_MIN}px`,
        minHeight: `${HIT_SLOP_MIN}px`,
        padding: 0,
        borderRadius: `${radius.pill}px`,
        border: danger ? `1px solid ${colors.destructive}` : "none",
        background,
        color: ink,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.48 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        boxShadow: active
          ? "0 8px 22px rgba(20, 73, 147, 0.34)"
          : danger
            ? "0 5px 16px rgba(0, 0, 0, 0.16)"
            : "none",
        transition: "transform 160ms ease, background 160ms ease, box-shadow 160ms ease",
      }}
    >
      <CallIcon name={icon} colour={ink} />
    </button>
  );
}

export default function LiveKitEmbed({
  roomUrl,
  meetingToken,
  displayName,
  onLeft,
  onMediaReady,
  watchUserName,
  onWatchedParticipantLeft,
  onWatchedParticipantReturned,
  canScreenShare,
  teacherUserId = null,
  spotlightUserId = null,
  showControls = true,
  isTeacher = false,
  canUseMicrophone = true,
  canUseCamera = false,
  onLocalMediaChange,
}: Props) {
  const [session, setSession] = useState<VideoSession | null>(null);
  const [connection, setConnection] = useState<VideoConnectionState>("connecting");
  const [participants, setParticipants] = useState<VideoParticipant[]>([]);
  const [problem, setProblem] = useState<MediaProblem | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [audioOnly, setAudioOnlyState] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const microphoneAuthorized = isTeacher || canUseMicrophone;
  const cameraAuthorized = isTeacher || canUseCamera;

  /*
    Callbacks in refs, read at the moment they fire.

    A parent that rebuilds `onLeft` on every render would otherwise re-run the join effect and
    tear down a live call to rebuild an identical one. The effect below depends only on where
    the call is and who is joining it.
  */
  const onLeftRef = useRef(onLeft);
  const onWatchedLeftRef = useRef(onWatchedParticipantLeft);
  const onWatchedReturnedRef = useRef(onWatchedParticipantReturned);
  const watchNameRef = useRef(watchUserName);
  const onMediaReadyRef = useRef(onMediaReady);
  const onLocalMediaChangeRef = useRef(onLocalMediaChange);
  onLeftRef.current = onLeft;
  onWatchedLeftRef.current = onWatchedParticipantLeft;
  onWatchedReturnedRef.current = onWatchedParticipantReturned;
  watchNameRef.current = watchUserName;
  onMediaReadyRef.current = onMediaReady;
  onLocalMediaChangeRef.current = onLocalMediaChange;

  /** Whether the watched person has ever been seen, so their absence means something. */
  const watchedSeen = useRef(false);
  const watchedReported = useRef(false);
  const reportedLocalMedia = useRef<{ micEnabled: boolean; cameraEnabled: boolean } | null>(null);

  useEffect(() => {
    // A new classroom gets a fresh absence history. A media reconnect inside the same room does
    // not: the return event has to survive that transport rebuild so the student's warning clears.
    watchedSeen.current = false;
    watchedReported.current = false;
  }, [roomUrl, teacherUserId, watchUserName]);

  const reportLocalMedia = useCallback((roster: VideoParticipant[]) => {
    const me = roster.find((participant) => participant.isLocal);
    if (!me) return;
    const next = { micEnabled: me.micEnabled, cameraEnabled: me.cameraEnabled };
    const previous = reportedLocalMedia.current;
    if (previous?.micEnabled === next.micEnabled && previous.cameraEnabled === next.cameraEnabled) return;
    reportedLocalMedia.current = next;
    onLocalMediaChangeRef.current?.(next);
  }, []);

  /**
   * One departure, announced once.
   *
   * Pressing Leave disconnects, and disconnecting raises a state change that also means "this
   * person left" — so the same departure arrived twice, and the classroom acts on `onLeft` by
   * tearing the room down and navigating away. Codex found and fixed exactly this on the Daily
   * embed; it was here too.
   *
   * A ref rather than state because it is read inside a subscription callback that was created
   * once, and because a re-render must not un-announce something that already happened.
   */
  const leftAnnounced = useRef(false);
  const announceLeave = useCallback(() => {
    if (leftAnnounced.current) return;
    leftAnnounced.current = true;
    onLeftRef.current?.();
  }, []);

  useEffect(() => {
    if (!roomUrl || !meetingToken) return;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanups: (() => void)[] = [];
    leftAnnounced.current = false;
    setConnection("connecting");
    setJoinError(null);
    setSlow(false);

    // Says "still trying", not "failed" — the SDK is still working and usually wins.
    const slowTimer = setTimeout(() => {
      if (!cancelled) setSlow(true);
    }, JOIN_TIMEOUT_MS);

    (async () => {
      try {
        const live = await joinRoom({
          url: roomUrl,
          token: meetingToken,
          startMuted: !isTeacher,
          startCamera: isTeacher,
        });
        if (cancelled) {
          // Unmounted while connecting. Leave immediately rather than holding a room and a
          // microphone open behind a screen nobody is looking at.
          await live.leaveRoom();
          return;
        }
        setSession(live);
        setSlow(false);

        cleanups.push(
          live.onConnectionStateChange((state) => {
            setConnection(state);
            if (state === "disconnected" && !leftAnnounced.current && !reconnectTimer) {
              // LiveKit giving up on one transport is not the same as the Fadko class ending.
              // Keep the board, timer and route intact, then rebuild only the media session.
              reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                if (!cancelled) setReconnectAttempt((attempt) => attempt + 1);
              }, 1200);
            }
            /*
              Every arrival at `connected`, not only the first.

              To LiveKit a reconnection is a *new* participant, minted from the same token — which
              for a student permits publishing nothing. So a student who was speaking, dropped and
              came back needs their standing grant pushed again, and this is what asks for it. The
              server decides whether anything is actually outstanding; announcing it when nothing
              is costs one frame and no provider call at all.
            */
            if (state === "connected") {
              if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
              }
              onMediaReadyRef.current?.();
            }
          }),
        );
        cleanups.push(
          live.onParticipantsChange((roster) => {
            setParticipants(roster);
            setSoundBlocked(live.audioBlocked);
            setAudioOnlyState(live.audioOnly);
            reportLocalMedia(roster);

            const watched = watchNameRef.current;
            if (!teacherUserId && !watched) return;
            // LiveKit participant identity is the stable Fadko account id. Prefer it over a
            // display-name comparison so two people named Sita cannot clear one another's
            // departure warning. The name fallback keeps the Daily-compatible room payloads
            // working while older sessions age out.
            const present = roster.some(
              (p) =>
                !p.isLocal &&
                ((!!teacherUserId && p.id === teacherUserId) ||
                  (!!watched && watchedParticipantLeft(watched, p.name))),
            );
            if (present) {
              const hadReportedDeparture = watchedReported.current;
              watchedSeen.current = true;
              // Rearmed on their return: a teacher whose connection dropped and came back can
              // legitimately leave again later, and the student should be told again.
              watchedReported.current = false;
              if (hadReportedDeparture) onWatchedReturnedRef.current?.();
            } else if (watchedSeen.current && !watchedReported.current) {
              watchedReported.current = true;
              onWatchedLeftRef.current?.();
            }
          }),
        );
        cleanups.push(live.onMediaProblem(setProblem));
      } catch (err) {
        if (cancelled) return;
        setJoinError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      for (const cancel of cleanups) cancel();
      /*
        Fire and forget, because a React cleanup is synchronous and a disconnect is not.

        `lib/video` holds one call at a time and closes the old one before opening the next, so
        a remount that races this cannot end with two rooms connected.
      */
      void leaveRoom();
      setSession(null);
    };
  }, [roomUrl, meetingToken, isTeacher, reconnectAttempt, reportLocalMedia]);

  const local = participants.find((p) => p.isLocal) ?? null;
  const remotes = useMemo(() => participants.filter((p) => !p.isLocal), [participants]);
  /** A shared screen takes the whole panel: it is the thing being looked at. */
  const screen = useMemo(() => participants.find((p) => p.screen !== null) ?? null, [participants]);

  const [gridRef, gridBox] = useBoxSize();

  /**
   * Who gets a tile, and whose camera is worth paying for.
   *
   * Recomputed whenever the roster moves, which is also when somebody starts or stops talking —
   * the provider reports both through the same subscription. The plan itself is
   * `utils/discussionLayout.ts` and is tested there; this is the wiring.
   *
   * The memory lives in a ref rather than in state on purpose. It changes on every frame in which
   * anybody is speaking, and putting that in state would re-render the whole call several times a
   * second to move a number nobody looks at directly.
   */
  const speakerMemory = useRef<SpeakerMemory>({});
  const capacity = tileCapacity(gridBox.width || 0);
  const plan = useMemo(() => {
    const people = participants.map((p) => ({
      id: p.id,
      isLocal: p.isLocal,
      hasCamera: p.camera !== null,
      isSpeaking: p.isSpeaking,
    }));
    const now = Date.now();
    speakerMemory.current = rememberSpeakers(speakerMemory.current, people, now);
    return planDiscussionLayout({
      people,
      teacherId: teacherUserId,
      spotlightId: spotlightUserId,
      memory: speakerMemory.current,
      now,
      // Before the grid has been measured there is no honest capacity, so nothing is dropped:
      // a first frame that unsubscribed from everybody would blank the class for a moment.
      capacity: gridBox.width > 0 ? capacity : Number.MAX_SAFE_INTEGER,
    });
  }, [participants, teacherUserId, spotlightUserId, capacity, gridBox.width]);

  /*
    Hand the plan to the provider.

    In its own effect rather than inside the render above, because subscribing is a side effect on
    a live connection and React may run a render twice. `setCameraPlan` is optional on the
    contract: a provider that cannot express it simply does not get asked, rather than being made
    to look as though it had.
  */
  useEffect(() => {
    session?.setCameraPlan?.(plan);
  }, [session, plan]);

  const visible = useMemo(() => new Set(plan.visible), [plan]);
  const shown = useMemo(() => remotes.filter((p) => visible.has(p.id)), [remotes, visible]);
  const columns = bestColumns(shown.length, gridBox.width, gridBox.height);

  const act = useCallback(
    (fn: (live: VideoSession) => Promise<unknown>) => () => {
      if (!session) return;
      void fn(session).then(() => {
        setParticipants(session.getParticipants());
        setAudioOnlyState(session.audioOnly);
        setSoundBlocked(session.audioBlocked);
      });
    },
    [session],
  );

  const toggleCamera = useCallback(() => {
    if (!session || !cameraAuthorized) return;
    void session.toggleCamera().then(() => {
      const next = session.getParticipants();
      setParticipants(next);
      reportLocalMedia(next);
    });
  }, [cameraAuthorized, reportLocalMedia, session]);

  const toggleMic = useCallback(() => {
    if (!session || !microphoneAuthorized) return;
    void session.toggleMic().then(() => {
      const next = session.getParticipants();
      setParticipants(next);
      reportLocalMedia(next);
    });
  }, [microphoneAuthorized, reportLocalMedia, session]);

  const toggleShare = act(async (live) => {
    if (sharing) {
      await live.stopScreenShare();
      setSharing(false);
    } else {
      setSharing(await live.startScreenShare());
    }
  });

  const banner =
    joinError !== null
      ? "The video call could not start. You can still use the board and the class chat."
      : connection === "reconnecting"
        ? "Reconnecting… the board and the chat are still working."
        : slow && connection !== "connected"
          ? "Still connecting. This can take a while on a slow network."
          : null;

  return (
    <div
      data-testid="livekit-embed"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: `radial-gradient(circle at 50% 0%, ${colors.secondary} 0%, ${colors.ink} 46%)`,
        overflow: "hidden",
      }}
    >
      {banner ? (
        <div
          data-testid="livekit-banner"
          role="status"
          style={{
            padding: `${space.xs}px ${space.sm}px`,
            background: joinError ? colors.destructive : colors.secondary,
            color: colors.onInverse,
            fontFamily: t.caption.fontFamily,
            fontSize: `${t.caption.fontSize}px`,
            textAlign: "center",
          }}
        >
          {banner}
        </div>
      ) : null}

      {problem ? (
        <div
          data-testid="livekit-device-problem"
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: `${space.xs}px`,
            padding: `${space.xs}px ${space.sm}px`,
            background: colors.warn,
            color: colors.onInverse,
            fontFamily: t.caption.fontFamily,
            fontSize: `${t.caption.fontSize}px`,
          }}
        >
          <span style={{ flex: 1 }}>{explain(problem)}</span>
          <button
            type="button"
            onClick={() => setProblem(null)}
            aria-label="Dismiss"
            data-testid="livekit-dismiss-problem"
            style={{
              minWidth: `${HIT_SLOP_MIN}px`,
              minHeight: `${HIT_SLOP_MIN}px`,
              border: "none",
              background: "transparent",
              color: colors.onInverse,
              cursor: "pointer",
              fontFamily: t.caption.fontFamily,
              fontSize: `${t.caption.fontSize}px`,
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {soundBlocked ? (
        // Must be a real click: the browser only lets audio start from inside a gesture, which
        // is why this is a button rather than something the code does by itself on connect.
        <button
          type="button"
          data-testid="livekit-unblock-audio"
          onClick={act((live) => live.unblockAudio())}
          style={{
            minHeight: `${HIT_SLOP_MIN}px`,
            border: "none",
            background: colors.primary,
            color: colors.onInverse,
            fontFamily: t.bodyStrong.fontFamily,
            fontSize: `${t.caption.fontSize}px`,
            cursor: "pointer",
          }}
        >
          Tap to turn on the sound
        </button>
      ) : null}

      {/*
        The stage fills whatever height is left, and the tiles fill the stage.

        Deliberately a grid with `1fr` rows rather than tiles with a fixed aspect ratio: an
        aspect ratio makes the width decide the height, which on a laptop left a band of black
        under two large tiles and on a phone left most of the panel empty. The grid gives every
        row an equal share of the space that actually exists.
      */}
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: `${space.xs}px`,
          padding: `${space.xs}px`,
        }}
      >
        {screen ? (
          <div
            data-testid="livekit-screen"
            style={{
              // Three quarters of the stage. A shared screen is what everyone is looking at;
              // the faces beside it are context.
              flex: 3,
              minHeight: 0,
              borderRadius: `${radius.sm}px`,
              overflow: "hidden",
              background: colors.ink,
            }}
          >
            <Media handle={screen.screen} kind="video" muted={screen.isLocal} />
          </div>
        ) : null}

        {/*
          Somebody is here and off screen, said rather than hidden.

          The tile budget drops the quietest people first, which is right — and a class where
          three students simply vanished with no explanation is not. The count is deliberately not
          a list of names: on a phone that is another row of text over the board, and the person
          reading it can open the class list if they want to know who.
        */}
        {plan.overflow > 0 ? (
          <div
            data-testid="livekit-overflow"
            style={{
              alignSelf: "center",
              padding: `${space.xxs}px ${space.xs}px`,
              borderRadius: `${radius.pill}px`,
              background: colors.secondary,
              color: colors.secondaryForeground,
              fontFamily: t.caption.fontFamily,
              fontSize: `${t.caption.fontSize}px`,
            }}
          >
            {plan.overflow === 1 ? "1 more person is here" : `${plan.overflow} more people are here`}
          </div>
        ) : null}

        {remotes.length === 0 ? (
          <div
            data-testid="livekit-waiting"
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: `${space.md}px`,
              color: colors.onInverseMuted,
              fontFamily: t.callout.fontFamily,
              fontSize: `${t.callout.fontSize}px`,
              textAlign: "center",
            }}
          >
            {connection === "connected" ? "Waiting for others to join." : "Connecting…"}
          </div>
        ) : (
          <div
            data-testid="livekit-grid"
            ref={gridRef}
            style={{
              flex: 1,
              minHeight: 0,
              display: "grid",
              gap: `${space.xs}px`,
              // With a screen shared the faces become a strip beside it; otherwise the column
              // count is whatever makes the tiles largest in the space this panel actually has.
              ...(screen
                ? {
                    gridAutoFlow: "column",
                    gridAutoColumns: "minmax(96px, 1fr)",
                    gridAutoRows: "100%",
                    overflowX: "auto",
                    overflowY: "hidden",
                  }
                : {
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gridAutoRows: "minmax(0, 1fr)",
                    overflow: "hidden",
                  }),
            }}
          >
            {shown.map((participant) => (
              <Tile key={participant.id} participant={participant} />
            ))}
          </div>
        )}

        {/* The self-view, small and in the corner — the one tile nobody is watching. */}
        {/* A camera preview is useful; a second avatar saying "You, muted" is visual nesting. */}
        {local?.cameraEnabled ? <Tile participant={local} inset /> : null}
      </div>

      {showControls ? (
        <div
          data-testid="livekit-controls"
          style={{
            position: "absolute",
            left: "50%",
            bottom: `${space.xs}px`,
            transform: "translateX(-50%)",
            display: "flex",
            justifyContent: "center",
            gap: `${space.xxs}px`,
            width: "max-content",
            maxWidth: `calc(100% - ${space.md}px)`,
            padding: `${space.xxs}px`,
            border: "1px solid rgba(255, 255, 255, 0.16)",
            borderRadius: `${radius.pill}px`,
            background: "rgba(10, 20, 37, 0.82)",
            boxShadow: "0 16px 40px rgba(0, 0, 0, 0.34)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            zIndex: 5,
          }}
        >
          {moreOpen ? (
            <div
              data-testid="livekit-more-menu"
              role="group"
              aria-label="More call controls"
              style={{
                position: "absolute",
                left: "50%",
                bottom: `calc(100% + ${space.xs}px)`,
                transform: "translateX(-50%)",
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: `${space.xs}px`,
                width: "min(320px, calc(100vw - 32px))",
                boxSizing: "border-box",
                padding: `${space.xs}px`,
                border: "1px solid rgba(255, 255, 255, 0.18)",
                borderRadius: `${radius.md}px`,
                background: "rgba(10, 20, 37, 0.94)",
                boxShadow: "0 18px 44px rgba(0, 0, 0, 0.36)",
                backdropFilter: "blur(18px)",
                WebkitBackdropFilter: "blur(18px)",
                zIndex: 4,
              }}
            >
              <button
                type="button"
                data-testid="livekit-flip"
                aria-label="Switch to the other camera"
                onClick={() => {
                  setMoreOpen(false);
                  act((live) => live.switchCamera())();
                }}
                style={secondaryActionStyle}
              >
                <CallIcon name="refresh-cw" colour={colors.onInverse} />
                <span>Flip camera</span>
              </button>
              <button
                type="button"
                data-testid="livekit-audio-only"
                aria-label={audioOnly ? "Turn video back on for everyone" : "Switch to audio only, keeping the board"}
                aria-pressed={audioOnly}
                onClick={() => {
                  setMoreOpen(false);
                  act((live) => live.setAudioOnly(!live.audioOnly))();
                }}
                style={{
                  ...secondaryActionStyle,
                  background: audioOnly ? colors.primary : colors.ink,
                }}
              >
                <CallIcon name={audioOnly ? "video" : "headphones"} colour={colors.onInverse} />
                <span>{audioOnly ? "Turn video on" : "Use audio only"}</span>
              </button>
            </div>
          ) : null}

          <Control
            testID="livekit-mic"
            icon={local?.micEnabled ? "mic" : "mic-off"}
            label={
              local?.micEnabled
                ? "Mute"
                : microphoneAuthorized
                  ? "Unmute"
                  : "Muted by teacher"
            }
            accessibilityLabel={
              microphoneAuthorized
                ? microphoneActionLabel(local?.micEnabled === true)
                : "Microphone muted by teacher"
            }
            active={local?.micEnabled === true}
            disabled={!microphoneAuthorized}
            onPress={toggleMic}
          />
          <Control
            testID="livekit-camera"
            icon={local?.cameraEnabled ? "video" : "video-off"}
            label={
              local?.cameraEnabled
                ? "Camera off"
                : cameraAuthorized
                  ? "Camera on"
                  : "Camera needs teacher approval"
            }
            accessibilityLabel={
              cameraAuthorized
                ? cameraActionLabel(local?.cameraEnabled === true)
                : "Camera off. Your teacher controls student camera access"
            }
            active={local?.cameraEnabled === true}
            disabled={!cameraAuthorized}
            onPress={toggleCamera}
          />
          {canScreenShare ? (
            <Control
              testID="livekit-share"
              icon="monitor"
              label={sharing ? "Stop sharing" : "Share screen"}
              accessibilityLabel={screenShareActionLabel(sharing ? "sharing" : "idle")}
              active={sharing}
              onPress={toggleShare}
            />
          ) : null}
          <Control
            testID="livekit-more"
            icon={moreOpen ? "x" : "more-horizontal"}
            label={moreOpen ? "Close more controls" : "More controls"}
            accessibilityLabel={moreOpen ? "Close more call controls" : "Open more call controls"}
            active={moreOpen}
            onPress={() => setMoreOpen((open) => !open)}
          />
          <Control
            testID="livekit-leave"
            icon="phone-off"
            label="Leave"
            accessibilityLabel="Leave the class"
            danger
            onPress={announceLeave}
          />
        </div>
      ) : null}
    </div>
  );

}

const secondaryActionStyle: React.CSSProperties = {
  minHeight: HIT_SLOP_MIN,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: space.xs,
  padding: `0 ${space.sm}px`,
  border: `1px solid ${colors.onInverseMuted}`,
  borderRadius: radius.pill,
  background: colors.ink,
  color: colors.onInverse,
  fontFamily: t.caption.fontFamily,
  fontSize: t.caption.fontSize,
  cursor: "pointer",
};
