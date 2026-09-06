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
   * The signed join token, minted by the API.
   *
   * It carries the room, the identity and the rights: only a teacher's token permits screen
   * sharing or moderation. Nothing this component does can widen them, which is the point of
   * minting it server-side.
   */
  meetingToken?: string | null;
  displayName: string;
  onLeft?: () => void;
  /** Watch for one named person leaving — how a student learns the teacher has gone. */
  watchUserName?: string;
  onWatchedParticipantLeft?: () => void;
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
      return `Your ${device} is blocked. Tap the padlock in the address bar, allow ${device === "microphone" ? "Microphone" : "Camera"}, then reload this page.`;
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
              // Top right, not bottom right: every tile carries its name along its bottom
              // edge, and an inset in that corner sat on top of somebody's name.
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
        background: colors.secondary,
        // A speaking person is outlined rather than enlarged: re-laying out the grid every time
        // somebody says "yes" is unusable on a small panel.
        outline: participant.isSpeaking ? `2px solid ${colors.online}` : "none",
        outlineOffset: "-2px",
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
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          gap: `${space.xxs}px`,
          padding: `${space.xxs}px ${space.xs}px`,
          background: colors.scrim,
          color: colors.onInverse,
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
function Control({
  label,
  onPress,
  active,
  danger,
  testID,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  testID: string;
}) {
  const background = danger ? colors.destructive : active ? colors.primary : colors.secondary;
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      aria-pressed={active}
      data-testid={testID}
      style={{
        minWidth: `${HIT_SLOP_MIN}px`,
        minHeight: `${HIT_SLOP_MIN}px`,
        padding: `0 ${space.sm}px`,
        borderRadius: `${radius.pill}px`,
        border: "none",
        background,
        color: colors.onInverse,
        fontFamily: t.caption.fontFamily,
        fontSize: `${t.caption.fontSize}px`,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

export default function LiveKitEmbed({
  roomUrl,
  meetingToken,
  displayName,
  onLeft,
  watchUserName,
  onWatchedParticipantLeft,
  canScreenShare,
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

  /*
    Callbacks in refs, read at the moment they fire.

    A parent that rebuilds `onLeft` on every render would otherwise re-run the join effect and
    tear down a live call to rebuild an identical one. The effect below depends only on where
    the call is and who is joining it.
  */
  const onLeftRef = useRef(onLeft);
  const onWatchedLeftRef = useRef(onWatchedParticipantLeft);
  const watchNameRef = useRef(watchUserName);
  onLeftRef.current = onLeft;
  onWatchedLeftRef.current = onWatchedParticipantLeft;
  watchNameRef.current = watchUserName;

  /** Whether the watched person has ever been seen, so their absence means something. */
  const watchedSeen = useRef(false);
  const watchedReported = useRef(false);

  useEffect(() => {
    if (!roomUrl || !meetingToken) return;
    let cancelled = false;
    const cleanups: (() => void)[] = [];

    // Says "still trying", not "failed" — the SDK is still working and usually wins.
    const slowTimer = setTimeout(() => {
      if (!cancelled) setSlow(true);
    }, JOIN_TIMEOUT_MS);

    (async () => {
      try {
        const live = await joinRoom({ url: roomUrl, token: meetingToken });
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
            if (state === "disconnected") onLeftRef.current?.();
          }),
        );
        cleanups.push(
          live.onParticipantsChange((roster) => {
            setParticipants(roster);
            setSoundBlocked(live.audioBlocked);
            setAudioOnlyState(live.audioOnly);

            const watched = watchNameRef.current;
            if (!watched) return;
            const present = roster.some((p) => !p.isLocal && p.name === watched);
            if (present) {
              watchedSeen.current = true;
              // Rearmed on their return: a teacher whose connection dropped and came back can
              // legitimately leave again later, and the student should be told again.
              watchedReported.current = false;
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
      for (const cancel of cleanups) cancel();
      /*
        Fire and forget, because a React cleanup is synchronous and a disconnect is not.

        `lib/video` holds one call at a time and closes the old one before opening the next, so
        a remount that races this cannot end with two rooms connected.
      */
      void leaveRoom();
      setSession(null);
    };
  }, [roomUrl, meetingToken]);

  const local = participants.find((p) => p.isLocal) ?? null;
  const remotes = useMemo(() => participants.filter((p) => !p.isLocal), [participants]);
  /** A shared screen takes the whole panel: it is the thing being looked at. */
  const screen = useMemo(() => participants.find((p) => p.screen !== null) ?? null, [participants]);

  const [gridRef, gridBox] = useBoxSize();
  const columns = bestColumns(remotes.length, gridBox.width, gridBox.height);

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
        background: colors.ink,
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
            {remotes.map((participant) => (
              <Tile key={participant.id} participant={participant} />
            ))}
          </div>
        )}

        {/* The self-view, small and in the corner — the one tile nobody is watching. */}
        {local ? <Tile participant={local} inset /> : null}
      </div>

      <div
        data-testid="livekit-controls"
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: `${space.xs}px`,
          padding: `${space.xs}px`,
          background: colors.ink,
        }}
      >
        <Control
          testID="livekit-mic"
          label={local?.micEnabled ? "Mute" : "Unmute"}
          active={local?.micEnabled === true}
          onPress={act((live) => live.toggleMic())}
        />
        <Control
          testID="livekit-camera"
          label={local?.cameraEnabled ? "Camera off" : "Camera on"}
          active={local?.cameraEnabled === true}
          onPress={act((live) => live.toggleCamera())}
        />
        <Control
          testID="livekit-flip"
          label="Flip"
          onPress={act((live) => live.switchCamera())}
        />
        {canScreenShare ? (
          <Control
            testID="livekit-share"
            label={sharing ? "Stop sharing" : "Share screen"}
            active={sharing}
            onPress={toggleShare}
          />
        ) : null}
        <Control
          testID="livekit-audio-only"
          label={audioOnly ? "Video on" : "Audio only"}
          active={audioOnly}
          onPress={act((live) => live.setAudioOnly(!live.audioOnly))}
        />
        <Control
          testID="livekit-leave"
          label="Leave"
          danger
          onPress={() => {
            void leaveRoom();
            onLeftRef.current?.();
          }}
        />
      </div>
    </div>
  );
}
