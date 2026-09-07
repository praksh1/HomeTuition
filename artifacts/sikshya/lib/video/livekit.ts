import {
  ConnectionQuality,
  ConnectionState,
  MediaDeviceFailure,
  Room,
  RoomEvent,
  Track,
  VideoPreset,
  VideoPresets43,
  VideoQuality,
  type LocalTrackPublication,
  type Participant,
  type TrackPublication,
} from "livekit-client";
import type {
  JoinRoomOptions,
  MediaProblem,
  Unsubscribe,
  VideoConnectionQuality,
  VideoConnectionState,
  VideoMediaHandle,
  VideoParticipant,
  VideoSession,
} from "./types";

/**
 * LiveKit, behind `lib/video/types.ts`.
 *
 * Imperative and free of React on purpose: a call outlives a render, and a hook that owns a
 * WebRTC connection re-establishes it every time somebody changes a piece of unrelated state.
 * `components/LiveKitEmbed.web.tsx` is the thin React layer over this.
 *
 * ## Built for a cheap phone on a bad line
 *
 * Four decisions, all of them about bandwidth rather than picture quality:
 *
 * - **480p and no higher**, on capture and on publish. A 720p camera costs roughly three and a
 *   half times the bitrate of this and looks no better in a 200-pixel tile.
 * - **Simulcast**, three layers. The sender encodes 180p, 360p and 480p at once and the server
 *   forwards whichever a given receiver can actually take, so one student on a weak line does
 *   not drag the resolution down for the whole class.
 * - **Adaptive stream**, so a tile that is small gets a small layer and a tile scrolled off
 *   screen gets nothing at all until it comes back.
 * - **Dynacast**, so a layer nobody is watching stops being encoded and sent. On the teacher's
 *   side, in a class where every student is looking at the whiteboard, that is most of the
 *   upstream bandwidth saved.
 *
 * Together they are the difference between a class that works on a 3G handset in Nepal and one
 * that works on a developer's laptop.
 *
 * ## The documentation could not be read
 *
 * `docs.livekit.io` is blocked by this environment's network egress proxy. Everything here is
 * written against the installed SDK's own TypeScript definitions and source, which are
 * authoritative for the API surface but say nothing about behaviour under a real network. What
 * that leaves unverified is listed in VIDEO.md under the LiveKit trial.
 */

/**
 * The cap: 640×480, 500 kbps, 20 fps.
 *
 * Exactly 480p, from the SDK's own 4:3 set rather than numbers typed here. Four by three
 * because a 4:3 tile fills more of a phone screen held upright than a 16:9 one does, and
 * because at this bitrate the taller frame spends its pixels on the face rather than on the
 * wall either side of it.
 */
const CAMERA_CAP = VideoPresets43.h480;

/**
 * The two layers underneath, sent alongside the cap.
 *
 * 240×180 at 125 kbps and 480×360 at 330 kbps. A student whose line will not carry 500 kbps
 * receives one of these instead of receiving a stuttering 480p, and nobody else is affected.
 */
const CAMERA_SIMULCAST_LAYERS = [VideoPresets43.h180, VideoPresets43.h360];

/**
 * A shared screen, also capped at 480 lines — 854×480 at 500 kbps, five frames a second.
 *
 * Deliberately not one of the SDK's screen-share presets: the cheapest of those is 360p and the
 * next is 720p, which is above the cap. Screen sharing is nearly always text, so the frames go
 * into resolution rather than smoothness; five a second is enough to follow a cursor and a
 * scroll. This is the secondary path in any case — the whiteboard is the app's own tool and
 * costs a fraction of a video track.
 */
const SCREEN_CAP = new VideoPreset(854, 480, 500_000, 5, "medium");

/** LiveKit's connection states in the app's vocabulary. */
function toConnectionState(state: ConnectionState): VideoConnectionState {
  switch (state) {
    case ConnectionState.Connecting:
      return "connecting";
    case ConnectionState.Connected:
      return "connected";
    case ConnectionState.Reconnecting:
    // The signalling socket dropped but media may still be flowing. To a person it is the same
    // event and the same message — the call is wobbling and the SDK is fixing it.
    case ConnectionState.SignalReconnecting:
      return "reconnecting";
    default:
      return "disconnected";
  }
}

