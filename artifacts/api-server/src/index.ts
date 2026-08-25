import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { attachClassroomHub } from "./ws/classroomHub";
import { describePaymentMode, paymentMode } from "./lib/payments";
import {
  ensureNotificationPrefsTable,
  ensureSessionActivityTable,
  ensureSessionBoardTable,
  ensureSessionParticipationTable,
  ensureDisputeColumns,
  ensureSessionMessagesTable,
  ensureActivityLogTable,
  ensureDisputeReasons,
  ensureSupportDeskSchema,
  ensureScheduleAndRefundTables,
  ensureMonthlyTierTables,
  ensureMonthlyEnforcementColumns,
  ensureMonthlyPortalTables,
  ensureTicketLifecycle,
} from "./lib/ensureSchema";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);
attachClassroomHub(server);

server.listen(port, () => {
  logger.info({ port }, "Server listening");
  // Deliberately after listen and deliberately not awaited: the server must come up whatever
  // the database is doing. See lib/ensureSchema.ts for why this exists at all.
  void ensureNotificationPrefsTable();
  void ensureSessionActivityTable();
  void ensureSessionBoardTable();
  void ensureSessionParticipationTable();
  void ensureDisputeColumns();
  void ensureSessionMessagesTable();
  void ensureActivityLogTable();
  void ensureDisputeReasons();
  void ensureSupportDeskSchema();
  void ensureScheduleAndRefundTables();
  void ensureMonthlyTierTables();
  void ensureMonthlyEnforcementColumns();
  void ensureMonthlyPortalTables();
  void ensureTicketLifecycle();
  // Whether real money can move is too important to have to go and look up.
  if (paymentMode() === "simulated") logger.warn(describePaymentMode());
  else logger.info(describePaymentMode());
});

server.on("error", (err: Error) => {
  logger.error({ err }, "Error starting server");
  process.exit(1);
});
