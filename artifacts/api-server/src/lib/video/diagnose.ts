/**
 * Whether the video provider's credentials actually work — as data, not as printed text.
 *
 * ## Why this is a module and not just the script
 *
 * The owner develops on Windows and does not read code. Every time this project has handed them
 * a command to run, something environmental has broken it: the wrong branch, then `&&` pasted
 * into PowerShell where it is not a statement separator. Two failures that had nothing to do
 * with the thing being checked.
 *
 * So the same checks have to be reachable from a **web page** — the support desk, in a browser,
 * where there is no shell to get wrong. That means the logic lives here and both surfaces call
 * it: `scripts/livekit-check.mjs` for anyone who does want a terminal, and
 * `GET /admin/video/check` for the owner. Two copies of a diagnostic would eventually disagree,
 * and a diagnostic that disagrees with itself is worse than none.
 *
 * The one thing that legitimately differs between them is *where* to go and fix what is wrong —
 * Railway for the deployed server, a `.env` file for a checkout. That is `WHERE`, passed in.
 * Handing over the route rather than the destination is a rule this project has already paid to
 * learn, and "change it to wss://" without saying where to change it is a destination.
 *
 * ## Nothing here returns a secret
 *
 * Every finding is a sentence and a verdict. `LIVEKIT_API_SECRET` is reported only as a length,
 * because "you pasted 12 characters" is the actual failure people hit and the value itself must
 * never travel to a browser, a log or a screenshot. The same reasoning as the CLI, which prints
 * a length for exactly the same reason.
 */

export type Verdict = "ok" | "wrong" | "unknown";

export interface Finding {
  /** Stable, so a screen can style or group by it without matching on English. */
  id: string;
  verdict: Verdict;
  /** What is true, in a sentence somebody non-technical can act on. */
  title: string;
  /** What to do about it. Absent when there is nothing to do. */
  fix?: string;
}

export interface VideoDiagnosis {
  /** What video is actually set to right now — "daily" when the variable is unset. */
  provider: string;
  /** True only when every finding is `ok` — the one thing a screen needs to colour the header. */
  healthy: boolean;
  /** The single line that goes at the top of the screen. Written, not inferred from `healthy`. */
  summary: string;
  findings: Finding[];
}

export interface Env {
  VIDEO_PROVIDER?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
  LIVEKIT_URL?: string;
}

/**
 * Where the person reading this would go to change a setting.
 *
 * The checks are identical on both surfaces but the remedy is not, and this project's rule is
 * to hand over the route rather than the destination. Telling somebody looking at the live
 * site to edit a file on their laptop is as useless as telling somebody at their laptop to
 * open Railway; both read as instructions and neither one works.
 */
export const WHERE = {
  /** The deployed server, which is what the support-desk page is looking at. */
  deployed: "in Railway → your api-server service → Variables",
  /** A checkout on somebody's own machine, which is what the script is looking at. */
  local: "in the .env file at the top level of the project folder",
} as const;

export type Where = (typeof WHERE)[keyof typeof WHERE];

/**
 * The settings half. Pure — no network, no clock, no filesystem — so it is unit-testable and so
 * the route can answer instantly when the answer is already obvious.
 */
export function inspectSettings(env: Env, where: Where = WHERE.deployed): Finding[] {
  const key = env.LIVEKIT_API_KEY?.trim();
  const secret = env.LIVEKIT_API_SECRET?.trim();
  const url = env.LIVEKIT_URL?.trim();
  const out: Finding[] = [];

  out.push(
    key
      ? { id: "key", verdict: "ok", title: `API key is set (${key.slice(0, 6)}…, ${key.length} characters).` }
      : {
          id: "key",
          verdict: "wrong",
          title: "LIVEKIT_API_KEY is missing or empty.",
          fix: `Add it ${where}.`,
        },
  );

  /*
    A length, never the value.

    This is read in a browser and screenshotted when something is wrong, which is precisely when
    a signing key must not be on screen. The length is enough to tell an empty box from a paste
    that was cut off, which is the failure people actually hit.
  */
  if (!secret) {
    out.push({
      id: "secret",
      verdict: "wrong",
      title: "LIVEKIT_API_SECRET is missing or empty.",
      fix: `Add it ${where}, on its own line. Never paste it into a chat or a screenshot.`,
    });
  } else if (secret.length < 20) {
    out.push({
      id: "secret",
      verdict: "wrong",
      title: `LIVEKIT_API_SECRET is only ${secret.length} characters, which is too short to be a real one.`,
      fix: `It was probably cut off when pasted. Copy it again from the LiveKit dashboard and replace it ${where}.`,
    });
  } else {
    out.push({ id: "secret", verdict: "ok", title: `API secret is set (${secret.length} characters, not shown).` });
  }

  if (!url) {
    out.push({
      id: "url",
      verdict: "wrong",
      title: "LIVEKIT_URL is missing or empty.",
      fix: `Add it ${where}. It looks like wss://your-project.livekit.cloud`,
    });
  } else if (!url.startsWith("wss://")) {
    out.push({
      id: "url",
      verdict: "wrong",
      title: `LIVEKIT_URL is "${url}", which does not start with wss://`,
      fix: url.startsWith("https://")
        ? `Change it ${where} to wss://${url.slice("https://".length)}`
        : `It must look like wss://your-project.livekit.cloud. Change it ${where}.`,
    });
  } else {
    out.push({ id: "url", verdict: "ok", title: `Server address is ${url}` });
  }

  return out;
}