function toQuality(quality: ConnectionQuality): VideoConnectionQuality {
  switch (quality) {
    case ConnectionQuality.Excellent:
      return "excellent";
    case ConnectionQuality.Good:
      return "good";
    case ConnectionQuality.Poor:
      return "poor";
    case ConnectionQuality.Lost:
      return "lost";
    default:
      return "unknown";
  }
}

/**
 * Why a device would not start.
 *
 * `MediaDeviceFailure.getFailure` reads the browser's `DOMException` name, which differs
 * between Chrome, Firefox and Safari for the same underlying refusal — which is exactly why it
 * is worth going through the SDK rather than matching on `err.name` here.
 */
function toMediaProblem(kind: MediaProblem["kind"], err: unknown): MediaProblem {
  switch (MediaDeviceFailure.getFailure(err)) {
    case MediaDeviceFailure.PermissionDenied:
      return { kind, reason: "denied" };
    case MediaDeviceFailure.NotFound:
      return { kind, reason: "missing" };
    case MediaDeviceFailure.DeviceInUse:
      return { kind, reason: "in-use" };
    default:
      return { kind, reason: "unknown" };
  }
}

/** A publication as something the view can attach, or null if there is no track behind it yet. */
function handleFor(publication: TrackPublication | undefined): VideoMediaHandle | null {
  const track = publication?.track;
  if (!publication || !track) return null;
  return {
    id: publication.trackSid,
    attach: (element) => {
      track.attach(element);
    },
    detach: (element) => {
      track.detach(element);
    },
  };
}

function describe(participant: Participant, isLocal: boolean): VideoParticipant {
  return {
    id: participant.identity,
    // Falls back to the identity — the account id — rather than to an empty string, so a tile
    // for somebody whose name did not arrive is still identifiable rather than anonymous.
    name: participant.name || participant.identity,
    isLocal,
    isSpeaking: participant.isSpeaking,
    micEnabled: participant.isMicrophoneEnabled,
    cameraEnabled: participant.isCameraEnabled,
    camera: handleFor(participant.getTrackPublication(Track.Source.Camera)),
    screen: handleFor(participant.getTrackPublication(Track.Source.ScreenShare)),
    // Never the local microphone: a browser playing your own voice back at you is feedback.
    microphone: isLocal
      ? null
      : handleFor(participant.getTrackPublication(Track.Source.Microphone)),
    quality: toQuality(participant.connectionQuality),
  };
}

/** Every event that can change what the roster should look like. */
const ROSTER_EVENTS: RoomEvent[] = [
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.ActiveSpeakersChanged,
  RoomEvent.ConnectionQualityChanged,
  RoomEvent.ParticipantNameChanged,
  // Not a roster change, but it changes what the call surface must show — the "turn sound on"
  // button appears and disappears with it, and it rides the same notification.
  RoomEvent.AudioPlaybackStatusChanged,
];

class LiveKitSession implements VideoSession {
  readonly provider = "livekit";

  private readonly room: Room;
  private readonly connectionListeners = new Set<(state: VideoConnectionState) => void>();
  private readonly rosterListeners = new Set<(participants: VideoParticipant[]) => void>();
  private readonly problemListeners = new Set<(problem: MediaProblem) => void>();
  private wantsAudioOnly: boolean;
  private left = false;
  /**
   * The camera the person chose, so `switchCamera` can rotate through the list.
   *
   * Held here rather than read back from the track: a track that is currently off has no device
   * to read, and the choice should survive the camera being turned off and on again.
   */
  private cameraDeviceId: string | null = null;

  constructor(room: Room, audioOnly: boolean) {
    this.room = room;
    this.wantsAudioOnly = audioOnly;
    this.room.on(RoomEvent.ConnectionStateChanged, this.handleConnectionState);
    for (const event of ROSTER_EVENTS) this.room.on(event, this.handleRoster);
    // A camera published after audio-only was turned on must be caught, or the student who
    // joined last silently spends the bandwidth the mode exists to save.
    this.room.on(RoomEvent.TrackPublished, this.applyAudioOnlyToRemotes);
    this.room.on(RoomEvent.ParticipantConnected, this.applyAudioOnlyToRemotes);
    this.room.on(RoomEvent.MediaDevicesError, this.handleDeviceError);
  }

  /**
   * A device that failed on its own, rather than in answer to a toggle.
   *
   * A microphone unplugged mid-lesson, or another application seizing the camera. The toggles
   * catch their own failures; this catches everything else, so a person is told the same way
   * whichever way the device was lost.
   */
  private handleDeviceError = (error: Error, kind?: MediaDeviceKind) => {
    const which: MediaProblem["kind"] = kind === "videoinput" ? "camera" : "microphone";
    this.report(toMediaProblem(which, error));
  };

