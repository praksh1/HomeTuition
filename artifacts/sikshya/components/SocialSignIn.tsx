import { Feather } from "@expo/vector-icons";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Facebook from "expo-auth-session/providers/facebook";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useState } from "react";
import { Platform, Text, TouchableOpacity, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { HIT_SLOP_MIN } from "@/constants/layout";
import { apiGet, apiPost } from "@/utils/api";
import { notify } from "@/utils/alerts";

WebBrowser.maybeCompleteAuthSession();

type Provider = "google" | "facebook" | "apple";
type Config = {
  google: { enabled: boolean; webClientId: string | null; iosClientId: string | null; androidClientId: string | null };
  facebook: { enabled: boolean; appId: string | null };
  apple: { enabled: boolean };
};

export function SocialSignIn({ mode = "login", onSignedIn }: { mode?: "login" | "link"; onSignedIn?: () => void }) {
  const { user } = useAuth();
  const { space } = useLayout();
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => { void apiGet<Config>("/auth/providers").then(setConfig).catch(() => setConfig(null)); }, []);
  const isAvailable = (provider: Provider) => mode === "login" || !user?.authProviders.includes(provider);
  if (!config || (
    (!config.google.enabled || !isAvailable("google"))
    && (!config.facebook.enabled || !isAvailable("facebook"))
    && (!config.apple.enabled || !isAvailable("apple"))
  )) return null;
  return <View style={{ gap: space.xs }}>
    {config.google.enabled && isAvailable("google") && <GoogleControl config={config.google} mode={mode} onDone={onSignedIn} />}
    {config.facebook.enabled && config.facebook.appId && isAvailable("facebook") && <FacebookControl appId={config.facebook.appId} mode={mode} onDone={onSignedIn} />}
    {config.apple.enabled && Platform.OS === "ios" && isAvailable("apple") && <AppleControl mode={mode} onDone={onSignedIn} />}
  </View>;
}

async function finish(mode: "login" | "link", provider: Provider, credential: string, auth: Pick<ReturnType<typeof useAuth>, "socialLogin" | "refreshUser">, onDone?: () => void) {
  if (mode === "link") {
    await apiPost("/auth/social/link", { provider, credential });
    await auth.refreshUser();
  }
  else await auth.socialLogin(provider, credential);
  notify(mode === "link" ? "Sign-in linked" : "Signed in", mode === "link" ? `You can now use ${provider} to sign in.` : "Welcome back to Sikshya.");
  onDone?.();
}

function GoogleControl({ config, mode, onDone }: { config: Config["google"]; mode: "login" | "link"; onDone?: () => void }) {
  const auth = useAuth();
  const colors = useColors(); const { t, radius, space } = useLayout();
  const [request, response, prompt] = Google.useAuthRequest({ webClientId: config.webClientId ?? undefined, iosClientId: config.iosClientId ?? undefined, androidClientId: config.androidClientId ?? undefined });
  useEffect(() => {
    const credential = response?.type === "success" ? response.authentication?.idToken ?? response.params.id_token : null;
    if (credential) void finish(mode, "google", credential, auth, onDone).catch((e) => notify("Google sign-in failed", e instanceof Error ? e.message : "Please try again."));
  }, [response]);
  return <TouchableOpacity disabled={!request} onPress={() => void prompt()} style={{ minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.card }}><Feather name="chrome" size={t.title3.fontSize} color={colors.foreground} /><Text style={[t.bodyStrong, { color: colors.foreground }]}>{mode === "link" ? "Link Google" : "Continue with Google"}</Text></TouchableOpacity>;
}

function FacebookControl({ appId, mode, onDone }: { appId: string; mode: "login" | "link"; onDone?: () => void }) {
  const auth = useAuth(); const colors = useColors(); const { t, radius, space } = useLayout();
  const [request, response, prompt] = Facebook.useAuthRequest({ clientId: appId });
  useEffect(() => {
    const credential = response?.type === "success" ? response.authentication?.accessToken ?? response.params.access_token : null;
    if (credential) void finish(mode, "facebook", credential, auth, onDone).catch((e) => notify("Facebook sign-in failed", e instanceof Error ? e.message : "Please try again."));
  }, [response]);
  return <TouchableOpacity disabled={!request} onPress={() => void prompt()} style={{ minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.card }}><Feather name="facebook" size={t.title3.fontSize} color={colors.foreground} /><Text style={[t.bodyStrong, { color: colors.foreground }]}>{mode === "link" ? "Link Facebook" : "Continue with Facebook"}</Text></TouchableOpacity>;
}

function AppleControl({ mode, onDone }: { mode: "login" | "link"; onDone?: () => void }) {
  const auth = useAuth();
  const { radius, space } = useLayout();
  const act = async () => {
    try {
      const result = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL] });
      if (!result.identityToken) throw new Error("Apple did not return an identity token.");
      await finish(mode, "apple", result.identityToken, auth, onDone);
    } catch (e) {
      if ((e as { code?: string }).code !== "ERR_REQUEST_CANCELED") notify("Apple sign-in failed", e instanceof Error ? e.message : "Please try again.");
    }
  };
  return <AppleAuthentication.AppleAuthenticationButton buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE} buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK} cornerRadius={radius.sm} style={{ width: "100%", height: space.huge }} onPress={() => void act()} />;
}
