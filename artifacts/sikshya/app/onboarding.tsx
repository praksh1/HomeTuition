import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SearchableSelectionField } from "@/components/profile/SearchableSelectionField";
import { HIT_SLOP_MIN, readingWidth } from "@/constants/layout";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, apiPatch, apiPost } from "@/utils/api";
import {
  accountDetailsDraft,
  accountDetailsNeedConfirmation,
  firstAccountDetailsIssue,
  type AccountDetailsField,
  type AffiliationStatus,
} from "@/utils/accountDetailsForm";
import { notify } from "@/utils/alerts";
import { uploadFile, type UploadableFile } from "@/utils/uploadFile";

type District = { name: string; localLevels: string[] };
type Province = { name: string; districts: District[] };
type Facility = { name: string; nepaliName: string | null; type: string | null; localLevel: string };

export default function Onboarding() {
  const { user, refreshUser } = useAuth();
  const params = useLocalSearchParams<{ edit?: string }>();
  const colors = useColors();
  const { t, gutter, space, radius } = useLayout();
  const insets = useSafeAreaInsets();
  const isTeacher = user?.role === "teacher";
  const editing = params.edit === "1";
  const scrollRef = useRef<ScrollView>(null);
  const phoneRef = useRef<TextInput>(null);
  const phoneTouchedRef = useRef(false);
  const sectionY = useRef({ contact: 0, location: 0, affiliation: 0 });
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [phone, setPhone] = useState("");
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [localLevel, setLocalLevel] = useState("");
  const [manualLocalLevel, setManualLocalLevel] = useState(false);
  const [locality, setLocality] = useState("");
  const [affiliationStatus, setAffiliationStatus] = useState<AffiliationStatus>("unselected");
  const [institutionName, setInstitutionName] = useState("");
  const [schoolQuery, setSchoolQuery] = useState("");
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [photo, setPhoto] = useState<UploadableFile | null>(null);
  const [photoUploaded, setPhotoUploaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: AccountDetailsField; message: string } | null>(null);

  useEffect(() => {
    void Promise.all([
      apiGet<{ provinces: Province[] }>("/locations/nepal"),
      apiGet<{ onboarding: Record<string, string | null> | null }>("/onboarding/me"),
    ]).then(([locations, current]) => {
      setProvinces(locations.provinces ?? []);
      const row = current.onboarding;
      if (!row) return;
      setNeedsConfirmation(accountDetailsNeedConfirmation(row));
      const draft = accountDetailsDraft(row);
      setPhone(draft.phone);
      setProvince(draft.province);
      setDistrict(draft.district);
      setLocalLevel(draft.localLevel);
      const listed = locations.provinces
        ?.find((item) => item.name === row.province)
        ?.districts.find((item) => item.name === row.district)
        ?.localLevels.includes(row.localLevel ?? "") === true;
      setManualLocalLevel(Boolean(draft.localLevel) && !listed);
      setLocality(draft.locality);
      setInstitutionName(draft.institutionName);
      setAffiliationStatus(draft.affiliationStatus);
      setPhotoUploaded(Boolean(row.profilePhotoKey));
    }).catch(() => notify("Could not load locations", "Check your connection and try again."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || phoneTouchedRef.current || phone.trim()) return;
    const inheritedSelection = Boolean(province || district || localLevel || locality || institutionName || affiliationStatus !== "unselected");
    if (!inheritedSelection) return;
    // A restored blank contact beside legacy fixture/location values is not a completed account.
    // Clear only untouched initial state; once the person edits Phone, their address is preserved.
    setProvince("");
    setDistrict("");
    setLocalLevel("");
    setManualLocalLevel(false);
    setLocality("");
    setInstitutionName("");
    setAffiliationStatus("unselected");
  }, [affiliationStatus, district, institutionName, loading, localLevel, locality, phone, province]);

  const districts = useMemo(() => provinces.find((item) => item.name === province)?.districts ?? [], [provinces, province]);
  const localLevels = useMemo(() => districts.find((item) => item.name === district)?.localLevels ?? [], [districts, district]);

  const searchSchools = async () => {
    if (schoolQuery.trim().length < 2 || !province || !district) return;
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

  const clearError = (field: AccountDetailsField) => {
    setFieldError((current) => current?.field === field ? null : current);
  };

  const moveToIssue = (field: AccountDetailsField) => {
    const section = field === "phone" ? "contact" : field === "province" || field === "district" || field === "localLevel" ? "location" : "affiliation";
    scrollRef.current?.scrollTo({ y: Math.max(0, sectionY.current[section] - space.md), animated: true });
    if (field === "phone") setTimeout(() => phoneRef.current?.focus(), 180);
  };

  const finish = async () => {
    if (!editing && isTeacher && !photoUploaded) { notify("Profile photo needed", "Upload a clear face photo before finishing."); return; }
    const issue = firstAccountDetailsIssue({ phone, province, district, localLevel, locality, institutionName, affiliationStatus });
    if (issue) {
      setFieldError(issue);
      moveToIssue(issue.field);
      return;
    }
    setFieldError(null);
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
      if (editing) router.replace(isTeacher ? "/(teacher)/profile" : "/(student)/profile");
      else router.replace("/");
    } catch (error) {
      notify("Please check the form", error instanceof Error ? error.message : "Your details could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  if (!user || user.role === "admin") return null;

  return (
    <ScrollView ref={scrollRef} style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ width: "100%", maxWidth: readingWidth, alignSelf: "center", paddingHorizontal: gutter, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.huge, gap: space.lg }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: space.xs }}>
        {editing && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to profile" onPress={() => router.replace(isTeacher ? "/(teacher)/profile" : "/(student)/profile")} style={{ minHeight: HIT_SLOP_MIN, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: space.xs }}><Feather name="arrow-left" size={20} color={colors.primary} /><Text style={[t.bodyStrong, { color: colors.primary }]}>Profile</Text></TouchableOpacity>}
        <Text style={[t.title1, { color: colors.foreground }]}>{editing ? "Account details" : "Complete your profile"}</Text>
        <Text style={[t.body, { color: colors.mutedForeground }]}>{isTeacher ? "These details help students find and trust you. Your phone stays private." : "Your teacher sees the student's display name. School and phone details stay private."}</Text>
      </View>

      {!loading && needsConfirmation ? <View accessibilityRole="alert" testID="account-details-confirmation" style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warn, backgroundColor: colors.warnSoft }}>
        <Feather name="info" size={19} color={colors.warn} />
        <View style={{ flex: 1, gap: space.xxs }}>
          <Text style={[t.bodyStrong, { color: colors.foreground }]}>Please confirm your details</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>Fadko has left your location and school unselected instead of guessing them.</Text>
        </View>
      </View> : null}

      {loading ? <View accessibilityRole="progressbar" accessibilityLabel="Loading account details" style={{ minHeight: space.huge * 3, alignItems: "center", justifyContent: "center", gap: space.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card }}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[t.body, { color: colors.mutedForeground }]}>Preparing your account details…</Text>
      </View> : null}

      {!loading && <>
      <View onLayout={(event) => { sectionY.current.contact = event.nativeEvent.layout.y; }} style={{ gap: space.md, padding: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card }}>
        <SectionHeading icon="phone" title="Contact" detail="How Fadko can reach you about your account and classes" colors={colors} t={t} radius={radius} space={space} />
        <View style={{ gap: space.xs }}>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>Login email</Text>
        <View style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.muted }}>
          <Text style={[t.body, { color: colors.foreground }]}>{user.email}</Text>
        </View>
        <Text style={[t.caption, { color: colors.mutedForeground }]}>Your verified login email is protected. Contact Support if it needs to change.</Text>
        </View>

      <Field label="Phone number *" value={phone} onChange={(value: string) => { phoneTouchedRef.current = true; setPhone(value); clearError("phone"); }} placeholder="+977…" colors={colors} t={t} radius={radius} space={space} keyboardType="phone-pad" error={fieldError?.field === "phone" ? fieldError.message : undefined} inputRef={phoneRef} testID="account-phone" />
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.xs }}>
          <Feather name="lock" size={15} color={colors.mutedForeground} />
          <Text style={[t.caption, { flex: 1, color: colors.mutedForeground }]}>Your phone stays private. Fadko may use it for important login, class and account notices.</Text>
        </View>
      </View>

      <View onLayout={(event) => { sectionY.current.location = event.nativeEvent.layout.y; }} style={{ gap: space.md, padding: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card }}>
      <SectionHeading icon="map-pin" title="Location" detail="Select an official Nepal province and district" colors={colors} t={t} radius={radius} space={space} />
      <SearchableSelectionField label="Province *" value={province} options={provinces.map((item) => item.name)} placeholder="Choose province" searchPlaceholder="Search provinces" onChoose={(value: string) => { setProvince(value); setDistrict(""); setLocalLevel(""); setManualLocalLevel(false); clearError("province"); }} testID="account-province" error={fieldError?.field === "province" ? fieldError.message : undefined} />
      <SearchableSelectionField label="District *" value={district} options={districts.map((item) => item.name)} placeholder={province ? "Choose district" : "Choose province first"} searchPlaceholder="Search districts" disabled={!province} onChoose={(value: string) => { setDistrict(value); setLocalLevel(""); setManualLocalLevel(false); clearError("district"); }} testID="account-district" error={fieldError?.field === "district" ? fieldError.message : undefined} />
      {manualLocalLevel ? <>
        <Field label="Municipality / local level *" value={localLevel} onChange={(value: string) => { setLocalLevel(value); clearError("localLevel"); }} placeholder="Type the municipality or local level" colors={colors} t={t} radius={radius} space={space} error={fieldError?.field === "localLevel" ? fieldError.message : undefined} testID="account-local-level-manual" />
        {localLevels.length > 0 && <TouchableOpacity accessibilityRole="button" onPress={() => { setManualLocalLevel(false); setLocalLevel(""); }} style={{ minHeight: HIT_SLOP_MIN, justifyContent: "center" }}><Text style={[t.bodyStrong, { color: colors.primary }]}>Choose from the list instead</Text></TouchableOpacity>}
      </> : <>
        <SearchableSelectionField label="Metropolitan / Municipality / Local level *" value={localLevel} options={localLevels} placeholder={district ? "Choose municipality or local level" : "Choose district first"} searchPlaceholder="Search municipalities" disabled={!district} onChoose={(value: string) => { setLocalLevel(value); clearError("localLevel"); }} testID="account-local-level" error={fieldError?.field === "localLevel" ? fieldError.message : undefined} />
        {!!district && <TouchableOpacity accessibilityRole="button" onPress={() => { setManualLocalLevel(true); setLocalLevel(""); }} style={{ minHeight: HIT_SLOP_MIN, justifyContent: "center" }}><Text style={[t.bodyStrong, { color: colors.primary }]}>My municipality is not listed</Text></TouchableOpacity>}
      </>}
      <Field label="Town, city, or locality" value={locality} onChange={setLocality} placeholder="Optional local area" colors={colors} t={t} radius={radius} space={space} />
      </View>

      <View onLayout={(event) => { sectionY.current.affiliation = event.nativeEvent.layout.y; }} style={{ gap: space.md, padding: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card }}>
        <SectionHeading icon="book-open" title={isTeacher ? "Teaching affiliation" : "School or college"} detail={isTeacher ? "Choose a school or continue as an independent teacher" : "Add your school, college, or choose Not applicable"} colors={colors} t={t} radius={radius} space={space} />
        <View style={{ gap: space.sm }}>
        <Text style={[t.bodyStrong, { color: colors.foreground }]}>{isTeacher ? "School affiliation *" : "School or college *"}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
          <Chip label="Affiliated" active={affiliationStatus === "affiliated"} onPress={() => { setAffiliationStatus("affiliated"); clearError("affiliationStatus"); }} colors={colors} t={t} radius={radius} space={space} />
          <Chip label={isTeacher ? "Independent teacher" : "Not applicable"} active={affiliationStatus === "independent"} onPress={() => { setAffiliationStatus("independent"); setInstitutionName(""); clearError("affiliationStatus"); }} colors={colors} t={t} radius={radius} space={space} />
          <Chip label="School not listed" active={affiliationStatus === "not_specified"} onPress={() => { setAffiliationStatus("not_specified"); clearError("affiliationStatus"); }} colors={colors} t={t} radius={radius} space={space} />
        </View>
        {fieldError?.field === "affiliationStatus" ? <Text accessibilityRole="alert" style={[t.caption, { color: colors.destructive }]}>{fieldError.message}</Text> : null}
      </View>

      {(affiliationStatus === "affiliated" || affiliationStatus === "not_specified") && (
        <View style={{ gap: space.sm }}>
          {affiliationStatus === "affiliated" && (
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
          <Field label={affiliationStatus === "not_specified" ? "Type the school or college name *" : "Selected institution *"} value={institutionName} onChange={(value: string) => { setInstitutionName(value); clearError("institutionName"); }} placeholder="Institution name" colors={colors} t={t} radius={radius} space={space} error={fieldError?.field === "institutionName" ? fieldError.message : undefined} testID="account-institution" />
        </View>
      )}
      </View>

      {isTeacher && !editing && (
        <View style={{ padding: space.md, gap: space.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card }}>
          <Text style={[t.bodyStrong, { color: colors.foreground }]}>Clear face profile photo *</Text>
          <Text style={[t.caption, { color: colors.mutedForeground }]}>Use a professional, LinkedIn-style photo. Students should know who they will meet before booking.</Text>
          <TouchableOpacity onPress={() => void choosePhoto()} activeOpacity={0.75} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm }}>
            <Text style={[t.body, { color: colors.primary }]} numberOfLines={1}>{photo ? photo.name : photoUploaded ? "Photo uploaded — choose a replacement" : "Select photo"}</Text>
          </TouchableOpacity>
          {photo && <TouchableOpacity onPress={() => void uploadPhoto()} disabled={saving} activeOpacity={0.85} style={{ minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}><Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Upload selected photo</Text></TouchableOpacity>}
        </View>
      )}

      <TouchableOpacity accessibilityRole="button" testID="account-save" onPress={() => void finish()} disabled={saving} activeOpacity={0.85} style={{ minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary }}>
        {saving ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>{editing ? "Save account details" : "Save and continue"}</Text>}
      </TouchableOpacity>
      </>}
    </ScrollView>
  );
}

