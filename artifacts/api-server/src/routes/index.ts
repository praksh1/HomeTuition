import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import teachersRouter from "./teachers";
import sessionsRouter from "./sessions";
import reviewsRouter from "./reviews";
import storageRouter from "./storage";
import messagesRouter from "./messages";
import disputesRouter from "./disputes";
import notificationsRouter from "./notifications";
import sessionMessagesRouter from "./sessionMessages";
import adminRouter, { passwordResetRouter } from "./admin";
import operatorsRouter from "./operators";
import dropsRouter from "./drops";
import monthlyRouter from "./monthly";
import monthlyPortalRouter from "./monthlyPortal";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(teachersRouter);
router.use(sessionsRouter);
router.use(reviewsRouter);
router.use(storageRouter);
router.use(messagesRouter);
router.use(disputesRouter);
router.use(notificationsRouter);
router.use(sessionMessagesRouter);
router.use(dropsRouter);
router.use(monthlyRouter);
router.use(monthlyPortalRouter);
router.use(operatorsRouter);
router.use(adminRouter);
router.use(passwordResetRouter);

export default router;
