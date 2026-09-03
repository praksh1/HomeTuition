/**
 * The words Sikshya uses when an operator decides something about a person's account.
 *
 * These were written inline in `routes/admin.ts` as string templates, and one of them said
 * **"Your citizenship was approved."** Sikshya does not approve anybody's citizenship. A
 * government issued that document; Sikshya accepted a copy of it for its own teacher check. The
 * difference is not pedantry — a teacher who reads "your citizenship was approved" from a company
 * has been told something untrue about their legal status by an organisation that has no standing
 * to say it.
 *
 * The second problem was the same sentence doing two jobs. Accepting a document and approving a
 * teacher account are separate decisions, and an operator can do the first while the second stays
 * pending. The old wording ("Your teaching credentials have been approved. You can schedule
 * classes now.") announced both at once and was wrong about the consequence as well: an approved
 * teacher still cannot schedule anything until they hold a teaching plan.
 *
 * Pure string composition with no imports, so the wording can be unit-tested without a database,
 * a mail provider, or a running server. That is also why the tests can assert on the exact
 * phrases this project has promised never to send again.
 */

export interface AccountNotice {
  /** One line for the in-app notification list, where there is no room for the full message. */
  preview: string;
  /** The email subject. */
  subject: string;
  /** The email body, already addressed to the recipient. */
  body: string;
}

/**
 * Phrases that must never appear in a notice, with the reason each one is banned.
 *
 * Exported so the test file asserts against this list rather than its own copy of it: a banned
 * phrase added here is then automatically checked against every notice the module can produce.
 */
export const FORBIDDEN_PHRASES: readonly { phrase: string; because: string }[] = [
  { phrase: "citizenship was approved", because: "Sikshya does not approve citizenship" },
  { phrase: "citizenship approved", because: "Sikshya does not approve citizenship" },
  { phrase: "identity approved", because: "Sikshya does not verify legal identity" },
  { phrase: "identity was approved", because: "Sikshya does not verify legal identity" },
  {
    phrase: "verified your identity",
    because: "accepting a document copy is not identity verification",
  },
  {
    phrase: "you can schedule classes now",
    because: "an approved teacher still needs a teaching plan first",
  },
];

/** `teaching_license` → `teaching license document`, without doubling the word "document". */
function documentLabel(documentType: string): string {
  const words = documentType.replaceAll("_", " ").trim().toLowerCase();
  if (!words) return "document";
  return words.endsWith("document") ? words : `${words} document`;
}

function greeting(recipientName: string): string {
  const first = recipientName.trim().split(" ")[0];
  return `Hello ${first || "there"},`;
}

const SIGN_OFF = "\n\n— Sikshya";

/**
 * A decision about one uploaded document.
 *
 * Acceptance deliberately carries its own limit in the same breath: this is one part of the
 * review and does not by itself switch teacher access on. Without that sentence the message
 * reads as "you are approved", and the teacher goes looking for a Start Class button that is not
 * there yet.
 */
export function documentDecisionNotice(input: {
  documentType: string;
  decision: "approved" | "rejected";
  /** The operator's reason. Required for a rejection; ignored for an acceptance. */
  reason?: string;
  recipientName: string;
}): AccountNotice {
  const label = documentLabel(input.documentType);

  if (input.decision === "approved") {
    return {
      preview: `Your ${label} has been accepted for Sikshya's teacher verification.`,
      subject: "Sikshya document review update",
      body:
        `${greeting(input.recipientName)}\n\n` +
        `The ${label} you submitted has been accepted for Sikshya's teacher verification. ` +
        `This document decision is one part of the review; it does not by itself activate ` +
        `teacher access. We will notify you separately when the account review is complete.` +
        SIGN_OFF,
    };
  }

  // No "unfortunately", no "we regret", no judgement of the person. The teacher needs to know
  // which document, what was wrong with it, and that the door is open again — nothing else.
  const reason = (input.reason ?? "").trim();
  return {
    preview: `Your ${label} was not accepted. You can upload a replacement.`,
    subject: "Sikshya document review update — action needed",
    body:
      `${greeting(input.recipientName)}\n\n` +
      `The ${label} you submitted was not accepted for Sikshya's teacher verification.\n\n` +
      `Reason given by the reviewer: ${reason}\n\n` +
      `You can upload a replacement document in the app now. Your account review continues ` +
      `once a replacement has been reviewed.` +
      SIGN_OFF,
  };
}