function Field({ label, value, onChange, placeholder, colors, t, radius, space, keyboardType = "default", error, inputRef, testID }: any) {
  return <View style={{ gap: space.xs }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>{label}</Text><TextInput ref={inputRef} testID={testID} accessibilityHint={error} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.inkFaint} keyboardType={keyboardType} autoCapitalize="words" style={[t.body, { minHeight: 48, paddingHorizontal: space.md, borderWidth: 1, borderColor: error ? colors.destructive : colors.border, borderRadius: radius.sm, color: colors.foreground, backgroundColor: colors.card }]} />{error ? <Text accessibilityRole="alert" testID={testID ? `${testID}-error` : undefined} style={[t.caption, { color: colors.destructive }]}>{error}</Text> : null}</View>;
}

function SectionHeading({ icon, title, detail, colors, t, radius, space }: any) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
    <View style={{ width: HIT_SLOP_MIN, height: HIT_SLOP_MIN, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: colors.actionSoft }}>
      <Feather name={icon} size={19} color={colors.primary} />
    </View>
    <View style={{ flex: 1, gap: space.xxs }}>
      <Text accessibilityRole="header" style={[t.title3, { color: colors.foreground }]}>{title}</Text>
      <Text style={[t.caption, { color: colors.mutedForeground }]}>{detail}</Text>
    </View>
  </View>;
}

function Chip({ label, active, onPress, colors, t, radius, space }: any) {
  return <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={{ paddingHorizontal: space.md, paddingVertical: space.xs, borderWidth: 1, borderColor: active ? colors.primary : colors.border, borderRadius: radius.pill, backgroundColor: active ? colors.actionSoft : colors.card }}><Text style={[t.caption, { color: active ? colors.primary : colors.mutedForeground }]}>{label}</Text></TouchableOpacity>;
}