  get audioOnly(): boolean {
    return this.wantsAudioOnly;
  }

  private handleConnectionState = (state: ConnectionState) => {
    const mapped = toConnectionState(state);
    for (const fn of this.connectionListeners) fn(mapped);
    // A reconnect can bring back a different roster — somebody left while we were away.
    this.handleRoster();
  };

  private handleRoster = () => {
    if (this.rosterListeners.size === 0) return;
    const roster = this.getParticipants();
    for (const fn of this.rosterListeners) fn(roster);
  };

  private report(problem: MediaProblem) {
    for (const fn of this.problemListeners) fn(problem);
  }

  getParticipants(): VideoParticipant[] {
    return [
      describe(this.room.localParticipant, true),
      ...[...this.room.remoteParticipants.values()].map((p) => describe(p, false)),
    ];
  }

  async leaveRoom(): Promise<void> {
    if (this.left) return;
    this.left = true;
    this.room.off(RoomEvent.ConnectionStateChanged, this.handleConnectionState);
    for (const event of ROSTER_EVENTS) this.room.off(event, this.handleRoster);
    this.room.off(RoomEvent.TrackPublished, this.applyAudioOnlyToRemotes);
    this.room.off(RoomEvent.ParticipantConnected, this.applyAudioOnlyToRemotes);
    this.room.off(RoomEvent.MediaDevicesError, this.handleDeviceError);
    try {
      await this.room.disconnect();
    } finally {
      // Cleared after disconnecting, not before: a listener that wants to hear "disconnected"
      // should, and a half-torn-down session that still fires events is worse than a late one.
      this.connectionListeners.clear();
      this.rosterListeners.clear();
      this.problemListeners.clear();
    }
  }

  async toggleMic(on?: boolean): Promise<boolean> {
    const want = on ?? !this.room.localParticipant.isMicrophoneEnabled;
    try {
      await this.room.localParticipant.setMicrophoneEnabled(want);
    } catch (err) {
      this.report(toMediaProblem("microphone", err));
      // Report what is true rather than what was asked for. A control that shows "on" over a
      // microphone that never started is how somebody talks to a class for ten minutes.
      return this.room.localParticipant.isMicrophoneEnabled;
    }
    this.handleRoster();
    return this.room.localParticipant.isMicrophoneEnabled;
  }

  async toggleCamera(on?: boolean): Promise<boolean> {
    const want = on ?? !this.room.localParticipant.isCameraEnabled;
    /*
      Audio-only wins over a camera request rather than quietly undoing itself.

      Somebody who put the class into audio-only did so because their connection could not carry
      video; a stray camera toggle should not spend that bandwidth back. `setAudioOnly(false)`
      is the one way out, so the decision lives in one place.
    */
    if (want && this.wantsAudioOnly) return false;
    try {
      await this.room.localParticipant.setCameraEnabled(
        want,
        want ? this.cameraCaptureOptions() : undefined,
      );
    } catch (err) {
      this.report(toMediaProblem("camera", err));
      return this.room.localParticipant.isCameraEnabled;
    }
    this.handleRoster();
    return this.room.localParticipant.isCameraEnabled;
  }

  private cameraCaptureOptions() {
    return {
      resolution: CAMERA_CAP.resolution,
      ...(this.cameraDeviceId ? { deviceId: this.cameraDeviceId } : {}),
    };
  }

  async switchCamera(): Promise<boolean> {
    let cameras: MediaDeviceInfo[];
    try {
      cameras = await Room.getLocalDevices("videoinput");
    } catch (err) {
      this.report(toMediaProblem("camera", err));
      return false;
    }
    // One camera, or none. Not a failure — a laptop simply has nothing to switch to.
    if (cameras.length < 2) return false;

    const current =
      this.cameraDeviceId ??
      this.room.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack
        ?.getSettings().deviceId ??
      null;
    const index = cameras.findIndex((device) => device.deviceId === current);
    const next = cameras[(index + 1) % cameras.length];
    if (!next || next.deviceId === current) return false;

    try {
      await this.room.switchActiveDevice("videoinput", next.deviceId);
    } catch (err) {
      this.report(toMediaProblem("camera", err));
      return false;
    }
    this.cameraDeviceId = next.deviceId;
    this.handleRoster();
    return true;
  }

