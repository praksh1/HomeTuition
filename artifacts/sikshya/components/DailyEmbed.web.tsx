import React, { useEffect, useRef, useState } from "react";

interface Props {
  roomUrl: string;
  /** Daily meeting token. Carries owner rights for the session's teacher, so they can mute
   * or remove participants; students get a plain token or none at all. */
  meetingToken?: string | null;
  displayName: string;
  onLeft?: () => void;
  watchUserName?: string;
  onWatchedParticipantLeft?: () => void;
  /** Unused on web — accepted so parent can pass StyleSheet.absoluteFill without TS error. */
  style?: unknown;
  /** Unused on web: Daily Prebuilt renders its own screen-share button in the iframe. Only
   * the native build has to supply one, since it has no prebuilt UI. */
  canScreenShare?: boolean;
}

/**
 * Module-level Daily singleton state.
 *
 * Daily.js enforces exactly ONE frame per page at a time.  The challenge is
 * that React cleanup functions are synchronous, but `callFrame.destroy()` is
 * async.  This means a new effect can fire before the old frame's `destroy()`
 * has fully resolved — causing the "Duplicate DailyIframe instances are not
 * allowed" error.
 *
 * Solution: `_pendingDestroy` holds the in-flight destroy promise.  The new
 * effect always `await`s it before calling `createFrame()`, regardless of
 * whether the destroy was started by the cleanup or by the effect itself.
 */
let _activeFrame: any = null;
let _pendingDestroy: Promise<void> = Promise.resolve();

/**
 * Daily rejects with a plain object (`{action:'error', errorMsg:'…'}`), not an Error, so the
 * obvious `String(err)` renders a useless "[object Object]" where the actual reason should be.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    for (const key of ["errorMsg", "message", "error", "reason"]) {
      const v = o[key];
      if (typeof v === "string" && v) return v;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return "Unknown error";
    }
  }
  return String(err);
}

/** Fire-and-forget: clears _activeFrame and records the destroy promise. */
function scheduleDestroy() {
  if (_activeFrame) {
    const frame = _activeFrame;
    _activeFrame = null;
    _pendingDestroy = frame.destroy().catch(() => {});
  }
}

export default function DailyEmbed({
  roomUrl,
  meetingToken,
  displayName,
  onLeft,
  watchUserName,
  onWatchedParticipantLeft,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const cbRef = useRef({ onLeft, watchUserName, onWatchedParticipantLeft });
  cbRef.current = { onLeft, watchUserName, onWatchedParticipantLeft };

  useEffect(() => {
    if (!roomUrl || !containerRef.current) return;

    let cancelled = false;

    (async () => {
      try {
        const { default: DailyIframe } = await import("@daily-co/daily-js");

        // Kick off destroy of any existing frame and wait for it to fully
        // complete.  This covers two cases:
        //   1. The cleanup from the previous mount already called scheduleDestroy()
        //      and the promise is still in flight — we just await it.
        //   2. A frame somehow survived without going through cleanup — we
        //      destroy it here before proceeding.
        scheduleDestroy();
        await _pendingDestroy;

        if (cancelled || !containerRef.current) return;

        const callFrame = DailyIframe.createFrame(containerRef.current, {
          iframeStyle: { width: "100%", height: "100%", border: "0" },
          showLeaveButton: true,
          showFullscreenButton: true,
        });

        _activeFrame = callFrame;

        const iframe = (callFrame as any).iframe?.();
        if (iframe) {
          iframe.allow = "camera; microphone; autoplay; display-capture";
          iframe.style.border = "none";
          iframe.style.outline = "none";
        }

        callFrame.on("participant-left", (event: any) => {
          const leftName = event?.participant?.user_name;
          const { watchUserName: watched, onWatchedParticipantLeft: cb } =
            cbRef.current;
          if (watched && leftName === watched) cb?.();
        });

        callFrame.on("left-meeting", () => {
          cbRef.current.onLeft?.();
        });

        await callFrame.join({ url: roomUrl, userName: displayName, ...(meetingToken ? { token: meetingToken } : null) });
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = describeError(err);
          console.error("[DailyEmbed] failed:", msg, err);
          setJoinError(msg);
        }
      }
    })();

    return () => {
      cancelled = true;
      scheduleDestroy(); // synchronous: clears _activeFrame, stores destroy promise
    };
  }, [roomUrl, displayName, meetingToken]);

  if (joinError) {
    return React.createElement(
      "div",
      {
        style: {
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#111",
          color: "#fff",
          fontFamily: "sans-serif",
          padding: "24px",
          gap: "12px",
          textAlign: "center",
        },
      },
      React.createElement("span", { style: { fontSize: "32px" } }, "📡"),
      React.createElement(
        "p",
        { style: { fontSize: "14px", color: "#ccc", maxWidth: "320px" } },
        "Unable to initialize video room. Please check your internet connection or video provider settings."
      ),
      React.createElement(
        "p",
        {
          style: {
            fontSize: "11px",
            color: "#555",
            maxWidth: "320px",
            wordBreak: "break-all",
          },
        },
        joinError
      )
    );
  }

  return React.createElement("div", {
    ref: containerRef,
    style: {
      position: "absolute",
      inset: 0,
      backgroundColor: "#111111",
      overflow: "hidden",
    },
  });
}
