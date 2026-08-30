import React, { useCallback, useEffect, useRef, useState } from "react";

interface ChatMessage {
  id: string;
  senderName: string;
  text: string;
  time: string;
  isMe: boolean;
}

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
  /**
   * The class conversation, carried by the classroom socket.
   *
   * Daily Prebuilt has a chat panel of its own and it is switched off deliberately — see
   * .agents/memory/one-chat-per-class.md. The native app has no Prebuilt at all, so turning
   * Daily's chat on would give a class with one laptop and one phone two conversations that
   * cannot see each other, with both sides looking like they work.
   *
   * So the same messages are rendered here instead, over the call, the way the native build
   * already does. Chat is inside the call on both platforms, and there is still one
   * conversation.
   */
  chatMessages?: ChatMessage[];
  onSendChat?: (text: string) => void;
  /**
   * Draw the app's own chat over the call.
   *
   * Off everywhere today — see IN_CALL_CHAT_ENABLED. The prop exists so the tests can still
   * exercise the panel while it is switched off, which is what keeps a disabled feature from
   * quietly rotting until the day someone wants it back.
   */
  enableInCallChat?: boolean;
}

/**
 * How long to wait for the call to come up before saying something.
 *
 * Generous, because a first join on a slow connection legitimately takes a while and crying
 * off early would be its own kind of wrong.
 */
const JOIN_TIMEOUT_MS = 20000;

/** Height of the strip above the call that holds our own chat control. */
const CHAT_STRIP_PX = 38;

/**
 * Whether the app draws its own chat over the call.
 *
 * Off because the classroom now owns the slide-over chat. Rendering another panel here would
 * duplicate the same socket conversation inside the already-small PIP. Daily's own unrelated
 * chat is disabled at the room level too, so every platform has one conversation.
 *
 * Turned off rather than deleted, deliberately and at the owner's request: the day this
 * project moves off Daily, this panel is what a standalone call would need, and it works — its
 * faults were in how much room it took, not in what it did. The tests in
 * scripts/call-chat-tests still drive it, so it cannot rot while it waits.
 */
const IN_CALL_CHAT_ENABLED = false;

/** Shown when the call has not come up in time. Not an error — a state, with a way out. */
const SLOW_JOIN = "The video call is taking longer than usual to connect.";

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
 * The Daily module itself, kept once it has been imported.
 *
 * Only so an abandoned frame can be found again — see `claimOrphanedFrame`. Daily is loaded as
 * a module rather than a global, so there is nothing else to ask.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _dailySdk: any = null;

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

/**
 * Ends the call and tears the frame down, in that order.
 *
 * `destroy()` on its own removes the iframe but does not reliably end the call inside it, and a
 * frame still in a call keeps its camera and microphone. Reported from a real session: the
 * teacher ended the class, went back to their session list, and the webcam light was still on
 * with the browser's camera indicator showing in the address bar. Nothing in the app was using
 * the camera — the abandoned call was.
 *
 * So `leave()` first, then `destroy()`, and the destroy still runs if the leave fails: a frame
 * that will not leave must not be left behind holding the devices.
 *
 * Fire-and-forget by design — the caller is a React cleanup and cannot await — but the promise
 * is recorded so the next mount waits for it rather than racing a half-destroyed frame.
 */
function scheduleDestroy() {
  const frame = _activeFrame ?? claimOrphanedFrame();
  if (!frame) return;
  _activeFrame = null;
  _pendingDestroy = Promise.resolve()
    .then(() => frame.leave())
    .catch(() => {
      // Already left, never joined, or the frame is in a state that refuses. Either way the
      // destroy below is what actually has to happen.
    })
    .then(() => frame.destroy())
    .catch(() => {});
}

