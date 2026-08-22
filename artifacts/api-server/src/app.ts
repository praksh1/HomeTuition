import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { logActivity } from "./middlewares/activityLog";

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

export default app;
