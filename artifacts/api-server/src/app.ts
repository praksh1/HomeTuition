import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { logActivity } from "./middlewares/activityLog";
import { MAX_UPLOAD_BYTES } from "./lib/fileStore";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// The payment webhook's signature covers the exact bytes the provider sent, so they are
// stashed here before parsing. Re-serialising the parsed object would reorder keys or change
// spacing and produce a different digest, rejecting every genuine callback.
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

/**
 * Mounted before the routes but recorded after them.
 *
 * It reads `req.user`, which each route's own `requireAuth` sets — that has happened by the
 * time the response finishes, which is when this writes. See middlewares/activityLog.ts.
 */
app.use(logActivity);

app.use("/api", router);

/**
 * Every failure leaves here as JSON, and never as a stack trace.
 *
 * There was no error handler at all, so anything a route did not catch fell through to
 * Express's default: an HTML page, with the stack in it whenever NODE_ENV is not "production".
 * Two things went wrong with that, and one of them cost a real user their upload.
 *
 * A body larger than the cap is rejected by the body parser *before* any route runs, so the
 * upload route's own polite message never got a chance. The app asked for JSON, got HTML,
 * could not read a reason, and told somebody "Load failed. We also could not send it through
 * our server" — which names neither the size nor the cap nor anything they could act on.
 *
 * The other is simply that a stack trace is not for the public.
 */
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const status = typeof (err as { status?: number })?.status === "number" ? (err as { status: number }).status : 500;
  const type = (err as { type?: string })?.type;

  // The one a person can act on, phrased the way the upload route phrases it so the two cannot
  // drift into saying different things about the same limit.
  if (status === 413 || type === "entity.too.large") {
    res.status(413).json({
      error: `That file is larger than ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
      maxBytes: MAX_UPLOAD_BYTES,
    });
    return;
  }

  if (status === 400 && (type === "entity.parse.failed" || type === "encoding.unsupported")) {
    res.status(400).json({ error: "That request could not be read." });
    return;
  }

  req.log?.error({ err }, "unhandled error");
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: status === 500 ? "Something went wrong. Please try again." : "That request was refused.",
  });
});

export default app;
