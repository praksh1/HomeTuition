/** One bounded recovery for a transient read. Never replay a mutation or an auth refusal. */
export function isTransientReadFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch transport failures
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: number }).status;
  return status === 502 || status === 503 || status === 504;
}

function pauseBeforeRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason ?? new Error("Request cancelled")); return; }
    const onAbort = () => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); reject(signal.reason ?? new Error("Request cancelled")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, 250);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function retryOneTransientRead<T>(
  work: () => Promise<T>,
  method: string | undefined,
  signal: AbortSignal,
  pause: (signal: AbortSignal) => Promise<void> = pauseBeforeRetry,
): Promise<T> {
  try { return await work(); }
  catch (error) {
    if ((method ?? "GET").toUpperCase() !== "GET" || signal.aborted || !isTransientReadFailure(error)) throw error;
    await pause(signal);
    if (signal.aborted) throw error;
    // This uses the original request's signal/deadline, not a new budget.
    return work();
  }
}