  async startScreenShare(): Promise<boolean> {
    try {
      await this.room.localParticipant.setScreenShareEnabled(
        true,
        { resolution: SCREEN_CAP.resolution, contentHint: "text" },
        { screenShareEncoding: SCREEN_CAP.encoding },
      );
    } catch (err) {
      /*
        Cancelling the browser's picker throws, and it is not a problem to report.

        Chrome and Firefox raise `NotAllowedError` both when a person clicks Cancel and when the
        page has no screen-capture permission at all, so the two are indistinguishable here. A
        banner saying "screen sharing was refused" every time somebody changes their mind is
        worse than saying nothing, so the return value carries the outcome and the toast does
        not fire.
      */
      if (!this.room.localParticipant.isScreenShareEnabled) return false;
    }
    this.handleRoster();
    return this.room.localParticipant.isScreenShareEnabled;
  }

  async stopScreenShare(): Promise<void> {
    try {
      await this.room.localParticipant.setScreenShareEnabled(false);
    } finally {
      this.handleRoster();
    }
  }

  /**
   * Unsubscribe from — or resubscribe to — every remote camera.
   *
   * This SDK has no room-level audio-only switch, so it is done a publication at a time.
   * `applyAudioOnlyToRemotes` is therefore also called on `TrackPublished`: a student who joins
   * *after* the mode was turned on would otherwise arrive with their camera subscribed and
   * quietly undo it for everybody.
   */
  private applyAudioOnlyToRemotes = () => {
    const wanted = !this.wantsAudioOnly;
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.videoTrackPublications.values()) {
        /*
          Cameras only. A shared screen stays.

          Audio-only exists so a weak line stops carrying *faces*, which are the part of a
          lesson nobody needs to see. A teacher's shared screen is the opposite: it is the
          content, like the whiteboard, and dropping it would leave a student listening to
          somebody describe a document they cannot see.
        */
        if (publication.source !== Track.Source.Camera) continue;
        if (publication.isSubscribed !== wanted) publication.setSubscribed(wanted);
      }
    }
  };

  /**
   * Carry only the cameras that have a tile, at the size that tile is.
   *
   * The money, in about fifteen lines. Everything else in this file affects one person's upload;
   * this affects every person's download, which in a ten-way discussion is nine times as much
   * traffic. See `utils/discussionLayout.ts` for who ends up on the list.
   *
   * `setVideoQuality` names a simulcast layer that is already being published — 180p, 360p or the
   * 480p cap — so asking for `low` costs the publisher nothing and saves the subscriber most of
   * the bytes. It is a hint on top of `adaptiveStream` rather than a replacement for it: adaptive
   * sizing is measured from the element, and an element that has just appeared has no size yet.
   */
  setCameraPlan(plan: {
    subscribe: string[];
    unsubscribe: string[];
    quality: Record<string, "low" | "medium" | "high">;
  }): void {
    // Audio-only has already dropped every camera on purpose. Re-subscribing four of them here
    // would undo the one thing a student turned on to keep a lesson alive on a weak line.
    if (this.wantsAudioOnly) return;

    const wanted = new Set(plan.subscribe);
    const dropped = new Set(plan.unsubscribe);

    for (const participant of this.room.remoteParticipants.values()) {
      const id = participant.identity;
      for (const publication of participant.videoTrackPublications.values()) {
        // A shared screen is content, like the whiteboard, and is never part of the tile budget.
        if (publication.source !== Track.Source.Camera) continue;

        if (dropped.has(id) && publication.isSubscribed) publication.setSubscribed(false);
        else if (wanted.has(id) && !publication.isSubscribed) publication.setSubscribed(true);

        const want = plan.quality[id];
        if (!want || !publication.isSubscribed) continue;
        if (typeof publication.setVideoQuality !== "function") continue;
        publication.setVideoQuality(
          want === "high" ? VideoQuality.HIGH : want === "medium" ? VideoQuality.MEDIUM : VideoQuality.LOW,
        );
      }
    }
  }

  async setAudioOnly(on: boolean): Promise<void> {
    this.wantsAudioOnly = on;
    /*
      Both directions, and the receiving half is the one that matters.

      Stopping this person's camera saves their upload. Unsubscribing from everyone else's saves
      their download, which in a class of nine is eight times as much traffic. The whiteboard
      and the audio are untouched, so the lesson carries on — which is the whole point of the
      mode existing rather than the call simply ending.
    */
    this.applyAudioOnlyToRemotes();
    if (on && this.room.localParticipant.isCameraEnabled) {
      try {
        await this.room.localParticipant.setCameraEnabled(false);
      } catch {
        // Turning a camera *off* failing is not worth a banner; it is already not being sent.
      }
    }
    this.handleRoster();
  }

  get audioBlocked(): boolean {
    return !this.room.canPlaybackAudio;
  }

  /**
   * Let the sound through, from inside a click handler.
   *
   * Chrome and Safari refuse to play audio on a page nobody has interacted with, and a student
   * following a link straight into a class is exactly that page. The SDK retries playback here;
   * because this runs inside the click, the browser allows it.
   */
  async unblockAudio(): Promise<void> {
    try {
      await this.room.startAudio();
    } finally {
      this.handleRoster();
    }
  }

  onConnectionStateChange(fn: (state: VideoConnectionState) => void): Unsubscribe {
    this.connectionListeners.add(fn);
    // Fire once with the current state, so a component that mounts mid-connection is not left
    // showing "connecting" until the next transition happens to arrive.
    fn(toConnectionState(this.room.state));
    return () => this.connectionListeners.delete(fn);
  }

  onParticipantsChange(fn: (participants: VideoParticipant[]) => void): Unsubscribe {
    this.rosterListeners.add(fn);
    fn(this.getParticipants());
    return () => this.rosterListeners.delete(fn);
  }

  onMediaProblem(fn: (problem: MediaProblem) => void): Unsubscribe {
    this.problemListeners.add(fn);
    return () => this.problemListeners.delete(fn);
  }

  /** Publishes the tracks a fresh join should start with. Called once, after connecting. */
  async publishInitialTracks(startMuted: boolean): Promise<void> {
    const results = await Promise.allSettled([
      this.room.localParticipant.setMicrophoneEnabled(!startMuted),
      this.wantsAudioOnly
        ? Promise.resolve<LocalTrackPublication | undefined>(undefined)
        : this.room.localParticipant.setCameraEnabled(true, this.cameraCaptureOptions()),
    ]);
    /*
      Settled, not `all`.

      A refused camera must not take the microphone down with it. A student who declined the
      camera prompt — or has no camera — should still be in the class and still be heard; each
      device is reported separately and the call continues with whatever started.
    */
    const kinds: MediaProblem["kind"][] = ["microphone", "camera"];
    results.forEach((result, index) => {
      if (result.status === "rejected") this.report(toMediaProblem(kinds[index]!, result.reason));
    });
    this.handleRoster();
  }
}