/** True when the settings are complete enough that asking LiveKit is worth doing. */
export function settingsUsable(findings: Finding[]): boolean {
  return findings.every((f) => f.verdict === "ok");
}

/**
 * Turn whatever LiveKit or the network threw into one finding a person can act on.
 *
 * The distinction that matters is refused-versus-unreachable. A blocked corporate proxy answers
 * on LiveKit's behalf, and calling that a credentials problem sends somebody to regenerate a key
 * that was fine — which this repository's own build environment does, and is how the case was
 * found.
 */
export function describeReachFailure(message: string, where: Where = WHERE.deployed): Finding {
  if (/401|unauthor|invalid/i.test(message)) {
    return {
      id: "reach",
      verdict: "wrong",
      title: "LiveKit refused the key and secret.",
      fix:
        "They are well-formed but wrong, or they belong to a different project. Create a fresh key " +
        `in the LiveKit dashboard and replace all three values ${where} — the address too, since a ` +
        "key only works with its own project.",
    };
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
    return {
      id: "reach",
      verdict: "wrong",
      title: "That server address could not be found.",
      fix: `Check the project name in LIVEKIT_URL ${where} against the LiveKit dashboard.`,
    };
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENETUNREACH|fetch failed|allowlist|egress|proxy|\b40[37]\b/i.test(message)) {
    return {
      id: "reach",
      verdict: "unknown",
      title: "The settings look right, but this server cannot reach livekit.cloud.",
      fix: "A firewall or network policy is blocking it. The two checks above still passed.",
    };
  }
  return {
    id: "reach",
    verdict: "wrong",
    title: `LiveKit answered with something unexpected: ${message}`,
    fix: "Worth reporting with this line — but remove nothing and add no secret to it.",
  };
}

/**
 * Which provider is carrying video right now, said the same way `selectProvider` decides it:
 * an empty or unset variable means Daily.
 */
function providerName(env: Env): string {
  return (env.VIDEO_PROVIDER ?? "").trim().toLowerCase() || "daily";
}

/**
 * The provider's name as a person writes it, not as the variable stores it.
 *
 * `VIDEO_PROVIDER` holds `daily` and `livekit` because that is what the code matches on. A
 * sentence that reads "video is still on daily" looks like a typo to the person it is written
 * for, and every other line on this screen is in plain English.
 */
function providerLabel(provider: string): string {
  if (provider === "daily") return "Daily";
  if (provider === "livekit") return "LiveKit";
  return provider;
}

/**
 * Can this key and secret actually sign a join token?
 *
 * Separate from asking LiveKit, and worth keeping separate, because the two fail for opposite
 * reasons. Signing fails when the values are malformed — a key with a newline in it from a bad
 * paste. LiveKit refusing means they are well-formed and simply not this project's. Collapsing
 * the two sends somebody to regenerate a key over a stray character they could have deleted.
 */
async function signCheck(
  key: string,
  secret: string,
  where: Where,
  AccessToken: new (k: string, s: string, o: object) => { addGrant(g: object): void; toJwt(): Promise<string> },
): Promise<Finding> {
  try {
    const token = new AccessToken(key, secret, { identity: "preflight", ttl: 60 });
    token.addGrant({ roomJoin: true, room: "sikshya0" });
    const jwt = await token.toJwt();
    const [, payload] = jwt.split(".");
    const claims = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    if (claims?.video?.room === "sikshya0") {
      return { id: "sign", verdict: "ok", title: "A join token can be signed with that key and secret." };
    }
    return {
      id: "sign",
      verdict: "wrong",
      title: "A token was produced but does not carry the room it should.",
      fix: "This is a bug in the app, not in your settings. Report it.",
    };
  } catch (err) {
    return {
      id: "sign",
      verdict: "wrong",
      title: `A join token could not be signed: ${err instanceof Error ? err.message : String(err)}`,
      fix: `The key or secret is malformed — copy both again from the LiveKit dashboard and replace them ${where}.`,
    };
  }
}

