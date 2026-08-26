import { useEffect, useRef, useState } from "react";
import { aloneState, type AlonePhase } from "@/utils/aloneInCall";

/**
 * Drives the "the other side is not here" clock for a live call.
 *
 * The rule itself is in `utils/aloneInCall.ts` and is pure; this is only the ticking, and the
 * one side effect that matters — ending the call when the fifteen minutes are up.
 *
 * Written once for both classrooms. A student waiting for their teacher and a teacher waiting
 * for anybody at all are the same situation seen from two chairs, and the app got into trouble
 * precisely by treating similar situations as unrelated code.
 */
export interface AloneInCallOptions {
  /**
   * True while this person is by themselves in the call.
   *
   * The screens decide what that means: for a student it is their teacher having gone, for a
   * teacher it is nobody having arrived. Flipping this back to false is what cancels a warning
   * already on screen, silently, which is what should happen when somebody rejoins.
   */
  alone: boolean;
  /** False while there is no call to be alone in, so nothing runs on an idle screen. */
  active: boolean;
  /** Ends the call. Fired once, when the allowance is spent. */
  onCutoff?: () => void;
}

export function useAloneInCall({ alone, active, onCutoff }: AloneInCallOptions): AlonePhase {
  /** When this stretch of being alone began. Null whenever somebody else is here. */
  const [aloneSince, setAloneSince] = useState<number | null>(null);
  const [phase, setPhase] = useState<AlonePhase>({ phase: "together" });
  const firedRef = useRef(false);
  const cutoffRef = useRef(onCutoff);
  cutoffRef.current = onCutoff;

  useEffect(() => {
    if (!active || !alone) {
      /*
       * Cleared rather than paused. Somebody who drops for four minutes, comes back, and drops
       * again gets a fresh five minutes — which is the generous reading, and the right one on
       * connections that flicker.
       */
      setAloneSince(null);
      setPhase({ phase: "together" });
      firedRef.current = false;
      return;
    }
    setAloneSince((since) => since ?? Date.now());
  }, [alone, active]);

  useEffect(() => {
    if (aloneSince === null) return;
    /*
     * Every ten seconds. The screen shows whole minutes, so a faster tick would only redraw the
     * same words — and this runs on cheap phones during a video call, where the CPU has better
     * things to do.
     */
    const tick = () => {
      const next = aloneState(aloneSince, Date.now());
      setPhase(next);
      if (next.phase === "over" && !firedRef.current) {
        firedRef.current = true;
        cutoffRef.current?.();
      }
    };
    tick();
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, [aloneSince]);

  return phase;
}