/**
 * A call frame that exists without this module knowing about it.
 *
 * Daily keeps its own reference to the one frame a page may have. If a frame is ever created
 * and this module's own pointer is lost — a re-render at the wrong moment, an error between
 * creating and recording it — that frame holds the camera and nothing here would ever release
 * it. Asking Daily is the only way to find it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function claimOrphanedFrame(): any {
  try {
    return _dailySdk?.getCallInstance?.() ?? null;
  } catch {
    return null;
  }
}

export default function DailyEmbed({
  roomUrl,
  meetingToken,
  displayName,
  onLeft,
  watchUserName,
  onWatchedParticipantLeft,
  chatMessages,
  onSendChat,
  enableInCallChat = IN_CALL_CHAT_ENABLED,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [unseen, setUnseen] = useState(0);
  const lastSeenCount = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const joinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cbRef = useRef({ onLeft, watchUserName, onWatchedParticipantLeft });
  cbRef.current = { onLeft, watchUserName, onWatchedParticipantLeft };
  /**
   * Whether this side ever actually got into the call.
   *
   * Daily emits `left-meeting` when a join **fails** as well as when somebody hangs up, and the
   * teacher's classroom treats a leave as "end this class for everyone and go back". So a room
   * that could not be reached — a poor connection, a room that has expired, Daily having a bad
   * day — quietly marked the lesson finished and threw the teacher out of their own class, with
   * "Class ended" as the only explanation.
   *
   * That is the market this is built for: the connections here are exactly the ones where a
   * join fails. A leave only means a leave if there was something to leave.
   */
  const joined = useRef(false);

  // An unread count on the button, so a message sent while the panel is shut is not missed.
  useEffect(() => {
    const total = chatMessages?.length ?? 0;
    if (chatOpen) {
      lastSeenCount.current = total;
      setUnseen(0);
    } else {
      setUnseen(Math.max(0, total - lastSeenCount.current));
    }
  }, [chatMessages, chatOpen]);

  useEffect(() => {
    if (!chatOpen || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chatMessages, chatOpen]);

  const submitChat = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    onSendChat?.(text);
    setDraft("");
  }, [draft, onSendChat]);

  useEffect(() => {
    if (!roomUrl || !containerRef.current) return;

    let cancelled = false;

    (async () => {
      try {
        const { default: DailyIframe } = await import("@daily-co/daily-js");
        _dailySdk = DailyIframe;

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
          /**
           * One way out, not two.
           *
           * The call had its own Leave button and the classroom had an End button above it,
           * doing different amounts of work: Daily's left the call, ours ends the class for
           * everyone and marks it finished. Two buttons that look the same and are not is a
           * trap on a small screen. The classroom's End is the one that survives, because it
           * is the one that means what a teacher thinks it means.
           */
          showLeaveButton: false,
          // The classroom already owns the only floating video window. Daily's fullscreen /
          // pop-out control would create a second competing PIP from inside that PIP.
          showFullscreenButton: false,
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
          // A join that never succeeded is not a departure. See `joined` above.
          if (!joined.current) return;
          joined.current = false;
          cbRef.current.onLeft?.();
        });

        // If the call does come up after all — a slow network rather than a broken one — take
        // the message back down rather than leaving it contradicting a working video.
        callFrame.on("joined-meeting", () => {
          joined.current = true;
          if (joinTimer.current) {
            clearTimeout(joinTimer.current);
            joinTimer.current = null;
          }
          if (!cancelled) setJoinError(null);
        });

        // `join()` does not reject when the room cannot be reached — it simply never settles.
        // Measured, not assumed: pointed at an unreachable room it sat there indefinitely, and
        // the classroom showed a black rectangle with no explanation and nothing to do. On the
        // connections this product is built for that is a common state, so it gets a deadline.
        if (joinTimer.current) clearTimeout(joinTimer.current);
        joinTimer.current = setTimeout(() => {
          if (!cancelled) setJoinError(SLOW_JOIN);
        }, JOIN_TIMEOUT_MS);

        await callFrame.join({ url: roomUrl, userName: displayName, ...(meetingToken ? { token: meetingToken } : null) });
        joined.current = true;
        if (joinTimer.current) {
          clearTimeout(joinTimer.current);
          joinTimer.current = null;
        }
        if (!cancelled) setJoinError(null);
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
      joined.current = false;
      if (joinTimer.current) {
        clearTimeout(joinTimer.current);
        joinTimer.current = null;
      }
      scheduleDestroy(); // synchronous: clears _activeFrame, stores destroy promise
    };
  }, [roomUrl, displayName, meetingToken]);

  const h = React.createElement;
  const showChat = enableInCallChat && Boolean(onSendChat);

  /**
   * The panel sits over the call rather than beside it.
   *
   * Prebuilt fills its container and cannot be asked to make room, and the alternative the
   * classroom had — a Chat tab that hid the video completely — is what made chatting during a
   * lesson feel like leaving it.
   */
  const chatPanel = h(
    "div",
    {
      key: "chat",
      style: {
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width: "min(320px, 80%)",
        display: "flex",
        flexDirection: "column",
        background: "rgba(17,17,17,0.96)",
        borderLeft: "1px solid #262626",
        fontFamily: "sans-serif",
        zIndex: 3,
      },
    },
    h(
      "div",
      {
        key: "head",
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          borderBottom: "1px solid #262626",
          color: "#fff",
          fontSize: "14px",
          fontWeight: 600,
        },
      },
      h("span", { key: "t" }, "Class chat"),
      h(
        "button",
        {
          key: "x",
          onClick: () => setChatOpen(false),
          "aria-label": "Close chat",
          style: {
            background: "transparent",
            border: 0,
            color: "#9ca3af",
            fontSize: "20px",
            lineHeight: 1,
            cursor: "pointer",
            padding: "0 4px",
          },
        },
        "\u00d7",
      ),
    ),
    h(
      "div",
      {
        key: "list",
        ref: scrollRef,
        style: { flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" },
      },
      (chatMessages ?? []).length === 0
        ? h("p", { key: "empty", style: { color: "#6b7280", fontSize: "13px", margin: 0 } }, "No messages yet.")
        : (chatMessages ?? []).map((m) =>
            h(
              "div",
              {
                key: m.id,
                style: {
                  alignSelf: m.isMe ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  background: m.isMe ? "#C41E3A" : "#1f2937",
                  color: "#fff",
                  borderRadius: "12px",
                  padding: "8px 10px",
                },
              },
              m.isMe ? null : h("div", { key: "s", style: { fontSize: "11px", color: "#cbd5e1", marginBottom: "2px" } }, m.senderName),
              h("div", { key: "b", style: { fontSize: "13.5px", whiteSpace: "pre-wrap", wordBreak: "break-word" } }, m.text),
            ),
          ),
    ),
    h(
      "div",
      { key: "input", style: { display: "flex", gap: "8px", padding: "10px", borderTop: "1px solid #262626" } },
      h("input", {
        key: "field",
        value: draft,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
        onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submitChat();
          }
        },
        placeholder: "Message the class\u2026",
        style: {
          flex: 1,
          background: "#1f2937",
          border: "1px solid #374151",
          borderRadius: "10px",
          color: "#fff",
          padding: "9px 11px",
          fontSize: "13.5px",
          outline: "none",
          minWidth: 0,
        },
      }),
      h(
        "button",
        {
          key: "send",
          onClick: submitChat,
          style: {
            background: "#C41E3A",
            border: 0,
            borderRadius: "10px",
            color: "#fff",
            padding: "0 14px",
            fontSize: "13.5px",
            fontWeight: 600,
            cursor: "pointer",
          },
        },
        "Send",
      ),
    ),
  );

  /**
   * The chat button lives in a strip of our own above the call, not floating over it.
   *
   * It used to sit at the top-right corner of the iframe, on the assumption that Prebuilt
   * keeps its controls along the bottom. That is true on a laptop and false on a phone: a
   * recording from a real iPhone shows this button sitting directly on top of Prebuilt's
   * Leave button and its fullscreen control, all three overlapping. Aiming for Chat and
   * hitting Leave ends the teacher's class.
   *
   * Reserving a strip costs a little height and cannot collide with anything, now or when
   * Daily next changes its layout — which is worth more than the pixels, given that guessing
   * where a third-party UI puts its buttons is what caused this.
   */
  const chatButton = h(
    "button",
    {
      key: "chatbtn",
      onClick: () => setChatOpen(true),
      "aria-label": unseen > 0 ? `Open chat, ${unseen} unread` : "Open chat",
      style: {
        position: "absolute",
        top: "6px",
        right: "10px",
        zIndex: 3,
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "rgba(17,17,17,0.85)",
        border: "1px solid #374151",
        borderRadius: "999px",
        color: "#fff",
        padding: "7px 13px",
        fontSize: "13px",
        fontFamily: "sans-serif",
        cursor: "pointer",
      },
    },
    "Chat",
    unseen > 0
      ? h(
          "span",
          {
            key: "n",
            style: {
              background: "#C41E3A",
              borderRadius: "999px",
              minWidth: "18px",
              padding: "1px 5px",
              fontSize: "11px",
              fontWeight: 700,
              textAlign: "center",
            },
          },
          unseen > 9 ? "9+" : String(unseen),
        )
      : null,
  );

  /**
   * Shown over the call rather than instead of it.
   *
   * This used to return early, which took the chat panel with it — so a student whose video
   * failed lost the one way they had left to say so. The class conversation does not depend on
   * the camera working.
   */
  const errorOverlay = h(
    "div",
    {
      key: "err",
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
        zIndex: 2,
      },
    },
    h("span", { key: "i", style: { fontSize: "32px" } }, "\ud83d\udce1"),
    h(
      "p",
      { key: "m", style: { fontSize: "14px", color: "#ccc", maxWidth: "340px", lineHeight: 1.5 } },
      joinError === SLOW_JOIN
        ? "The video call is taking longer than usual to connect. It is still trying \u2014 you can use the board and chat in the meantime."
        : "Unable to start the video call. Check your connection, then leave and rejoin. You can still use the board and chat.",
    ),
    joinError === SLOW_JOIN
      ? null
      : h(
          "p",
          { key: "d", style: { fontSize: "11px", color: "#555", maxWidth: "320px", wordBreak: "break-all" } },
          joinError,
        ),
  );

  return h(
    "div",
    {
      style: {
        position: "absolute",
        inset: 0,
        backgroundColor: "#111111",
        overflow: "hidden",
      },
    },
    h("div", {
      key: "frame",
      ref: containerRef,
      style: { position: "absolute", top: showChat ? CHAT_STRIP_PX : 0, right: 0, bottom: 0, left: 0 },
    }),
    joinError ? errorOverlay : null,
    showChat ? (chatOpen ? chatPanel : chatButton) : null,
  );
}
