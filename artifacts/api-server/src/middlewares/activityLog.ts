import type { NextFunction, Request, Response } from "express";
import { recordActivity } from "../lib/activityLog";
import { describeRequest } from "../lib/requestAction";

/**
 * Records every request that changes something.
 *
 * The owner asked for a log of "every action taken by all users". A hand-written
 * `recordActivity` call per route cannot honestly claim that: it covers the routes somebody
 * remembered on the day and silently stops covering the next one added. So the coverage comes
 * from here — every POST, PATCH, PUT and DELETE that succeeds is written down, whatever route
 * it hit — and named calls elsewhere add meaning on top for the events worth naming.
 *
 * Reads are not logged. A log of every GET would be enormous, would bury the actions an agent
 * is looking for, and would record nothing anybody did.
 *
 * Recorded after the response is sent, so nothing here is on the path of the request itself.
 */

const WRITES = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export function logActivity(req: Request, res: Response, next: NextFunction): void {
  if (!WRITES.has(req.method)) return next();

  res.on("finish", () => {
    // Only what actually happened. A refused request is not an action taken, and logging
    // every 400 would fill the log with typos and probing.
    if (res.statusCode >= 400) return;

    const { action, subjectType, subjectId } = describeRequest(req.method, req.path);
    recordActivity({
      userId: req.user?.userId ?? null,
      action,
      subjectType,
      subjectId,
      detail: { method: req.method, path: req.path, status: res.statusCode },
      // Behind Railway's proxy the direct address is the proxy's, so the forwarded header is
      // the only thing that identifies the caller. First entry: the rest are proxies.
      ip: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
        ?? req.ip
        ?? null,
    });
  });

  next();
}
