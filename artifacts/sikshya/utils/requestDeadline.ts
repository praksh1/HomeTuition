/**
 * A hard edge around work that depends on another process.
 *
 * `fetch()` has no deadline of its own. During an API restart a browser can therefore keep a
 * request pending long after the server has returned, which used to leave Fadko's red launch
 * screen spinning forever. The AbortController asks cooperative work to stop; the surrounding
 * promise is what guarantees that even a transport which ignores abort still settles on time.
 */
export const DEFAULT_API_TIMEOUT_MS = 12_000;

export class RequestTimeoutError extends Error {
  readonly code = "REQUEST_TIMEOUT";
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request exceeded its ${timeoutMs}ms deadline`);
    this.name = "RequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function withinRequestDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new RangeError("timeoutMs must be a positive number"));
  }

  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish(() => reject(new RequestTimeoutError(timeoutMs)));
    }, timeoutMs);

    Promise.resolve()
      .then(() => work(controller.signal))
      .then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
  });
}