/**
 * The whole check, settings and network, as one call both surfaces make.
 *
 * The order is deliberate and each step gates the next. Asking LiveKit about credentials
 * already known to be wrong produces a second, vaguer error underneath the specific one, and
 * the reader is then holding two problems with no idea which caused which.
 *
 * The provider finding comes first and does not stop anything. Checking keys that are correct
 * but not yet switched on is the most useful thing this can do on the day somebody pastes
 * them in — "these are good, you just have not flipped the switch" is an answer, and refusing
 * to look until the switch is flipped would withhold it.
 */
export async function diagnoseVideo(env: Env, where: Where = WHERE.deployed): Promise<VideoDiagnosis> {
  const provider = providerName(env);
  const findings: Finding[] = [];

  if (provider === "livekit") {
    findings.push({ id: "provider", verdict: "ok", title: "Video is set to LiveKit for browsers." });
  } else {
    findings.push({
      id: "provider",
      verdict: "unknown",
      title: `Video is still on ${providerLabel(provider)}, so the LiveKit settings below are not in use yet.`,
      fix:
        `Set VIDEO_PROVIDER to "livekit" ${where}. ` +
        "Phones stay on Daily either way; the server decides per device.",
    });
  }

  const settings = inspectSettings(env, where);
  findings.push(...settings);

  const verdict = (): VideoDiagnosis => ({
    provider,
    healthy: findings.every((f) => f.verdict === "ok"),
    summary: summarize(provider, findings),
    findings,
  });

  if (!settingsUsable(settings)) return verdict();

  /*
    Loaded here rather than at the top of the file, for two independent reasons.

    This module is imported by `scripts/livekit-check.mjs`, which somebody runs precisely
    because nothing is working — quite possibly before `pnpm install` has been run on the
    branch. A static import would crash with a module-not-found stack trace before printing a
    single word of the answer they came for.

    And `inspectSettings` above must stay reachable under `--experimental-strip-types` with no
    dependency on the SDK being installed at all, which is what makes it unit-testable.
  */
  let AccessToken, RoomServiceClient;
  try {
    ({ AccessToken, RoomServiceClient } = await import("livekit-server-sdk"));
  } catch {
    findings.push({
      id: "sdk",
      verdict: "wrong",
      title: "The LiveKit library is not installed on this server.",
      fix: "Run pnpm install, then deploy again.",
    });
    return verdict();
  }

  findings.push(await signCheck(env.LIVEKIT_API_KEY!.trim(), env.LIVEKIT_API_SECRET!.trim(), where, AccessToken as never));

  // The REST API is https, on the same host as the wss address.
  const httpsHost = env
    .LIVEKIT_URL!.trim()
    .replace(/^wss:/, "https:")
    .replace(/^ws:/, "http:");

  try {
    const rooms = new RoomServiceClient(httpsHost, env.LIVEKIT_API_KEY!.trim(), env.LIVEKIT_API_SECRET!.trim());
    const list = await rooms.listRooms();
    findings.push({
      id: "reach",
      verdict: "ok",
      title: `LiveKit accepted the credentials. ${list.length} room(s) open right now.`,
    });
  } catch (err) {
    findings.push(describeReachFailure(String(err instanceof Error ? err.message : err), where));
  }

  return verdict();
}

/**
 * The headline: what to do next, in one sentence.
 *
 * Two rules, both learned from looking at the rendered screen rather than from a test.
 *
 * **It never repeats a finding word for word.** The first draft returned the first failing
 * finding's own title, so the same sentence appeared twice within four lines — as the red
 * headline and again in the list under it. On a phone that is a third of the card spent saying
 * one thing twice.
 *
 * **Not being switched on outranks not being reachable.** With both unknown, the first draft
 * led with "could not reach LiveKit" and buried "video is still on Daily" in the list. The
 * second is the one the reader has to act on; the first is this server admitting it could not
 * double-check. Ordering them the other way round hid the actionable fact behind the
 * informational one.
 */
function summarize(provider: string, findings: Finding[]): string {
  const wrong = findings.filter((f) => f.verdict === "wrong").length;
  if (wrong > 0) {
    return wrong === 1
      ? "Video calls will not start yet. One thing needs fixing — it is marked below, with where to change it."
      : `Video calls will not start yet. ${wrong} things need fixing — each is marked below, with where to change it.`;
  }

  const unknown = new Set(findings.filter((f) => f.verdict === "unknown").map((f) => f.id));
  // "Confirmed" only when LiveKit itself said so; "look right" when this server could not ask.
  const strength = unknown.has("reach") ? "look right" : "are confirmed";

  if (unknown.has("provider")) {
    return `The LiveKit settings ${strength}, but video is still on ${providerLabel(provider)}. The first line below says where to switch it over.`;
  }
  if (unknown.has("reach")) {
    return "Nothing is wrong with the settings. This server just could not open a connection to LiveKit to double-check them.";
  }
  return "Everything is set up. A browser joining a class will use LiveKit.";
}
