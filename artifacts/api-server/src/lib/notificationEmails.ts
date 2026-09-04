/**
 * The words Sikshya sends when it tells somebody something happened.
 *
 * Pure, and in its own file for the reason `accountNotices.ts` is: wording that talks about money
 * has to be testable without a database behind it. `notify.ts` decides *whether* to send and to
 * whom; this decides *what it says*.
 *
 * The rule the split is here to protect: **a sentence about money must be true about that
 * particular event.** A teacher told "booked and paid" about an operator-granted test booking has
 * been told something false about their own income, and there is no amount of care in the sending
 * code that fixes a formatter which cannot tell the two apart.
 */

export type NotificationKind =
  | "message"
  | "follower"
  | "session_live"
  | "session_invite"
  | "session_booked"
  | "session_dropped"
  | "session_cancelled"
  | "session_rescheduled";

export interface NotificationEvent {
  kind: NotificationKind;
  at: string;
  fromUserId?: number;
  fromName?: string;
  preview?: string;
  sessionId?: number;
  topic?: string;
  /** What was paid, for the notifications about money arriving or going back. */
  amount?: number;
  /**
   * True when the thing being announced involved **no payment at all** — an operator-granted
   * test booking.
   *
   * Typed rather than inferred, and never inferred from `amount === 0`: a free class and a class
   * nobody was charged for are different facts, and one of them needs saying out loud. Every
   * formatter that mentions money must branch on this. A teacher told "booked and paid" about a
   * booking that took no money is being told something untrue about their own income, which is
   * the exact class of defect this project keeps finding.
   */
  test?: boolean;
  /** When a class has been moved: where it is now, as an ISO string. */
  newDate?: string;
  /** When a class has been moved: where it was before. */
  previousDate?: string;
}

/** Where a person is sent when they act on the email. Falls back to the app's own domain. */
function appUrl(path: string): string {
  const base = (process.env.APP_URL ?? process.env.EXPO_PUBLIC_DOMAIN ?? "").replace(/\/+$/, "");
  if (!base) return "";
  const origin = base.startsWith("http") ? base : `https://${base}`;
  return `${origin}${path}`;
}

export function emailFor(event: NotificationEvent, recipientName: string): { subject: string; text: string } | null {
  const hello = `Hi ${recipientName.split(" ")[0] || "there"},`;
  const signoff = "\n\nYou can turn these emails off in the app under Profile → Notifications.\n— Sikshya";

  switch (event.kind) {
    case "message": {
      const link = appUrl(`/conversation/${event.fromUserId ?? ""}`);
      return {
        subject: `New message from ${event.fromName ?? "someone"}`,
        text:
          `${hello}\n\n${event.fromName ?? "Someone"} sent you a message:\n\n` +
          `  "${event.preview ?? ""}"\n` +
          (link ? `\nRead and reply: ${link}\n` : "") +
          signoff,
      };
    }
    case "follower":
      return {
        subject: `${event.fromName ?? "A student"} is now following you`,
        text:
          `${hello}\n\n${event.fromName ?? "A student"} has started following you on Sikshya. ` +
          `They will be told when you schedule a class.` +
          signoff,
      };
    case "session_invite": {
      const link = appUrl(`/session/${event.sessionId ?? ""}`);
      return {
        subject: `${event.fromName ?? "Your teacher"} has scheduled "${event.topic ?? "a class"}"`,
        text:
          `${hello}\n\n${event.fromName ?? "Your teacher"} has scheduled a new class: ` +
          `"${event.topic ?? ""}".\n` +
          (link ? `\nSee it and book your place: ${link}\n` : "") +
          `\nYour place is not held until you book and pay for it.` +
          signoff,
      };
    }
    case "session_booked": {
      const link = appUrl(`/session/${event.sessionId ?? ""}`);
      // A test booking took no money, and the email a teacher reads about their own income must
      // not say it did. Same event, two sentences; nothing about the paid one changes.
      if (event.test) {
        return {
          subject: `${event.fromName ?? "A student"} joined "${event.topic ?? "your class"}" — TEST, no payment`,
          text:
            `${hello}\n\n${event.fromName ?? "A student"} has taken a place in your class ` +
            `"${event.topic ?? ""}".\n\n` +
            `This is a test booking made with operator-granted access. ` +
            `**No payment was processed** and nothing was added to your earnings.\n` +
            (link ? `\nSee who is coming: ${link}\n` : "") +
            signoff,
        };
      }
      return {
        subject: `${event.fromName ?? "A student"} booked "${event.topic ?? "your class"}"`,
        text:
          `${hello}\n\n${event.fromName ?? "A student"} has booked and paid for your class ` +
          `"${event.topic ?? ""}".\n` +
          (link ? `\nSee who is coming: ${link}\n` : "") +
          signoff,
      };
    }
    case "session_rescheduled": {
      const link = appUrl(`/session/${event.sessionId ?? ""}`);
      const when = event.newDate ? new Date(event.newDate).toUTCString() : "a new time";
      return {
        subject: `"${event.topic ?? "Your class"}" has been moved`,
        text:
          `${hello}\n\n${event.fromName ?? "Your teacher"} has moved your class ` +
          `"${event.topic ?? ""}" to ${when}.\n\n` +
          `You did not ask for this change, so if the new time does not suit you, you can ` +
          `drop the class for a full refund. That option is open for 24 hours.\n` +
          (link ? `\nSee the class: ${link}\n` : "") +
          signoff,
      };
    }
    case "session_dropped": {
      const link = appUrl(`/session/${event.sessionId ?? ""}`);
      return {
        subject: `${event.fromName ?? "A student"} dropped "${event.topic ?? "your class"}"`,
        text:
          `${hello}\n\n${event.fromName ?? "A student"} has dropped your class ` +
          `"${event.topic ?? ""}". Their place is back on sale.\n` +
          (link ? `\nSee who is coming: ${link}\n` : "") +
          signoff,
      };
    }
    case "session_cancelled": {
      return {
        subject: `"${event.topic ?? "Your class"}" has been cancelled`,
        text:
          `${hello}\n\n${event.fromName ?? "Your teacher"} has cancelled ` +
          `"${event.topic ?? "your class"}".\n\n` +
          (event.amount
            ? `A full refund of NPR ${event.amount} has been requested for you. Our team will ` +
              `process it within 5-7 business days.\n`
            : "") +
          signoff,
      };
    }
    case "session_live": {
      const link = appUrl(`/classroom/${event.sessionId ?? ""}`);
      return {
        subject: `"${event.topic ?? "Your class"}" has started`,
        text:
          `${hello}\n\nYour class "${event.topic ?? ""}" is live now.\n` +
          (link ? `\nJoin: ${link}\n` : "") +
          signoff,
      };
    }
    default:
      return null;
  }
}
