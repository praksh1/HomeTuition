import type { Request, Response, NextFunction } from "express";
import { emailVerifiedFor, onboardingCompleteFor } from "../lib/accountSecurity";

/** Guard new teaching/bookings, not the recovery/upload endpoints needed to finish a profile. */
export async function requireReadyAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: "Sign in to continue." }); return; }
  if (req.user.role === "admin") { next(); return; }
  try {
    if (!await emailVerifiedFor(req.user.userId)) {
      res.status(403).json({ code: "EMAIL_UNVERIFIED", error: "Verify your email before creating or booking a class." }); return;
    }
    if (!await onboardingCompleteFor(req.user.userId)) {
      res.status(403).json({ code: "PROFILE_INCOMPLETE", error: "Complete your profile, including a photo and valid phone number, before creating or booking a class." }); return;
    }
    next();
  } catch { res.status(503).json({ error: "Could not check your account. Please try again." }); }
}
