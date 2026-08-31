import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPatch, apiPost } from "@/utils/api";
import { notify } from "@/utils/alerts";
import { uploadFile, type UploadableFile } from "@/utils/uploadFile";

type District = { name: string; localLevels: string[] };
type Province = { name: string; districts: District[] };
type Facility = { name: string; nepaliName: string | null; type: string | null; localLevel: string };

const NOT_SPECIFIED = "Not specified";

export default function Onboarding() {
  const { user, refreshUser } = useAuth();
  const colors = useColors();
  const { t, gutter, space, radius } = useLayout();
  const insets = useSafeAreaInsets();
  const isTeacher = user?.role === "teacher";
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [phone, setPhone] = useState("");
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [localLevel, setLocalLevel] = useState("");
  const [locality, setLocality] = useState("");
  const [affiliationStatus, setAffiliationStatus] = useState<"affiliated" | "independent" | "not_specified">("affiliated");
  const [institutionName, setInstitutionName] = useState("");
  const [schoolQuery, setSchoolQuery] = useState("");
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [photo, setPhoto] = useState<UploadableFile | null>(null);
  const [photoUploaded, setPhotoUploaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void Promise.all([
      apiGet<{ provinces: Province[] }>("/locations/nepal"),
      apiGet<{ onboarding: Record<string, string | null> | null }>("/onboarding/me"),
    ]).then(([locations, current]) => {
      setProvinces(locations.provinces ?? []);
      const row = current.onboarding;
      if (!row) return;
      setPhone(row.phone ?? "");
      setProvince(row.province ?? "");
      setDistrict(row.district ?? "");
      setLocalLevel(row.localLevel ?? "");
      setLocality(row.locality ?? "");
      setInstitutionName(row.institutionName ?? "");
      if (row.affiliationStatus === "independent" || row.affiliationStatus === "not_specified") setAffiliationStatus(row.affiliationStatus);
      setPhotoUploaded(Boolean(row.profilePhotoKey));
    }).catch(() => notify("Could not load locations", "Check your connection and try again."));
  }, []);

  const districts = useMemo(() => provinces.find((item) => item.name === province)?.districts ?? [], [provinces, province]);
  const localLevels = useMemo(() => districts.find((item) => item.name === district)?.localLevels ?? [], [districts, district]);

  const searchSchools = async () => {
    if (schoolQuery.trim().length < 2 || !province || !district || province === NOT_SPECIFIED) return;
    try {
      const result = await apiGet<{ facilities: Facility[] }>(
        `/locations/nepal/facilities?province=${encodeURIComponent(province)}&district=${encodeURIComponent(district)}` +
        `&localLevel=${encodeURIComponent(localLevel)}&q=${encodeURIComponent(schoolQuery.trim())}`,
      );
      setFacilities(result.facilities ?? []);
    } catch (error) {
      notify("Search unavailable", error instanceof Error ? error.message : "Please type the institution name instead.");
    }
  };

  const choosePhoto = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setPhoto({ uri: asset.uri, name: asset.name ?? "profile-photo", mimeType: asset.mimeType ?? "image/jpeg", size: asset.size ?? 0 });
  };

  const uploadPhoto = async () => {
    if (!photo) return;
    setSaving(true);
    try {
      const fileKey = await uploadFile(photo);
      await apiPost("/onboarding/me/profile-photo", { fileKey });
      setPhoto(null);
      setPhotoUploaded(true);
      notify("Photo uploaded", "Students will be able to recognise who is teaching them.");
    } catch (error) {
      notify("Photo not uploaded", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    if (isTeacher && !photoUploaded) { notify("Profile photo needed", "Upload a clear face photo before finishing."); return; }
    setSaving(true);
    try {
      await apiPatch("/onboarding/me", {
        phone,
        province,
        district,
        localLevel,
        locality,
        affiliationStatus,
        institutionName,
      });
      await refreshUser();
      router.replace("/");
    } catch (error) {
      notify("Please check the form", error instanceof Error ? error.message : "Your details could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  if (!user || user.role === "admin") return null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.huge, gap: space.lg }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: space.xs }}>
        <Text style={[t.title1, { color: colors.foreground }]}>Complete your profile</Text>
        <Text style={[t.body, { color: colors.mutedForeground }]}>{isTeacher ? "These details help students trust who they are booking. Your phone and documents are never shown publicly." : "Your teacher sees the student's display name. Guardian and phone details stay private."}</Text>
      </View>

      <Field label="Phone number *" value={phone} onChange={setPhone} placeholder="+977…" colors={colors} t={t} radius={radius} space={space} keyboardType="phone-pad" />
      <Text style={[t.caption, { color: colors.mutedForeground }]}>Sikshya may use this for login, class, and other important SMS notifications.</Text>

      <Choice label="Province *" value={province} options={[...provinces.map((item) => item.name), NOT_SPECIFIED]} onChoose={(value: string) => { setProvince(value); setDistrict(""); setLocalLevel(""); }} colors={colors} t={t} radius={radius} space={space} />
      {province === NOT_SPECIFIED ? (
        <>
          <Field label="District or area *" value={district} onChange={setDistrict} placeholder="Type district or area" colors={colors} t={t} radius={radius} space={space} />
          <Field label="Municipality / local level *" value={localLevel} onChange={setLocalLevel} placeholder="Type municipality or local level" colors={colors} t={t} radius={radius} space={space} />
        </>
      ) : (
        <>
          <Choice label="District *" value={district} options={districts.map((item) => item.name)} onChoose={(value: string) => { setDistrict(value); setLocalLevel(""); }} colors={colors} t={t} radius={radius} space={space} />
          <Choice label="Metropolitan / Municipality / Local level *" value={localLevel} options={localLevels} onChoose={setLocalLevel} colors={colors} t={t} radius={radius} space={space} />
        </>
      )}
      <Field label="Town, city, or locality" value={locality} onChange={setLocality} placeholder="Optional local area" colors={colors} t={t} radius={radius} space={space} />

      <View style={{ gap: space.sm }}>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>{isTeacher ? "School affiliation *" : "School or college *"}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
          <Chip label="Affiliated" active={affiliationStatus === "affiliated"} onPress={() => setAffiliationStatus("affiliated")} colors={colors} t={t} radius={radius} space={space} />
          {isTeacher && <Chip label="Independent teacher" active={affiliationStatus === "independent"} onPress={() => { setAffiliationStatus("independent"); setInstitutionName(""); }} colors={colors} t={t} radius={radius} space={space} />}
          <Chip label="Not specified" active={affiliationStatus === "not_specified"} onPress={() => setAffiliationStatus("not_specified")} colors={colors} t={t} radius={radius} space={space} />
        </View>
      </View>

      {affiliationStatus !== "independent" && (
        <View style={{ gap: space.sm }}>
          {affiliationStatus === "affiliated" && province !== NOT_SPECIFIED && (
            <View style={{ flexDirection: "row", gap: space.xs }}>
              <View style={{ flex: 1 }}><Field label="Find institution" value={schoolQuery} onChange={setSchoolQuery} placeholder="Type at least 2 letters" colors={colors} t={t} radius={radius} space={space} /></View>
              <TouchableOpacity onPress={() => void searchSchools()} activeOpacity={0.8} style={{ alignSelf: "flex-end", minHeight: 48, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.sm, backgroundColor: colors.primary }}><Feather name="search" size={18} color={colors.primaryForeground} /></TouchableOpacity>
            </View>
          )}
          {facilities.map((facility) => (
            <TouchableOpacity key={`${facility.localLevel}-${facility.name}`} onPress={() => { setInstitutionName(facility.name); setFacilities([]); setSchoolQuery(""); }} activeOpacity={0.75} style={{ padding: space.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.card }}>
              <Text style={[t.bodyStrong, { color: colors.foreground }]}>{facility.name}</Text>
              {!!facility.nepaliName && <Text style={[t.caption, { color: colors.mutedForeground }]}>{facility.nepaliName}</Text>}
            </TouchableOpacity>
          ))}
          <Field label={affiliationStatus === "not_specified" ? "Type the school or college name *" : "Selected institution *"} value={institutionName} onChange={setInstitutionName} placeholder="Institution name" colors={colors} t={t} radius={radius} space={space} />
        </View>
      )}

      {isTeacher && (
        <View style={{ padding: space.md, gap: space.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card }}>
          <Text style={[t.bodyStrong, { color: colors.foreground }]}>Clear face profile photo *</Text>
          <Text style={[t.caption, { color: colors.mutedForeground }]}>Use a professional, LinkedIn-style photo. Students should know who they will meet before booking.</Text>
          <TouchableOpacity onPress={() => void choosePhoto()} activeOpacity={0.75} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm }}>
            <Text style={[t.body, { color: colors.primary }]} numberOfLines={1}>{photo ? photo.name : photoUploaded ? "Photo uploaded — choose a replacement" : "Select photo"}</Text>
          </TouchableOpacity>
          {photo && <TouchableOpacity onPress={() => void uploadPhoto()} disabled={saving} activeOpacity={0.85} style={{ minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}><Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Upload selected photo</Text></TouchableOpacity>}
        </View>
      )}

      <TouchableOpacity onPress={() => void finish()} disabled={saving} activeOpacity={0.85} style={{ minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}>
        {saving ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Save and continue</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({ label, value, onChange, placeholder, colors, t, radius, space, keyboardType = "default" }: any) {
  return <View style={{ gap: space.xs }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>{label}</Text><TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.inkFaint} keyboardType={keyboardType} autoCapitalize="words" style={[t.body, { minHeight: 48, paddingHorizontal: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, color: colors.foreground, backgroundColor: colors.card }]} /></View>;
}

function Choice({ label, value, options, onChoose, colors, t, radius, space }: any) {
  const [open, setOpen] = useState(false);
  return <View style={{ gap: space.xs }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>{label}</Text><TouchableOpacity onPress={() => setOpen((current) => !current)} activeOpacity={0.75} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.card }}><Text style={[t.body, { color: value ? colors.foreground : colors.inkFaint }]}>{value || "Choose"}</Text><Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} /></TouchableOpacity>{open && <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.card, overflow: "hidden" }}>{options.map((option: string) => <TouchableOpacity key={option} onPress={() => { onChoose(option); setOpen(false); }} style={{ padding: space.sm }}><Text style={[t.body, { color: colors.foreground }]}>{option}</Text></TouchableOpacity>)}</View>}</View>;
}

function Chip({ label, active, onPress, colors, t, radius, space }: any) {
  return <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={{ paddingHorizontal: space.md, paddingVertical: space.xs, borderWidth: 1, borderColor: active ? colors.primary : colors.border, borderRadius: radius.pill, backgroundColor: active ? colors.actionSoft : colors.card }}><Text style={[t.caption, { color: active ? colors.primary : colors.mutedForeground }]}>{label}</Text></TouchableOpacity>;
}
