/** Periodic fail-closed access checks for sockets that outlive account or token changes.
 * Does not query on every pen stroke. A failed/slow lookup terminates the connection;
 * reconnect must pass the normal fresh-account handshake again.
 */
export function watchSocketAccount(
  socket: { readyState: number; terminate(): void; once(event: string, listener: () => void): unknown },
  allowed: () => Promise<boolean>,
  intervalMs = 15_000,
  timeoutMs = 5_000,
): () => void {
  let stopped = false;
  let checking = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { stopped = true; clearInterval(timer); if (deadline) clearTimeout(deadline); };
  const reject = () => { if (!stopped) { stop(); socket.terminate(); } };
  const timer = setInterval(() => {
    if (stopped || checking) return;
    if (socket.readyState !== 1) { stop(); return; }
    checking = true;
    deadline = setTimeout(reject, timeoutMs);
    deadline.unref?.();
    void Promise.resolve().then(allowed).then(ok => { if (!ok) reject(); }, reject).finally(() => {
      if (deadline) clearTimeout(deadline);
      checking = false;
    });
  }, intervalMs);
  timer.unref?.();
  socket.once("close", stop);
  socket.once("error", stop);
  return stop;
}
