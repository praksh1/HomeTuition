import { createRemoteJWKSet, jwtVerify } from "jose";

export type SocialProvider = "google" | "facebook" | "apple";
export type VerifiedSocialIdentity = { provider: SocialProvider; subject: string; email: string | null; name: string | null };

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

function configuredAudiences(name: string): string[] {
  return String(process.env[name] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

export function socialProviderConfiguration() {
  const googleAudiences = [...configuredAudiences("GOOGLE_CLIENT_IDS"), ...configuredAudiences("GOOGLE_WEB_CLIENT_ID"), ...configuredAudiences("GOOGLE_IOS_CLIENT_ID"), ...configuredAudiences("GOOGLE_ANDROID_CLIENT_ID")];
  return {
    google: {
      enabled: googleAudiences.length > 0,
      webClientId: process.env.GOOGLE_WEB_CLIENT_ID ?? null,
      iosClientId: process.env.GOOGLE_IOS_CLIENT_ID ?? null,
      androidClientId: process.env.GOOGLE_ANDROID_CLIENT_ID ?? null,
    },
    facebook: { enabled: Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET), appId: process.env.FACEBOOK_APP_ID ?? null },
    apple: { enabled: configuredAudiences("APPLE_CLIENT_IDS").length > 0 },
  };
}

export async function verifySocialCredential(provider: SocialProvider, credential: string): Promise<VerifiedSocialIdentity | null> {
  if (provider === "google") {
    const audiences = [...configuredAudiences("GOOGLE_CLIENT_IDS"), ...configuredAudiences("GOOGLE_WEB_CLIENT_ID"), ...configuredAudiences("GOOGLE_IOS_CLIENT_ID"), ...configuredAudiences("GOOGLE_ANDROID_CLIENT_ID")];
    if (!audiences.length) return null;
    const { payload } = await jwtVerify(credential, googleKeys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"], audience: audiences,
    });
    if (!payload.sub || payload.email_verified !== true) return null;
    return { provider, subject: payload.sub, email: typeof payload.email === "string" ? payload.email.toLowerCase() : null, name: typeof payload.name === "string" ? payload.name : null };
  }
  if (provider === "apple") {
    const audiences = configuredAudiences("APPLE_CLIENT_IDS");
    if (!audiences.length) return null;
    const { payload } = await jwtVerify(credential, appleKeys, { issuer: "https://appleid.apple.com", audience: audiences });
    if (!payload.sub) return null;
    return { provider, subject: payload.sub, email: typeof payload.email === "string" ? payload.email.toLowerCase() : null, name: null };
  }

  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return null;
  const debug = await fetch(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(credential)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`);
  if (!debug.ok) return null;
  const checked = await debug.json() as { data?: { is_valid?: boolean; app_id?: string; user_id?: string } };
  if (!checked.data?.is_valid || checked.data.app_id !== appId || !checked.data.user_id) return null;
  const profile = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(credential)}`);
  if (!profile.ok) return null;
  const person = await profile.json() as { id?: string; name?: string; email?: string };
  if (!person.id || person.id !== checked.data.user_id) return null;
  return { provider, subject: person.id, email: person.email?.toLowerCase() ?? null, name: person.name ?? null };
}
