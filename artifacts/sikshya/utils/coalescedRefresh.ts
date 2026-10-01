/** Share an in-flight read and remember one trailing nudge instead of issuing parallel reads. */
export function createCoalescedRefresh(read: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let queued = false;
  return () => {
    if (inFlight) { queued = true; return inFlight; }
    // Scheduling through a promise also makes synchronously triggered nudges coalesce.
    inFlight = Promise.resolve().then(async () => {
      do { queued = false; await read(); } while (queued);
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
}
