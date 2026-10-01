/** Deliberately inactive until both store releases and real native classrooms are verified. */
export const MOBILE_APP_ROLLOUT = {
  requireAppOnPhones: false,
  iosPublishedAndClassroomVerified: false,
  androidPublishedAndClassroomVerified: false,
  appStoreUrl: null,
  playStoreUrl: null,
} as const;

export interface MobileAppRollout {
  requireAppOnPhones: boolean;
  iosPublishedAndClassroomVerified: boolean;
  androidPublishedAndClassroomVerified: boolean;
  appStoreUrl: string | null;
  playStoreUrl: string | null;
}

function officialStoreUrl(value: string | null, host: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === host && !url.username && !url.password
      && (host === "apps.apple.com" ? /\/id\d+(?:\/|$)/.test(url.pathname) : url.pathname === "/store/apps/details" && !!url.searchParams.get("id"));
  } catch { return false; }
}

/** An app-first prompt is a launch experience, not an authorization or anti-fraud control. */
export function mobileAppExperience(input: {
  platform: "web" | "ios" | "android";
  phoneBrowser: boolean;
  surface: "participant" | "public" | "support" | "verification" | "payment_callback" | "operator";
}, rollout: MobileAppRollout = MOBILE_APP_ROLLOUT): "native" | "browser" | "require_app" {
  if (input.platform !== "web") return "native";
  if (!input.phoneBrowser || input.surface !== "participant") return "browser";
  if (!rollout.requireAppOnPhones || !rollout.iosPublishedAndClassroomVerified || !rollout.androidPublishedAndClassroomVerified) return "browser";
  if (!officialStoreUrl(rollout.appStoreUrl, "apps.apple.com") || !officialStoreUrl(rollout.playStoreUrl, "play.google.com")) return "browser";
  return "require_app";
}
