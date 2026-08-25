/**
 * The rules about operator IDs and their one-time passwords.
 *
 * No imports on purpose. Node's `--experimental-strip-types` cannot resolve extensionless
 * runtime imports, so the rules a test needs to check live in a file that imports nothing and
 * the database work sits next door in `operatorStore.ts`.
 */

/** How long a one-time password is good for before an administrator has to reissue it. */
export const ONE_TIME_PASSWORD_HOURS = 48;

/** The shortest password an operator may choose for themselves. */
export const MIN_PASSWORD_LENGTH = 10;

export type Check = { ok: true } | { ok: false; reason: string };

/**
 * What makes an acceptable login ID.
 *
 * Deliberately narrow: lowercase letters, digits, dot, dash, underscore. An operator reads this
 * to a colleague over the phone and types it on a handset, so anything that looks different in
 * two fonts — capital I, lowercase l, a trailing space — is a support call about a support
 * tool. Case is folded rather than rejected so `Bina.Karki` and `bina.karki` are the same
 * person rather than two accounts nobody can tell apart.
 */
export function normaliseLoginId(raw: string): string {
  return raw.trim().toLowerCase();
}

export function checkLoginId(raw: string): Check {
  const id = normaliseLoginId(raw);
  if (!id) return { ok: false, reason: "Give the operator an ID to sign in with." };
  if (id.length < 3) return { ok: false, reason: "An operator ID needs at least 3 characters." };
  if (id.length > 32) return { ok: false, reason: "An operator ID can be at most 32 characters." };
  if (!/^[a-z0-9._-]+$/.test(id)) {
    return {
      ok: false,
      reason: "Use lowercase letters, numbers, dots, dashes or underscores — nothing else.",
    };
  }
  if (/^[._-]|[._-]$/.test(id)) {
    return { ok: false, reason: "An operator ID cannot start or end with a dot, dash or underscore." };
  }
  return { ok: true };
}

/**
 * What an operator may choose as their own password.
 *
 * Length rather than a character-class puzzle. Forcing a symbol and a digit produces
 * `Password1!` on every desk in the country; ten characters of anything is harder to guess and
 * far likelier to be remembered rather than written on the monitor.
 */
export function checkPassword(password: string, loginId: string): Check {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password.length > 200) {
    return { ok: false, reason: "That password is too long." };
  }
  if (normaliseLoginId(password) === normaliseLoginId(loginId)) {
    return { ok: false, reason: "Your password cannot be your operator ID." };
  }
  return { ok: true };
}

/**
 * Whether a one-time password issued at `issuedAt` may still be used.
 *
 * It expires because it travels by the least secure route in this whole system: an
 * administrator reading it aloud, or typing it into a message. A credential that works forever
 * once it has been said out loud is one that outlives the conversation it was said in.
 */
export function oneTimePasswordExpired(issuedAt: Date | number, now: number = Date.now()): boolean {
  const at = issuedAt instanceof Date ? issuedAt.getTime() : issuedAt;
  if (!Number.isFinite(at)) return true;
  return now - at > ONE_TIME_PASSWORD_HOURS * 60 * 60 * 1000;
}

export interface OperatorState {
  disabledAt: Date | null;
  mustChangePassword: boolean;
  createdAt: Date;
}

export type Gate =
  | { allowed: true }
  | { allowed: false; status: number; code: string; reason: string };

/**
 * May this operator sign in, and what must happen next?
 *
 * Three answers rather than two, because "your password has expired" and "your account is
 * switched off" send somebody to different people. An expired one-time password needs the
 * administrator who issued it; a disabled account needs to be told why it was disabled.
 */
export function signInGate(state: OperatorState, now: number = Date.now()): Gate {
  if (state.disabledAt) {
    return {
      allowed: false,
      status: 403,
      code: "operator_disabled",
      reason: "This operator ID has been switched off. Ask your administrator.",
    };
  }
  if (state.mustChangePassword && oneTimePasswordExpired(state.createdAt, now)) {
    return {
      allowed: false,
      status: 403,
      code: "one_time_password_expired",
      reason:
        `This ID's first-use password expired after ${ONE_TIME_PASSWORD_HOURS} hours. ` +
        "Ask your administrator to issue a new one.",
    };
  }
  return { allowed: true };
}

/**
 * A one-time password, generated rather than chosen.
 *
 * Read aloud, so the alphabet leaves out every character that is ambiguous when spoken or seen:
 * no O or 0, no I, l or 1, no S against 5. What remains is unambiguous over a phone line, which
 * is the only way this password ever travels.
 *
 * Grouped in fours because that is how a person reads a code back without losing their place.
 */
const SPEAKABLE = "ABCDEFGHJKMNPQRTUVWXYZ2346789";

export function formatOneTimePassword(bytes: Uint8Array, groups = 3, size = 4): string {
  const out: string[] = [];
  for (let g = 0; g < groups; g += 1) {
    let chunk = "";
    for (let i = 0; i < size; i += 1) {
      const byte = bytes[g * size + i] ?? 0;
      chunk += SPEAKABLE[byte % SPEAKABLE.length];
    }
    out.push(chunk);
  }
  return out.join("-");
}

/** How many random bytes `formatOneTimePassword` needs for the given shape. */
export function oneTimePasswordBytes(groups = 3, size = 4): number {
  return groups * size;
}

/**
 * Whether this operator may issue and withdraw other operators' IDs.
 *
 * A separate question from "may they work the desk", and the reason the two are not one field:
 * an operator who can create operators can quietly give themselves a second account, and every
 * audit trail after that is worth nothing.
 */
export function mayManageOperators(state: { isAdministrator: boolean; disabledAt: Date | null }): boolean {
  return state.isAdministrator && state.disabledAt === null;
}