/**
 * A decision about the teacher account itself — the one that governs access.
 *
 * The approval says what genuinely comes next. Choosing a teaching plan is the actual next step,
 * and `mayBuyTeacherPlan()` on the server is what this decision unlocks.
 */
export function teacherAccessDecisionNotice(input: {
  decision: "approved" | "rejected";
  /** The operator's note. Required for a rejection. */
  note?: string;
  recipientName: string;
}): AccountNotice {
  if (input.decision === "approved") {
    return {
      preview: "Your Sikshya teacher account has been approved. You may now choose a teaching plan.",
      subject: "Your Sikshya teacher account has been approved",
      body:
        `${greeting(input.recipientName)}\n\n` +
        `Your Sikshya teacher account has been approved. You may now choose a teaching plan, ` +
        `after which you can schedule classes.` +
        SIGN_OFF,
    };
  }

  const note = (input.note ?? "").trim();
  return {
    preview: "Your Sikshya teacher account was not approved. See the reason in the app.",
    subject: "Sikshya teacher account review — action needed",
    body:
      `${greeting(input.recipientName)}\n\n` +
      `Your Sikshya teacher account has not been approved at this stage.\n\n` +
      `Reason given by the reviewer: ${note}\n\n` +
      `You can update your profile and documents in the app and the review will continue.` +
      SIGN_OFF,
  };
}

/**
 * What actually happened to the email, as three distinguishable outcomes.
 *
 * `sendEmail()` returns one boolean for two very different situations — the provider rejected the
 * message, and no provider is configured at all. An operator needs to tell those apart: the first
 * is a problem to chase, the second is a deployment that was never finished. Collapsing them is
 * how "they have been told" ends up on screen when nothing was sent.
 */
export type EmailOutcome = "sent" | "failed" | "not_configured";

/**
 * The sentence the operator reads under a saved decision.
 *
 * `inAppDelivered` is whether the notification reached a live app connection, and that is the
 * *only* thing it can mean. Sikshya has no server-side notification store: `notifyUser()` writes
 * to whatever sockets are open at that instant and the app keeps its own list in device storage.
 * A teacher whose app was closed receives nothing in-app, then or later — the notification is not
 * queued and does not arrive on next open.
 *
 * An earlier version of this function said "they will see it when they next open the app", which
 * is false for exactly that reason. It was the same class of untruth as the "They have been told."
 * this module was written to delete, and it survived one review because it *sounds* like the
 * reassuring thing to say. Do not reintroduce a promise of future in-app delivery until persistent
 * notifications actually exist — `HANDOVER.md` §8.8 tracks that gap.
 *
 * When neither channel reached the teacher, the sentence says so in those words. An operator who
 * reads "the decision was saved" and nothing else will reasonably assume the person was told.
 */
export function deliveryLine(outcome: EmailOutcome, inAppDelivered: boolean): string {
  const noInApp = "No in-app notification was delivered because the teacher was not connected.";
  const inApp = "The notification appeared in their open app.";

  switch (outcome) {
    case "sent":
      return inAppDelivered
        ? `The teacher was emailed. ${inApp}`
        : `The teacher was emailed. ${noInApp}`;

    case "failed":
      return inAppDelivered
        ? `The decision was saved. The email could not be delivered, but the notification appeared in their open app.`
        : "The decision was saved, but the teacher has NOT been notified: the email could not be " +
          "delivered and they were not connected to receive an in-app notification.";

    case "not_configured":
      return inAppDelivered
        ? `The decision was saved. Email is not configured on this server, so none was sent. ${inApp}`
        : "The decision was saved, but the teacher has NOT been notified: email is not configured " +
          "on this server and they were not connected to receive an in-app notification.";
  }
}