/**
 * Connect, and hand back the call.
 *
 * The room options are the low-bandwidth configuration described at the top of this file. They
 * are set here rather than per-track so that every track this app ever publishes inherits them
 * — a future feature that publishes a second camera cannot accidentally publish it at 1080p.
 */
export async function joinLiveKitRoom(options: JoinRoomOptions): Promise<VideoSession> {
  const room = new Room({
    // Send the smallest layer a given receiver's tile actually needs, and nothing at all for a
    // tile that is off screen.
    adaptiveStream: true,
    // Stop encoding a layer nobody is subscribed to. Off by default in the SDK; on here because
    // a class watching the whiteboard is the normal case, not the exception.
    dynacast: true,
    videoCaptureDefaults: { resolution: CAMERA_CAP.resolution },
    publishDefaults: {
      videoEncoding: CAMERA_CAP.encoding,
      videoSimulcastLayers: CAMERA_SIMULCAST_LAYERS,
      simulcast: true,
      screenShareEncoding: SCREEN_CAP.encoding,
      // Keep the frame rate and let the resolution fall when the line narrows. A stuttering
      // face is harder to follow than a soft one, and speech carries the lesson regardless.
      degradationPreference: "maintain-framerate",
      // Speech, not music: a quarter of the default bitrate for something nobody will hear the
      // difference in over a phone speaker.
      audioPreset: { maxBitrate: 24_000 },
      dtx: true,
      red: true,
      // VP8 rather than a newer codec: it is the one every Android browser in this market can
      // decode in hardware, and hardware decoding is battery and heat on a cheap handset.
      videoCodec: "vp8",
    },
  });

  const session = new LiveKitSession(room, options.audioOnly === true);
  await room.connect(options.url, options.token);
  if (options.audioOnly) await session.setAudioOnly(true);
  await session.publishInitialTracks(options.startMuted === true);
  return session;
}
