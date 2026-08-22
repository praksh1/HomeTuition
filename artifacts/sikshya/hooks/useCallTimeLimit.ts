import { useEffect, useMemo, useRef, useState } from "react";
import { callTimeState, type SessionWindowInput } from "@/utils/sessionWindow";

/**
 * The two things that happen to a call as it runs out of time.
 *
 * The owner asked for both: a warning five minutes before the end that closes itself after
 * thirty seconds if nobody touches it, and a hard stop ten minutes past the booked finish that
 * says what is happening and then ends the call.
 *
 * In a hook rather than in each classroom because there are two classrooms, teacher and
 * student, and a rule about when a call stops that is written twice will eventually be written
 * differently twice — the same reason the timeline itself lives in one file. Both screens get
 * the same clock and the same words.
 *
 * The clock is the *server's*, offset by however wrong the handset's is. A phone twenty
 * minutes fast would otherwise cut a lesson short twenty minutes early, which on this app's
 * target market is not a hypothetical.
 */

/** How long the five-minute warning stays up before closing itself. */
export const WARNING_AUTO_CLOSE_MS = 30_000;

/** How long the overtime notice is shown before the call is actually ended. */
export const OVERTIME_GRACE_MS = 8_000;

export interface CallTimeLimit {
  /** True while the five-minute warning should be on screen. */
  showWarning: boolean;
  /** Closes the warning for good — the person has seen it. */
  dismissWarning: () => void;
  /** True once the call is past its cutoff and the overtime notice should show. */
  overtime: boolean;
  /** Minutes left, for the warning's wording. Never negative. */
  minutesLeft: number;
}

export interface CallTimeLimitOptions {
  session: SessionWindowInput | null;
  /**
   * The server's time when we last heard it, and the local clock reading at that moment.
   * Without them the handset's own clock is used, which is the best that can be done but is
   * worth knowing about.
   */
  serverTime?: string | null;
  serverTimeReceivedAt?: number;
  /**
   * Called once, a few seconds after the overtime notice appears. This is what actually ends
   * the call; the delay exists so the room is told before it is closed rather than after.
   */
  onCutoff?: () => void;
  /** False while the call is not running, so nothing fires on a screen nobody is in. */
  active?: boolean;
}

export function useCallTimeLimit({
  session,
  serverTime = null,
  serverTimeReceivedAt = 0,
  onCutoff,
  active = true,
}: CallTimeLimitOptions): CallTimeLimit {
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);
  const [warningShownAt, setWarningShownAt] = useState<number | null>(null);
  const cutoffFired = useRef(false);

  // A second is fine: nothing here needs to be more precise than the minute it announces, and
  // a tighter interval is work a cheap phone is already short of.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  /** The server's clock, carried forward by how long ago we heard it. */
  const serverNow = useMemo(() => {
    if (!serverTime) return now;
    const parsed = Date.parse(serverTime);
    if (Number.isNaN(parsed)) return now;
    return parsed + (now - serverTimeReceivedAt);
  }, [serverTime, serverTimeReceivedAt, now]);

  const { pastWarning, overtime: pastCutoff, minutesLeft } = useMemo(
    () => (session ? callTimeState(session, serverNow) : { pastWarning: false, overtime: false, minutesLeft: 0 }),
    [session, serverNow],
  );
  const overtime = active && pastCutoff;

  // Once it is up, remember when — the thirty seconds are counted from that, not from the
  // moment the lesson passed the five-minute mark.
  useEffect(() => {
    if (!active || dismissed || overtime) return;
    if (pastWarning && warningShownAt === null) setWarningShownAt(Date.now());
  }, [active, dismissed, overtime, pastWarning, warningShownAt]);

  useEffect(() => {
    if (warningShownAt === null) return;
    const timer = setTimeout(() => setDismissed(true), WARNING_AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [warningShownAt]);

  /**
   * The call is ended a few seconds after the notice appears, not at the same instant.
   *
   * "Announce the overtime and automatically end the call" — in that order. A call that
   * vanishes at the same moment the explanation appears has not explained anything.
   */
  useEffect(() => {
    if (!overtime || cutoffFired.current) return;
    cutoffFired.current = true;
    const timer = setTimeout(() => onCutoff?.(), OVERTIME_GRACE_MS);
    return () => clearTimeout(timer);
  }, [overtime, onCutoff]);

  return {
    showWarning: active && pastWarning && !dismissed && !overtime,
    dismissWarning: () => setDismissed(true),
    overtime,
    minutesLeft,
  };
}
