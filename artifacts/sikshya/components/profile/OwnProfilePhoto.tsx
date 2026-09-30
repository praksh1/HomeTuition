import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProfilePhoto } from "@/components/profile/ProfilePhoto";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPost } from "@/utils/api";
import { prepareProfilePhoto } from "@/utils/profilePhotoUpload";
import { uploadFile, type UploadableFile } from "@/utils/uploadFile";

/** Changing a photo is its own operation, not a submission of unrelated account fields. */
export function OwnProfilePhoto({ avatarUrl, userId, initials }: {
  avatarUrl?: string; userId?: number; initials: string;
}) {
  const { refreshUser } = useAuth();
  const colors = useColors();
  const { t, space, radius, elevation } = useLayout();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(avatarUrl);
  const [selected, setSelected] = useState<UploadableFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState(false);
  const operation = useRef(false);
  const viewGeneration = useRef(0);
  useEffect(() => { setUrl(avatarUrl); }, [avatarUrl]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const generation = ++viewGeneration.current;
    // An avatar may have been open longer than its signed URL's lifetime.
    void apiGet<{ url: string }>("/onboarding/me/profile-photo/view")
      .then((answer) => { if (active && generation === viewGeneration.current && answer.url) setUrl(answer.url); })
      .catch(() => { /* Initials and the existing preview remain available. */ });
    return () => { active = false; viewGeneration.current++; };
  }, [open]);

  const close = () => {
    if (operation.current) return;
    viewGeneration.current++;
    setOpen(false); setSelected(null); setProblem(""); setSaved(false);
  };
  const choose = async () => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"], copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setSelected({ uri: asset.uri, name: asset.name ?? "profile-photo", mimeType: asset.mimeType ?? "image/jpeg", size: asset.size ?? 0 });
      setProblem(""); setSaved(false);
    } catch {
      setProblem("Could not open your photos. Please try again.");
    } finally { operation.current = false; setBusy(false); }
  };
  const save = async () => {
    if (!selected || operation.current) return;
    viewGeneration.current++;
    operation.current = true; setBusy(true); setProblem("");
    try {
      const prepared = await prepareProfilePhoto(selected);
      try {
        const fileKey = await uploadFile(prepared.file);
        await apiPost("/onboarding/me/profile-photo", { fileKey });
      } finally { prepared.release(); }
      // Persisted already: a failed follow-up read must never be called an upload failure.
      setSelected(null); setSaved(true);
      setUrl(selected.uri);
      try { const answer = await apiGet<{ url: string }>("/onboarding/me/profile-photo/view"); setUrl(answer.url); } catch { /* Keep the local preview until the next account refresh. */ }
      try { await refreshUser(); } catch { /* Do not invite a duplicate upload. */ }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Your photo could not be saved. Please try again.");
    } finally { operation.current = false; setBusy(false); }
  };
  const diameter = space.huge + space.xxl;
  return <>
    <TouchableOpacity testID="profile-photo-manage" accessibilityRole="button" accessibilityLabel="View or change your profile photo"
      onPress={() => { setOpen(true); setProblem(""); setSaved(false); }} activeOpacity={0.8}
      style={{ width: diameter, height: diameter, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.onInverseMuted, padding: space.xxs }}>
      <View style={{ flex: 1, borderRadius: radius.pill, overflow: "hidden", backgroundColor: colors.card, alignItems: "center", justifyContent: "center" }}>
        <Text style={[t.title2, { color: colors.secondary }]}>{initials}</Text>
        <ProfilePhoto uri={url} userId={userId} self />
      </View>
      <View style={{ position: "absolute", right: 0, bottom: 0, width: 24, height: 24, borderRadius: radius.pill, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }}>
        <Feather name="camera" size={14} color={colors.primary} />
      </View>
    </TouchableOpacity>
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "center", alignItems: "center", padding: space.md, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.md }}>
        <View testID="profile-photo-dialog" accessibilityViewIsModal style={[{ width: "100%", maxWidth: 440, maxHeight: "100%", borderRadius: radius.lg, backgroundColor: colors.card, overflow: "hidden" }, elevation.modal]}>
          <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text accessibilityRole="header" style={[t.title2, { flex: 1, color: colors.foreground }]}>Profile photo</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close profile photo" disabled={busy} accessibilityState={{ disabled: busy }} aria-disabled={busy} onPress={close} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            <View testID="profile-photo-preview" style={{ width: "100%", aspectRatio: 1, maxWidth: 264, alignSelf: "center", borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceSunk, alignItems: "center", justifyContent: "center" }}>
              <Text style={[t.display, { color: colors.primary }]}>{initials}</Text>
              {selected?.uri || url ? <Image accessibilityLabel={selected ? "Selected profile photo preview" : "Your current profile photo"} source={{ uri: selected?.uri ?? url }} resizeMode="contain" style={{ position: "absolute", width: "100%", height: "100%" }} /> : null}
            </View>
            <Text style={[t.callout, { color: colors.mutedForeground }]}>Use a clear photo so people in your classes can recognise you. Your citizenship document stays private—do not use it here.</Text>
            {problem ? <Text accessibilityRole="alert" style={[t.callout, { color: colors.destructive }]}>{problem}</Text> : null}
            {saved ? <Text accessibilityLiveRegion="polite" style={[t.callout, { color: colors.success }]}>Your profile photo has been updated.</Text> : null}
            <TouchableOpacity testID="profile-photo-choose" accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy, busy }} aria-disabled={busy} onPress={() => void choose()} style={{ minHeight: 48, padding: space.sm, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" }}>
              <Text style={[t.bodyStrong, { color: colors.primary }]}>{selected ? "Choose a different photo" : "Change photo"}</Text>
            </TouchableOpacity>
            {selected ? <TouchableOpacity testID="profile-photo-save" accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy, busy }} aria-disabled={busy} onPress={() => void save()} style={{ minHeight: 48, padding: space.sm, backgroundColor: colors.primary, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" }}>
              {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Save photo</Text>}
            </TouchableOpacity> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}
