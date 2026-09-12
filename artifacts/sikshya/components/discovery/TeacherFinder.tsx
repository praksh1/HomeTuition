import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import TeacherCard from "@/components/TeacherCard";
import { HIT_SLOP_MIN, marketplaceColumnMax } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { apiGet, ApiError } from "@/utils/api";
import {
  EMPTY_TEACHER_SEARCH,
  activeTeacherFilterCount,
  appendTeacherPage,
  teacherSearchPath,
  type PublicTeacher,
  type TeacherPage,
  type TeacherSearch,
} from "@/utils/teacherDiscovery";

type District = { name: string; localLevels: string[] };
type Province = { name: string; districts: District[] };
type Facility = { name: string; nepaliName: string | null; type: string | null; localLevel: string };

const SUBJECTS = ["All", "Mathematics", "Science", "English", "Nepali", "Computer Science", "History", "Geography"];
const PAGE_SIZE = 12;

export default function TeacherFinder({ onOpen }: { onOpen: (teacher: PublicTeacher) => void }) {
  const colors = useColors();
  const { t, gutter, space, radius, elevation, isCompact } = useLayout();
  const insets = useSafeAreaInsets();
  const [typedQuery, setTypedQuery] = React.useState("");
  const [criteria, setCriteria] = React.useState<TeacherSearch>(EMPTY_TEACHER_SEARCH);
  const [draft, setDraft] = React.useState<TeacherSearch>(EMPTY_TEACHER_SEARCH);
  const [rows, setRows] = React.useState<PublicTeacher[]>([]);
  const [total, setTotal] = React.useState<number | null>(null);
  const [page, setPage] = React.useState(1);
  const [state, setState] = React.useState<"loading" | "ready" | "failed">("loading");
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [moreFailed, setMoreFailed] = React.useState(false);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [choice, setChoice] = React.useState<"province" | "district" | "localLevel" | null>(null);
  const [provinces, setProvinces] = React.useState<Province[]>([]);
  const [locationsFailed, setLocationsFailed] = React.useState(false);
  const [institutionQuery, setInstitutionQuery] = React.useState("");
  const [facilities, setFacilities] = React.useState<Facility[]>([]);
  const [facilityState, setFacilityState] = React.useState<"idle" | "loading" | "failed">("idle");
  const request = React.useRef(0);

  const load = React.useCallback(async (nextCriteria: TeacherSearch, nextPage = 1) => {
    const append = nextPage > 1;
    if (append) {
      setLoadingMore(true);
      setMoreFailed(false);
    } else {
      setState("loading");
    }
    const mine = ++request.current;
    try {
      const answer = await apiGet<TeacherPage>(teacherSearchPath(nextCriteria, nextPage, PAGE_SIZE));
      if (mine !== request.current) return;
      const normalized = answer.teachers.map((teacher) => ({
        ...teacher,
        id: String(teacher.id),
        subjects: teacher.subjects ?? [],
        bio: teacher.bio ?? "",
        rating: Number(teacher.rating) || 0,
        reviewCount: teacher.reviewCount ?? 0,
        avatarUrl: teacher.avatarUrl ?? undefined,
        location: teacher.location ?? undefined,
        district: teacher.district ?? undefined,
        province: teacher.province ?? undefined,
        localLevel: teacher.localLevel ?? undefined,
        institutionName: teacher.institutionName ?? undefined,
        affiliationStatus: teacher.affiliationStatus ?? undefined,
      }));
      setRows((current) => append ? appendTeacherPage(current, normalized) : normalized);
      setTotal(answer.total);
      setPage(answer.page);
      setState("ready");
    } catch {
      if (mine !== request.current) return;
      if (append) setMoreFailed(true);
      else setState("failed");
    } finally {
      if (mine === request.current) setLoadingMore(false);
    }
  }, []);

  React.useEffect(() => { void load(EMPTY_TEACHER_SEARCH); }, [load]);

  const submitQuery = () => {
    const next = { ...criteria, query: typedQuery.trim() };
    setCriteria(next);
    void load(next);
  };

  const openFilters = async () => {
    setDraft(criteria);
    setFilterOpen(true);
    if (provinces.length > 0) return;
    setLocationsFailed(false);
    try {
      const answer = await apiGet<{ provinces: Province[] }>("/locations/nepal");
      setProvinces(answer.provinces ?? []);
    } catch {
      setLocationsFailed(true);
    }
  };

  const districts = React.useMemo(
    () => provinces.find((item) => item.name === draft.province)?.districts ?? [],
    [draft.province, provinces],
  );
  const localLevels = React.useMemo(
    () => districts.find((item) => item.name === draft.district)?.localLevels ?? [],
    [districts, draft.district],
  );

  const findInstitutions = async () => {
    if (!draft.province || !draft.district || institutionQuery.trim().length < 2) return;
    setFacilityState("loading");
    try {
      const params = new URLSearchParams({
        province: draft.province,
        district: draft.district,
        localLevel: draft.localLevel,
        q: institutionQuery.trim(),
      });
      const answer = await apiGet<{ facilities: Facility[] }>(`/locations/nepal/facilities?${params.toString()}`);
      setFacilities(answer.facilities ?? []);
      setFacilityState("idle");
    } catch (err) {
      setFacilityState("failed");
      if (err instanceof ApiError && err.status === 400) setFacilities([]);
    }
  };

  const applyFilters = () => {
    const next = { ...draft, query: typedQuery.trim() };
    setCriteria(next);
    setFilterOpen(false);
    setChoice(null);
    void load(next);
  };

  const clearAll = () => {
    setTypedQuery("");
    setCriteria(EMPTY_TEACHER_SEARCH);
    setDraft(EMPTY_TEACHER_SEARCH);
    setInstitutionQuery("");
    setFacilities([]);
    void load(EMPTY_TEACHER_SEARCH);
  };

  const filterCount = activeTeacherFilterCount(criteria);
  const hasMore = total !== null && rows.length < total;

  const field = (
    key: "province" | "district" | "localLevel",
    label: string,
    value: string,
    disabled: boolean,
  ) => (
    <Pressable
      testID={`teacher-filter-${key}`}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value || "Any"}`}
      disabled={disabled}
      aria-disabled={disabled}
      onPress={() => setChoice(choice === key ? null : key)}
      style={{
        minHeight: HIT_SLOP_MIN,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: disabled ? colors.muted : colors.card,
        borderRadius: radius.sm,
        paddingHorizontal: space.sm,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        opacity: disabled ? 0.65 : 1,
      }}
    >
      <Text style={[t.body, { flex: 1, color: value ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>
        {value || label}
      </Text>
      <Feather name={choice === key ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
    </Pressable>
  );

  const options = choice === "province"
    ? provinces.map((item) => item.name)
    : choice === "district"
      ? districts.map((item) => item.name)
      : choice === "localLevel" ? localLevels : [];

  return (
    <>
      <ScrollView
        testID="teacher-finder-scroll"
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: space.md,
          paddingBottom: insets.bottom + space.huge,
          width: "100%",
          maxWidth: marketplaceColumnMax,
          alignSelf: "center",
          gap: space.md,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: space.xxs }}>
          <Text style={[t.title2, { color: colors.foreground }]}>Find someone you know</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>
            Search a teacher by name, school, subject or place.
          </Text>
        </View>

        <View style={{ flexDirection: isCompact ? "column" : "row", gap: space.xs }}>
          <View style={{
            minHeight: HIT_SLOP_MIN,
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            paddingHorizontal: space.sm,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.sm,
            backgroundColor: colors.surfaceSunk,
          }}>
            <Feather name="search" size={18} color={colors.mutedForeground} />
            <TextInput
              testID="teacher-search"
              value={typedQuery}
              onChangeText={setTypedQuery}
              onSubmitEditing={submitQuery}
              returnKeyType="search"
              placeholder="Teacher or institution name"
              placeholderTextColor={colors.mutedForeground}
              accessibilityLabel="Teacher or institution name"
              style={[t.body, { flex: 1, color: colors.foreground, minHeight: HIT_SLOP_MIN }]}
            />
            {typedQuery ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Clear teacher search" onPress={() => setTypedQuery("")} style={{ minHeight: HIT_SLOP_MIN, minWidth: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center" }}>
                <Feather name="x" size={17} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            testID="teacher-search-submit"
            accessibilityRole="button"
            onPress={submitQuery}
            style={{ minHeight: HIT_SLOP_MIN, paddingHorizontal: space.lg, borderRadius: radius.sm, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Search</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}>
          <Pressable
            testID="teacher-location-filter"
            accessibilityRole="button"
            onPress={() => void openFilters()}
            style={{ minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.sm, borderWidth: 1, borderColor: filterCount ? colors.primary : colors.border, backgroundColor: filterCount ? colors.actionSoft : colors.card, borderRadius: radius.pill }}
          >
            <Feather name="map-pin" size={16} color={filterCount ? colors.primary : colors.mutedForeground} />
            <Text style={[t.bodyStrong, { color: filterCount ? colors.primary : colors.foreground }]}>School or location{filterCount ? ` · ${filterCount}` : ""}</Text>
          </Pressable>
          <Pressable
            testID="teacher-independent-filter"
            accessibilityRole="button"
            accessibilityState={{ selected: criteria.affiliation === "independent" }}
            aria-pressed={criteria.affiliation === "independent"}
            onPress={() => {
              const next = { ...criteria, affiliation: criteria.affiliation === "independent" ? "all" as const : "independent" as const };
              setCriteria(next);
              setDraft(next);
              void load(next);
            }}
            style={{ minHeight: HIT_SLOP_MIN, flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.sm, borderWidth: 1, borderColor: criteria.affiliation === "independent" ? colors.primary : colors.border, backgroundColor: criteria.affiliation === "independent" ? colors.actionSoft : colors.card, borderRadius: radius.pill }}
          >
            <Feather name="user" size={16} color={criteria.affiliation === "independent" ? colors.primary : colors.mutedForeground} />
            <Text style={[t.bodyStrong, { color: criteria.affiliation === "independent" ? colors.primary : colors.foreground }]}>Independent teachers</Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
          {SUBJECTS.map((subject) => {
            const active = criteria.subject === subject;
            return (
              <Pressable
                key={subject}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                aria-pressed={active}
                onPress={() => {
                  const next = { ...criteria, subject };
                  setCriteria(next);
                  setDraft(next);
                  void load(next);
                }}
                style={{ minHeight: HIT_SLOP_MIN, justifyContent: "center", paddingHorizontal: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.card }}
              >
                <Text style={[t.caption, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>{subject}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {state === "loading" ? (
          <View testID="teacher-results-loading" style={{ minHeight: space.huge * 2, alignItems: "center", justifyContent: "center", gap: space.sm }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[t.callout, { color: colors.mutedForeground }]}>Finding teachers…</Text>
          </View>
        ) : state === "failed" ? (
          <View testID="teacher-results-failed" accessibilityRole="alert" style={{ padding: space.lg, gap: space.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: radius.md }}>
            <Text style={[t.title3, { color: colors.foreground }]}>Could not load teachers</Text>
            <Text style={[t.callout, { color: colors.mutedForeground }]}>Check your connection and try again.</Text>
            <Pressable accessibilityRole="button" onPress={() => void load(criteria)} style={{ minHeight: HIT_SLOP_MIN, alignSelf: "flex-start", justifyContent: "center" }}>
              <Text style={[t.bodyStrong, { color: colors.primary }]}>Try again</Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View testID="teacher-results-empty" style={{ padding: space.lg, gap: space.sm, alignItems: "center", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: radius.md }}>
            <Feather name="search" size={24} color={colors.mutedForeground} />
            <Text style={[t.title3, { color: colors.foreground }]}>No matching teachers</Text>
            <Text style={[t.callout, { color: colors.mutedForeground, textAlign: "center" }]}>Try another name, school, subject or nearby place.</Text>
            <Pressable accessibilityRole="button" onPress={clearAll} style={{ minHeight: HIT_SLOP_MIN, justifyContent: "center" }}>
              <Text style={[t.bodyStrong, { color: colors.primary }]}>Clear search</Text>
            </Pressable>
          </View>
        ) : (
          <View testID="teacher-results" style={{ gap: space.xs }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.sm }}>
              <Text style={[t.title3, { color: colors.foreground }]}>Teachers</Text>
              <Text style={[t.caption, { color: colors.mutedForeground }]}>{total} {total === 1 ? "match" : "matches"}</Text>
            </View>
            {rows.map((teacher) => <TeacherCard key={teacher.userId} teacher={teacher} onPress={() => onOpen(teacher)} />)}
            {hasMore ? (
              <Pressable
                testID="teacher-results-more"
                accessibilityRole="button"
                disabled={loadingMore}
                aria-disabled={loadingMore}
                onPress={() => void load(criteria, page + 1)}
                style={{ minHeight: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, backgroundColor: colors.card, opacity: loadingMore ? 0.65 : 1 }}
              >
                <Text style={[t.bodyStrong, { color: colors.primary }]}>{loadingMore ? "Loading…" : "Show more teachers"}</Text>
              </Pressable>
            ) : null}
            {moreFailed ? <Text accessibilityRole="alert" style={[t.callout, { color: colors.destructive }]}>More teachers could not load. Try again.</Text> : null}
          </View>
        )}
      </ScrollView>

      <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: colors.scrim }} onPress={() => setFilterOpen(false)} accessibilityLabel="Close filters" />
        <View style={[{ maxHeight: "88%", paddingTop: space.sm, paddingHorizontal: gutter, paddingBottom: insets.bottom + space.md, backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }, elevation.modal]}>
          <View style={{ width: space.xxl, height: space.xxs, alignSelf: "center", backgroundColor: colors.lineStrong, borderRadius: radius.pill, marginBottom: space.sm }} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, marginBottom: space.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={[t.title2, { color: colors.foreground }]}>School or location</Text>
              <Text style={[t.caption, { color: colors.mutedForeground }]}>Choose only what you know.</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => { setDraft({ ...EMPTY_TEACHER_SEARCH, query: typedQuery }); setInstitutionQuery(""); setFacilities([]); }} style={{ minHeight: HIT_SLOP_MIN, justifyContent: "center" }}>
              <Text style={[t.bodyStrong, { color: colors.primary }]}>Reset</Text>
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.sm }}>
            {locationsFailed ? <Text accessibilityRole="alert" style={[t.callout, { color: colors.destructive }]}>Locations could not load. Close and try again.</Text> : null}
            {field("province", "Province", draft.province, false)}
            {choice === "province" ? <ChoiceList options={options} selected={draft.province} onChoose={(value) => { setDraft((current) => ({ ...current, province: value, district: "", localLevel: "", institution: "" })); setInstitutionQuery(""); setFacilities([]); setChoice(null); }} /> : null}
            {field("district", "District", draft.district, !draft.province)}
            {choice === "district" ? <ChoiceList options={options} selected={draft.district} onChoose={(value) => { setDraft((current) => ({ ...current, district: value, localLevel: "", institution: "" })); setInstitutionQuery(""); setFacilities([]); setChoice(null); }} /> : null}
            {field("localLevel", "Municipality / local level", draft.localLevel, !draft.district)}
            {choice === "localLevel" ? <ChoiceList options={options} selected={draft.localLevel} onChoose={(value) => { setDraft((current) => ({ ...current, localLevel: value, institution: "" })); setInstitutionQuery(""); setFacilities([]); setChoice(null); }} /> : null}

            <View style={{ gap: space.xs }}>
              <Text style={[t.bodyStrong, { color: colors.foreground }]}>School, college or training centre</Text>
              <View style={{ flexDirection: isCompact ? "column" : "row", gap: space.xs }}>
                <TextInput
                  testID="teacher-institution-query"
                  value={institutionQuery}
                  onChangeText={setInstitutionQuery}
                  onSubmitEditing={() => void findInstitutions()}
                  editable={!!draft.district}
                  placeholder={draft.district ? "Type at least 2 letters" : "Choose province and district first"}
                  placeholderTextColor={colors.mutedForeground}
                  style={[t.body, { flex: 1, minHeight: HIT_SLOP_MIN, paddingHorizontal: space.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, color: colors.foreground, backgroundColor: colors.card }]}
                />
                <Pressable accessibilityRole="button" disabled={!draft.district || institutionQuery.trim().length < 2 || facilityState === "loading"} aria-disabled={!draft.district || institutionQuery.trim().length < 2 || facilityState === "loading"} onPress={() => void findInstitutions()} style={{ minHeight: HIT_SLOP_MIN, paddingHorizontal: space.md, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.primary, opacity: !draft.district || institutionQuery.trim().length < 2 ? 0.55 : 1 }}>
                  <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>{facilityState === "loading" ? "Looking…" : "Find school"}</Text>
                </Pressable>
              </View>
              {facilityState === "failed" ? <Text accessibilityRole="alert" style={[t.caption, { color: colors.destructive }]}>Institutions could not load. Try again.</Text> : null}
              {facilities.map((facility) => (
                <Pressable key={`${facility.localLevel}-${facility.name}`} accessibilityRole="button" onPress={() => { setDraft((current) => ({ ...current, institution: facility.name, localLevel: facility.localLevel || current.localLevel, affiliation: "affiliated" })); setInstitutionQuery(facility.name); setFacilities([]); }} style={{ minHeight: HIT_SLOP_MIN, padding: space.sm, borderWidth: 1, borderColor: draft.institution === facility.name ? colors.primary : colors.border, borderRadius: radius.sm, backgroundColor: draft.institution === facility.name ? colors.actionSoft : colors.card }}>
                  <Text style={[t.bodyStrong, { color: colors.foreground }]}>{facility.name}</Text>
                  {facility.nepaliName ? <Text style={[t.caption, { color: colors.mutedForeground }]}>{facility.nepaliName}</Text> : null}
                  <Text style={[t.caption, { color: colors.mutedForeground }]}>{facility.localLevel}</Text>
                </Pressable>
              ))}
              {draft.institution ? <Text style={[t.caption, { color: colors.success }]}>Selected: {draft.institution}</Text> : null}
            </View>

            <View style={{ gap: space.xs }}>
              <Text style={[t.bodyStrong, { color: colors.foreground }]}>Teacher type</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                {([{ key: "all", label: "Any" }, { key: "affiliated", label: "Works with an institution" }, { key: "independent", label: "Independent" }] as const).map((item) => {
                  const selected = draft.affiliation === item.key;
                  return <Pressable key={item.key} accessibilityRole="button" accessibilityState={{ selected }} aria-pressed={selected} onPress={() => setDraft((current) => ({ ...current, affiliation: item.key }))} style={{ minHeight: HIT_SLOP_MIN, justifyContent: "center", paddingHorizontal: space.sm, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.actionSoft : colors.card, borderRadius: radius.pill }}><Text style={[t.caption, { color: selected ? colors.primary : colors.mutedForeground }]}>{item.label}</Text></Pressable>;
                })}
              </View>
            </View>
          </ScrollView>

          <Pressable testID="teacher-filter-apply" accessibilityRole="button" onPress={applyFilters} style={{ minHeight: HIT_SLOP_MIN, marginTop: space.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, borderRadius: radius.sm }}>
            <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>Show matching teachers</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

function ChoiceList({ options, selected, onChoose }: { options: string[]; selected: string; onChoose: (value: string) => void }) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  return (
    <ScrollView nestedScrollEnabled style={{ maxHeight: space.huge * 4 }} contentContainerStyle={{ gap: space.xxs, padding: space.xxs }}>
      {options.map((option) => (
        <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: option === selected }} onPress={() => onChoose(option)} style={{ minHeight: HIT_SLOP_MIN, justifyContent: "center", paddingHorizontal: space.sm, borderRadius: radius.sm, backgroundColor: option === selected ? colors.actionSoft : colors.card }}>
          <Text style={[t.body, { color: option === selected ? colors.primary : colors.foreground }]}>{option}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
