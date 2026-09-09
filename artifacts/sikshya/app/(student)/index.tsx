import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  HIT_SLOP_MIN,
  bottomNavClearance,
  marketplaceColumnMax,
} from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { numeric } from "@/constants/typography";
import Skeleton from "@/components/Skeleton";
import FollowedTeachers from "@/components/FollowedTeachers";
import { useNotifications } from "@/context/NotificationContext";
import { apiGet } from "@/utils/api";
import { loadTeacherDirectory } from "@/utils/teacherDirectory";
import { matches as matchesSearch, score as searchScore } from "@/utils/search";
import TeacherCard from "@/components/TeacherCard";
import ProgramDiscoverList from "@/components/programs/ProgramDiscoverList";
import PublicClassCard from "@/components/programs/PublicClassCard";
import {
  appendPage,
  DISCOVER_TABS,
  TEACHERS_TABS,
  type DiscoverView,
  type ProgramType,
  type PublicProgramSummary,
  type TeachersView,
} from "@/utils/programDiscovery";
import {
  appendClassPage,
  publicClassCard,
  publicClassListState,
  type PublicClass,
} from "@/utils/publicClasses";
import { ApiError } from "@/utils/api";
import type { Teacher } from "@/context/AuthContext";

const SUBJECTS = ["All", "Mathematics", "Science", "English", "Nepali", "Computer Science", "History", "Geography"];

const DISTRICTS = ["All Districts", "Kathmandu", "Lalitpur", "Bhaktapur", "Kaski", "Chitwan", "Morang", "Sunsari", "Rupandehi"];

/**
 * "Most Students" is kept and "Online Now" is not.
 *
 * There was an *Online Now Only* filter, and a green dot on every card, both reading
 * `is_online` — a column nothing in the app has ever written. Every teacher is false, so the
 * filter emptied the storefront every time it was used and then told the student "No teachers
 * found — try a different keyword", blaming them for it. Real presence would come from the
 * classroom socket, not from a flag nobody sets.
 */
type SortKey = "rating" | "students" | "price_asc" | "price_desc" | "experience";
const SORT_OPTIONS: { key: SortKey; label: string; icon: string }[] = [
  { key: "rating", label: "Highest rated", icon: "star" },
  { key: "students", label: "Most students", icon: "users" },
  { key: "price_asc", label: "Price: low to high", icon: "trending-up" },
  { key: "price_desc", label: "Price: high to low", icon: "trending-down" },
  { key: "experience", label: "Most experienced", icon: "award" },
];

interface Filters {
  district: string;
  minRating: number;
  maxPrice: number | null;
}

const DEFAULT_FILTERS: Filters = {
  district: "All Districts",
  minRating: 0,
  maxPrice: null,
};

/** Just enough of a monthly class to know it exists and who runs it. */
interface MonthlyBrief {
  id: number;
  teacherId: number;
}

export default function Discover() {
  const colors = useColors();
  const { t, gutter, space, radius, elevation } = useLayout();
  const insets = useSafeAreaInsets();
  const { unreadCount } = useNotifications();

  /**
   * Which of the three product views is showing.
   *
   * Programs, Single classes, Teachers — the shape Codex approved for this phase. Following used
   * to be one of the top-level tabs; it has moved back inside Teachers as a sub-choice, because a
   * follow is a relationship with a teacher and not a product category of its own.
   */
  const [view, setView] = useState<DiscoverView>("programs");

  /**
   * When Teachers is the primary view, which of its two sub-lists to show.
   */
  const [teachersView, setTeachersView] = useState<TeachersView>("all");

  const currentTab = useMemo(
    () => DISCOVER_TABS.find((tab) => tab.view === view) ?? DISCOVER_TABS[0],
    [view],
  );

  /* ------------------------------------------------------------- programs ----- */

  const [programs, setPrograms] = useState<PublicProgramSummary[]>([]);
  const [programsCursor, setProgramsCursor] = useState<string | null>(null);
  const [programsLoading, setProgramsLoading] = useState(true);
  const [programsLoadingMore, setProgramsLoadingMore] = useState(false);
  /**
   * Two separate failure fields.
   *
   * `programsInitialError` is a first-load failure with no cards yet — the whole list is drawn
   * as a failure and offers "Try again". `programsMoreError` is a "Show more" failure with rows
   * already visible; the successful cards stay on screen and the retry sits beside "Show more".
   * Merging them (as this file used to) hid successful cards behind a full failure card because
   * a pagination request failed — Codex correction round 1, item 4.
   */
  const [programsInitialError, setProgramsInitialError] = useState<string | null>(null);
  const [programsMoreError, setProgramsMoreError] = useState<string | null>(null);
  const [programQuery, setProgramQuery] = useState("");
  const [programType, setProgramType] = useState<ProgramType | "all">("all");

  /**
   * A monotonically-increasing request id, so a late answer for an earlier query cannot overwrite
   * the current results. Same shape the studio uses for saves — an old response arriving after a
   * newer one has already come back is the ordinary case on a Nepali connection, and this makes
   * sure that "typed 'guitar' then typed 'exam'" always ends up showing exam results.
   */
  const programRequestRef = useRef(0);

  const loadPrograms = useCallback(
    async (opts: { append?: boolean; query?: string; type?: ProgramType | "all" } = {}) => {
      const append = opts.append === true;
      const q = opts.query !== undefined ? opts.query : programQuery;
      const type = opts.type !== undefined ? opts.type : programType;
      const cursor = append ? programsCursor : null;

      if (append) {
        setProgramsLoadingMore(true);
        setProgramsMoreError(null);
      } else {
        setProgramsLoading(true);
        setProgramsInitialError(null);
        setProgramsMoreError(null);
      }
      const mine = ++programRequestRef.current;

      try {
        const params = new URLSearchParams();
        params.set("limit", "20");
        if (q.trim().length > 0) params.set("q", q.trim());
        if (type !== "all") params.set("type", type);
        if (cursor) params.set("cursor", cursor);
        const answer = await apiGet<{ programs: PublicProgramSummary[]; nextCursor: string | null }>(
          `/programs?${params.toString()}`,
        );
        if (mine !== programRequestRef.current) return; // superseded

        if (append) {
          setPrograms((current) => appendPage({ rows: current, nextCursor: programsCursor }, {
            rows: answer.programs, nextCursor: answer.nextCursor,
          }).rows);
        } else {
          setPrograms(answer.programs);
        }
        setProgramsCursor(answer.nextCursor);
      } catch (err) {
        if (mine !== programRequestRef.current) return;
        const message = err instanceof ApiError
          ? err.message
          : "Fadko could not reach the server. Check your connection and try again.";
        if (append) {
          setProgramsMoreError(message);
        } else {
          setPrograms([]);
          setProgramsInitialError(message);
        }
      } finally {
        if (mine !== programRequestRef.current) return;
        if (append) setProgramsLoadingMore(false);
        else setProgramsLoading(false);
      }
    },
    [programQuery, programType, programsCursor],
  );

  // First load when the screen mounts (Programs is the initial view), and again whenever the
  // primary type filter changes. Typing does *not* fetch on every keystroke — the request fires
  // on Enter or on the visible Search button, so a Nepali bus connection is not billed one call
  // per letter.
  React.useEffect(() => {
    void loadPrograms({ type: programType, query: programQuery });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programType]);

  /* ---------------------------------------------------------- single classes --- */

  const [classes, setClasses] = useState<PublicClass[]>([]);
  const [classesCursor, setClassesCursor] = useState<string | null>(null);
  const [classesLoading, setClassesLoading] = useState(false);
  const [classesLoadingMore, setClassesLoadingMore] = useState(false);
  const [classesInitialError, setClassesInitialError] = useState<string | null>(null);
  const [classesMoreError, setClassesMoreError] = useState<string | null>(null);
  /** What is currently typed (unsubmitted). Only fetches on submit or the Search button. */
  const [classQuery, setClassQuery] = useState("");
  /** What was last submitted to the server. Drives the no-match phrasing. */
  const [classSubmittedQuery, setClassSubmittedQuery] = useState("");
  const [classesLoadedOnce, setClassesLoadedOnce] = useState(false);
  const classRequestRef = useRef(0);

  const loadClasses = useCallback(async (opts: { append?: boolean; query?: string } = {}) => {
    const append = opts.append === true;
    const q = opts.query !== undefined ? opts.query : classSubmittedQuery;
    const cursor = append ? classesCursor : null;

    if (append) {
      setClassesLoadingMore(true);
      setClassesMoreError(null);
    } else {
      setClassesLoading(true);
      setClassesInitialError(null);
      setClassesMoreError(null);
    }
    const mine = ++classRequestRef.current;

    try {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (q.trim().length > 0) params.set("q", q.trim());
      if (cursor) params.set("cursor", cursor);
      const answer = await apiGet<{ classes: PublicClass[]; nextCursor: string | null }>(
        `/public/classes?${params.toString()}`,
      );
      if (mine !== classRequestRef.current) return;

      if (append) {
        setClasses((current) => appendClassPage(
          { rows: current, nextCursor: classesCursor },
          { rows: answer.classes, nextCursor: answer.nextCursor },
        ).rows);
      } else {
        setClasses(answer.classes);
      }
      setClassesCursor(answer.nextCursor);
      setClassesLoadedOnce(true);
    } catch (err) {
      if (mine !== classRequestRef.current) return;
      const message = err instanceof ApiError
        ? err.message
        : "Fadko could not reach the server. Check your connection and try again.";
      if (append) {
        // Do not wipe the loaded page — retry sits beside "Show more".
        setClassesMoreError(message);
      } else {
        setClasses([]);
        setClassesInitialError(message);
      }
    } finally {
      if (mine !== classRequestRef.current) return;
      if (append) setClassesLoadingMore(false);
      else setClassesLoading(false);
    }
  }, [classSubmittedQuery, classesCursor]);

  const submitClassQuery = useCallback((text: string) => {
    setClassSubmittedQuery(text);
    void loadClasses({ query: text });
  }, [loadClasses]);

  /* --------------------------------------------------------------- teachers --- */

  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("All");
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherTotal, setTeacherTotal] = useState<number | null>(null);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [teacherLoadFailed, setTeacherLoadFailed] = useState(false);
  const [teachersLoadedOnce, setTeachersLoadedOnce] = useState(false);
  const [monthly, setMonthly] = useState<MonthlyBrief[] | null>(null);
  const [monthlyLoadedOnce, setMonthlyLoadedOnce] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("rating");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showSort, setShowSort] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [draftFilters, setDraftFilters] = useState<Filters>(DEFAULT_FILTERS);

  const loadTeachers = useCallback(async () => {
    setLoadingTeachers(true);
    setTeacherLoadFailed(false);
    try {
      const res = await loadTeacherDirectory<Teacher>(apiGet);
      setTeachers(res.teachers.map((t: Teacher) => ({ ...t, credentials: [] })));
      setTeacherTotal(res.total ?? res.teachers.length);
      setTeachersLoadedOnce(true);
    } catch (_e) {
      if (!teachersLoadedOnce) {
        // First-load failure — the empty state may show. A refresh that fails does *not* wipe
        // successful teachers off the screen.
        setTeacherLoadFailed(true);
        setTeachers([]);
        setTeacherTotal(null);
      }
    } finally {
      setLoadingTeachers(false);
    }
  }, [teachersLoadedOnce]);

  const loadMonthly = useCallback(async () => {
    try {
      const res = await apiGet<{ classes: MonthlyBrief[] }>("/monthly/classes");
      setMonthly(res.classes ?? []);
      setMonthlyLoadedOnce(true);
    } catch {
      if (!monthlyLoadedOnce) setMonthly(null);
    }
  }, [monthlyLoadedOnce]);

  /**
   * Load each secondary marketplace once, when it is first selected. Programs has its own
   * mount/filter effect above because it is the initial view.
   *
   * This is intentionally one effect rather than an effect plus `useFocusEffect`. A focus
   * effect re-runs when its memoised callback changes while the screen is focused; combining
   * both triggers started two requests on the first tab switch before React had painted the
   * first loading-state update. Successful rows stay in state when the student visits another
   * tab and returns.
   */
  React.useEffect(() => {
    if (view === "classes" && !classesLoadedOnce && !classesLoading) void loadClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  React.useEffect(() => {
    if (view === "teachers") {
      if (!teachersLoadedOnce && !loadingTeachers) void loadTeachers();
      if (!monthlyLoadedOnce) void loadMonthly();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  /** Teachers who also run a monthly class, for the badge on their card. */
  const monthlyTeacherIds = useMemo(
    () => (monthly === null ? null : new Set(monthly.map((k) => k.teacherId))),
    [monthly],
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.district !== "All Districts") count++;
    if (filters.minRating > 0) count++;
    if (filters.maxPrice !== null) count++;
    return count;
  }, [filters]);

  const filtered = useMemo(() => {
    const q = search.trim();
    let result = teachers.filter((teacher) => {
      if (q) {
        const fields = [
          teacher.name, teacher.email ?? "", teacher.subject, teacher.bio,
          teacher.location ?? "", teacher.district ?? "",
          ...(teacher.subjects ?? []), ...(teacher.languages ?? []),
        ];
        if (!fields.some((field) => matchesSearch(field, q))) return false;
      }
      if (subject !== "All" && teacher.subject !== subject) return false;
      if (filters.district !== "All Districts" && teacher.district !== filters.district) return false;
      if (filters.minRating > 0 && teacher.rating < filters.minRating) return false;
      if (filters.maxPrice !== null && (teacher.pricePerSession ?? 0) > filters.maxPrice) return false;
      return true;
    });

    if (q) {
      const rank = (teacher: Teacher) =>
        searchScore(
          [
            { value: teacher.name, weight: 4 },
            { value: teacher.subject, weight: 2 },
            { value: (teacher.subjects ?? []).join(" "), weight: 2 },
            { value: teacher.district ?? "", weight: 2 },
            { value: teacher.location ?? "", weight: 1 },
            { value: teacher.bio, weight: 1 },
          ],
          q,
        );
      return [...result].sort((a, b) => rank(b) - rank(a) || b.rating - a.rating);
    }

    result = [...result].sort((a, b) => {
      switch (sortKey) {
        case "rating": return b.rating - a.rating;
        case "students": return b.totalStudents - a.totalStudents;
        case "price_asc": return (a.pricePerSession ?? 0) - (b.pricePerSession ?? 0);
        case "price_desc": return (b.pricePerSession ?? 0) - (a.pricePerSession ?? 0);
        case "experience": return (b.experienceYears ?? 0) - (a.experienceYears ?? 0);
        default: return 0;
      }
    });

    return result;
  }, [teachers, search, subject, sortKey, filters]);

  const topPick = filtered.length > 0 && filtered[0].reviewCount > 0 ? filtered[0] : null;
  const restTeachers = topPick ? filtered.slice(1) : filtered;
  const isSearching = !!search.trim() || subject !== "All" || activeFilterCount > 0;

  const openFilter = () => { setDraftFilters({ ...filters }); setShowFilter(true); };
  const applyFilters = () => { setFilters({ ...draftFilters }); setShowFilter(false); };
  const resetFilters = () => { setDraftFilters({ ...DEFAULT_FILTERS }); };

  const currentSortLabel = SORT_OPTIONS.find((s) => s.key === sortKey)?.label ?? "Sort";
  const inTeachersAll = view === "teachers" && teachersView === "all";

  /**
   * Tapping a class card routes to the teacher's public page with `?session=<id>`, where the
   * existing Book & Pay control lives. This screen deliberately does not duplicate the booking
   * flow — the teacher page knows about payment methods, test-class grants, the join window
   * and everything else. Codex correction round 2, item 1.
   */
  const openClassOnTeacherPage = useCallback((row: PublicClass) => {
    // The teacher page is looked up by *profile* id (not user id), so route with that. The
    // API returns both — the tap uses profileId; if a future action needs the user id it is
    // already on the row.
    router.push(`/(student)/teacher/${row.teacherProfileId}?session=${row.id}`);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* ------------------------------------------------------------------ header */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + space.md, paddingHorizontal: gutter, paddingBottom: space.sm, borderBottomColor: colors.border, gap: space.sm },
        ]}
      >
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text testID="discover-heading" style={[t.title1, { color: colors.foreground }]}>
              {currentTab.heading}
            </Text>
            {view === "teachers" ? (
              loadingTeachers && !teachersLoadedOnce ? (
                <View style={{ marginTop: space.xxs }}><Skeleton width={168} height={13} /></View>
              ) : (
                <Text
                  testID="discover-subtitle"
                  style={[t.caption, numeric, { color: colors.mutedForeground, marginTop: space.xxs / 2 }]}
                >
                  {teacherTotal === null
                    ? currentTab.subtitle
                    : `${teacherTotal} verified ${teacherTotal === 1 ? "teacher" : "teachers"} across Nepal`}
                </Text>
              )
            ) : (
              <Text
                testID="discover-subtitle"
                style={[t.caption, { color: colors.mutedForeground, marginTop: space.xxs / 2 }]}
              >
                {currentTab.subtitle}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={[styles.bellBtn, { borderColor: colors.border, borderRadius: radius.sm }]}
            onPress={() => router.push("/notifications")}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          >
            <Feather name="bell" size={20} color={colors.foreground} />
            {unreadCount > 0 && (
              <View style={[styles.bellBadge, { backgroundColor: colors.brand, borderColor: colors.background }]}>
                <Text style={[t.overline, styles.badgeText, { color: colors.brandForeground }]}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={[styles.subTabs, { gap: space.xs }]}>
          {DISCOVER_TABS.map((tab) => {
            const active = view === tab.view;
            return (
              <TouchableOpacity
                key={tab.view}
                testID={`discover-subtab-${tab.view}`}
                onPress={() => setView(tab.view)}
                activeOpacity={0.75}
                accessibilityRole="tab"
                accessibilityLabel={tab.accessibilityLabel}
                accessibilityState={{ selected: active }}
                aria-selected={active}
                style={[
                  styles.subTab,
                  {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.actionSoft : colors.surface,
                    borderRadius: radius.sm,
                  },
                ]}
              >
                <Text style={[t.bodyStrong, { color: active ? colors.primary : colors.mutedForeground }]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {view === "teachers" ? (
          <View style={[styles.subTabs, { gap: space.xs }]}>
            {TEACHERS_TABS.map((tab) => {
              const active = teachersView === tab.view;
              return (
                <TouchableOpacity
                  key={tab.view}
                  testID={`teachers-subtab-${tab.view}`}
                  onPress={() => setTeachersView(tab.view)}
                  activeOpacity={0.75}
                  accessibilityRole="tab"
                  accessibilityLabel={tab.label}
                  accessibilityState={{ selected: active }}
                  aria-selected={active}
                  style={[
                    styles.subTab,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.actionSoft : colors.surface,
                      borderRadius: radius.sm,
                    },
                  ]}
                >
                  <Text style={[t.bodyStrong, { color: active ? colors.primary : colors.mutedForeground }]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {/* Search, sort and filters belong to the Teachers "All" list. */}
        {inTeachersAll && (
          <>
            <View
              style={[
                styles.searchBar,
                { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: space.sm, gap: space.xs },
              ]}
            >
              <Feather name="search" size={17} color={colors.inkFaint} />
              <TextInput
                testID="discover-search"
                style={[t.body, { flex: 1, color: colors.foreground, paddingVertical: space.sm, minHeight: HIT_SLOP_MIN }]}
                placeholder="Search by name, subject or district"
                placeholderTextColor={colors.inkFaint}
                value={search}
                onChangeText={setSearch}
                returnKeyType="search"
                accessibilityLabel="Search teachers"
              />
              {!!search && (
                <TouchableOpacity
                  onPress={() => setSearch("")}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs, paddingVertical: 2 }}>
              {SUBJECTS.map((s) => {
                const on = subject === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: on ? colors.primary : colors.surface,
                        borderColor: on ? colors.primary : colors.border,
                        borderRadius: radius.pill,
                        paddingHorizontal: space.sm,
                      },
                    ]}
                    onPress={() => { setSubject(s); Haptics.selectionAsync(); }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[t.caption, { color: on ? colors.primaryForeground : colors.mutedForeground }]}>
                      {s}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={[styles.toolRow, { gap: space.xs }]}>
              <TouchableOpacity
                style={[styles.toolBtn, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.xs, paddingHorizontal: space.sm, gap: space.xxs }]}
                onPress={() => setShowSort(true)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Sort by ${currentSortLabel}`}
              >
                <Feather name="bar-chart-2" size={14} color={colors.foreground} />
                <Text style={[t.caption, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>
                  {currentSortLabel}
                </Text>
                <Feather name="chevron-down" size={13} color={colors.inkFaint} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.toolBtn,
                  {
                    backgroundColor: activeFilterCount > 0 ? colors.actionSoft : colors.surface,
                    borderColor: activeFilterCount > 0 ? colors.primary : colors.border,
                    borderRadius: radius.xs,
                    paddingHorizontal: space.sm,
                    gap: space.xxs,
                  },
                ]}
                onPress={openFilter}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Feather name="sliders" size={14} color={activeFilterCount > 0 ? colors.primary : colors.foreground} />
                <Text style={[t.caption, { color: activeFilterCount > 0 ? colors.primary : colors.foreground }]}>
                  Filters
                </Text>
                {activeFilterCount > 0 && (
                  <View style={[styles.filterBadge, { backgroundColor: colors.primary, borderRadius: radius.pill }]}>
                    <Text style={[t.overline, styles.badgeText, { color: colors.primaryForeground }]}>
                      {activeFilterCount}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              <Text style={[t.caption, numeric, { color: colors.inkFaint, marginLeft: "auto" }]}>
                {filtered.length} {filtered.length === 1 ? "teacher" : "teachers"}
              </Text>
            </View>
          </>
        )}
      </View>

      {view === "programs" ? (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: gutter, paddingTop: space.md,
            paddingBottom: insets.bottom + bottomNavClearance, gap: space.md,
            width: "100%",
            maxWidth: marketplaceColumnMax,
            alignSelf: "center",
          }}
          keyboardShouldPersistTaps="handled"
        >
          <ProgramDiscoverList
            query={programQuery}
            onQueryChange={setProgramQuery}
            chosenType={programType}
            onTypeChange={(next) => setProgramType(next)}
            programs={programs}
            initialLoad={programsLoading}
            loadingMore={programsLoadingMore}
            hasMore={programsCursor !== null}
            initialError={programsInitialError}
            paginationError={programsMoreError}
            onLoadMore={() => void loadPrograms({ append: true })}
            onRetry={() => void loadPrograms({ query: programQuery, type: programType })}
            onOpen={(id) => router.push(`/(student)/program/${id}`)}
            onSubmit={(text) => { setProgramQuery(text); void loadPrograms({ query: text, type: programType }); }}
          />
        </ScrollView>
      ) : view === "classes" ? (
        <ClassesView
          rows={classes}
          hasMore={classesCursor !== null}
          initialLoad={classesLoading && !classesLoadedOnce}
          loadingMore={classesLoadingMore}
          initialError={classesInitialError}
          paginationError={classesMoreError}
          typedQuery={classQuery}
          submittedQuery={classSubmittedQuery}
          onQueryChange={setClassQuery}
          onSubmit={submitClassQuery}
          onRetry={() => void loadClasses({ query: classSubmittedQuery })}
          onLoadMore={() => void loadClasses({ append: true })}
          onOpen={openClassOnTeacherPage}
        />
      ) : view === "teachers" && teachersView === "following" ? (
        <ScrollView
          testID="teachers-following-scroll"
          contentContainerStyle={{ paddingBottom: insets.bottom + bottomNavClearance }}
        >
          <FollowedTeachers />
        </ScrollView>
      ) : (
        <>
          <FlatList
            data={isSearching ? filtered : restTeachers}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.md, paddingBottom: insets.bottom + bottomNavClearance }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <>
                {!isSearching && (
                  <TouchableOpacity
                    testID="student-monthly-entry"
                    style={[
                      styles.monthlyEntry,
                      {
                        backgroundColor: colors.brandSoft,
                        borderColor: colors.brand,
                        borderRadius: radius.md,
                        padding: space.md,
                        marginBottom: space.md,
                        gap: space.sm,
                      },
                    ]}
                    onPress={() => router.push("/(student)/monthly")}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Monthly classes, paid once a month"
                  >
                    <View style={[styles.monthlyIcon, { backgroundColor: colors.brand, borderRadius: radius.sm }]}>
                      <Feather name="repeat" size={20} color={colors.brandForeground} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={styles.monthlyTitleRow}>
                        <Text style={[t.title3, { color: colors.foreground }]}>Monthly classes</Text>
                        <View style={[styles.billingTag, { backgroundColor: colors.brand, borderRadius: radius.xs }]}>
                          <Text style={[t.overline, { color: colors.brandForeground }]}>Pay monthly</Text>
                        </View>
                      </View>
                      <Text style={[t.callout, { color: colors.mutedForeground }]}>
                        {monthly === null
                          ? "The same class every day. One payment for the month."
                          : monthly.length === 0
                            ? "None running yet. The same class every day, paid once a month."
                            : `${monthly.length} running now · the same class every day`}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={20} color={colors.brand} />
                  </TouchableOpacity>
                )}

                {!isSearching && topPick ? (
                  <View style={{ marginBottom: space.xs }}>
                    <View style={[styles.sectionHeader, { gap: space.xs, marginBottom: space.sm }]}>
                      <Feather name="award" size={15} color={colors.warn} />
                      <Text style={[t.title3, { color: colors.foreground }]}>Top rated</Text>
                    </View>
                    <TeacherCard
                      teacher={topPick}
                      onPress={() => router.push(`/(student)/teacher/${topPick.id}`)}
                      hasMonthlyClass={monthlyTeacherIds?.has(topPick.userId)}
                    />
                    <View style={[styles.sectionHeader, { gap: space.xs, marginTop: space.md, marginBottom: space.sm }]}>
                      <Text style={[t.title3, { color: colors.foreground }]}>All teachers</Text>
                      <View style={[styles.billingTag, { backgroundColor: colors.actionSoft, borderRadius: radius.xs }]}>
                        <Text style={[t.overline, { color: colors.primary }]}>Pay per class</Text>
                      </View>
                    </View>
                  </View>
                ) : !isSearching ? (
                  <View style={[styles.sectionHeader, { gap: space.xs, marginBottom: space.sm }]}>
                    <Text style={[t.title3, { color: colors.foreground }]}>All teachers</Text>
                    <View style={[styles.billingTag, { backgroundColor: colors.actionSoft, borderRadius: radius.xs }]}>
                      <Text style={[t.overline, { color: colors.primary }]}>Pay per class</Text>
                    </View>
                  </View>
                ) : null}
              </>
            }
            renderItem={({ item }) => (
              <TeacherCard
                teacher={item}
                onPress={() => router.push(`/(student)/teacher/${item.id}`)}
                hasMonthlyClass={monthlyTeacherIds?.has(item.userId)}
              />
            )}
            ListEmptyComponent={
              loadingTeachers && !teachersLoadedOnce ? (
                <View style={{ gap: space.sm }}>
                  {[0, 1, 2, 3].map((i) => (
                    <View
                      key={i}
                      style={[
                        styles.skelCard,
                        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm },
                      ]}
                    >
                      <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
                        <Skeleton width={52} height={52} radius={26} />
                        <View style={{ flex: 1, gap: 6 }}>
                          <Skeleton width="55%" height={16} />
                          <Skeleton width={78} height={11} />
                          <Skeleton width={104} height={12} />
                        </View>
                      </View>
                      <Skeleton width="90%" height={12} />
                    </View>
                  ))}
                </View>
              ) : (
                <View style={[styles.empty, { paddingTop: space.huge, gap: space.sm }]}>
                  <View style={[styles.emptyIcon, { backgroundColor: colors.muted, borderRadius: radius.pill }]}>
                    <Feather name="search" size={28} color={colors.inkFaint} />
                  </View>
                  <Text style={[t.title3, { color: colors.foreground }]}>{teacherLoadFailed ? "Could not load teachers" : "No teachers found"}</Text>
                  <Text style={[t.callout, { color: colors.mutedForeground, textAlign: "center" }]}>
                    {teacherLoadFailed ? "Check your connection and try again." : isSearching
                      ? "Try a different keyword, subject, or widen your filters."
                      : "No teachers have been approved yet. Please check back soon."}
                  </Text>
                  {(teacherLoadFailed || activeFilterCount > 0 || subject !== "All" || !!search) && (
                    <TouchableOpacity
                      style={[styles.clearBtn, { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: space.lg }]}
                      onPress={() => { if (teacherLoadFailed) { void loadTeachers(); return; } setFilters(DEFAULT_FILTERS); setSubject("All"); setSearch(""); }}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                    >
                      <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>{teacherLoadFailed ? "Try again" : "Clear all filters"}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )
            }
          />

          <Modal visible={showSort} transparent animationType="slide" onRequestClose={() => setShowSort(false)}>
            <TouchableOpacity style={[styles.overlay, { backgroundColor: colors.scrim }]} activeOpacity={1} onPress={() => setShowSort(false)} />
            <View
              style={[
                styles.sheet,
                { backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: gutter, paddingBottom: insets.bottom + space.md },
                elevation.modal,
              ]}
            >
              <View style={[styles.sheetHandle, { backgroundColor: colors.lineStrong, borderRadius: radius.pill }]} />
              <Text style={[t.title2, { color: colors.foreground, marginBottom: space.sm }]}>Sort by</Text>
              {SORT_OPTIONS.map((opt) => {
                const on = sortKey === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.sheetRow,
                      { borderRadius: radius.sm, paddingHorizontal: space.sm, gap: space.sm, backgroundColor: on ? colors.actionSoft : "transparent" },
                    ]}
                    onPress={() => { setSortKey(opt.key); setShowSort(false); Haptics.selectionAsync(); }}
                    activeOpacity={0.7}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Feather name={opt.icon as "star"} size={18} color={on ? colors.primary : colors.inkFaint} />
                    <Text style={[t.body, { color: on ? colors.primary : colors.foreground, flex: 1 }]}>
                      {opt.label}
                    </Text>
                    {on && <Feather name="check" size={16} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </Modal>

          <Modal visible={showFilter} transparent animationType="slide" onRequestClose={() => setShowFilter(false)}>
            <TouchableOpacity style={[styles.overlay, { backgroundColor: colors.scrim }]} activeOpacity={1} onPress={() => setShowFilter(false)} />
            <View
              style={[
                styles.sheet,
                styles.filterSheet,
                { backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: gutter, paddingBottom: insets.bottom + space.md },
                elevation.modal,
              ]}
            >
              <View style={[styles.sheetHandle, { backgroundColor: colors.lineStrong, borderRadius: radius.pill }]} />
              <View style={[styles.filterHeader, { marginBottom: space.sm }]}>
                <Text style={[t.title2, { color: colors.foreground }]}>Filters</Text>
                <TouchableOpacity onPress={resetFilters} activeOpacity={0.7} accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={[t.bodyStrong, { color: colors.primary }]}>Reset all</Text>
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={[t.overline, { color: colors.inkFaint, marginBottom: space.xs }]}>District</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs, paddingBottom: space.xxs }}>
                  {DISTRICTS.map((d) => {
                    const on = draftFilters.district === d;
                    return (
                      <TouchableOpacity
                        key={d}
                        style={[
                          styles.chip,
                          { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.border, borderRadius: radius.pill, paddingHorizontal: space.sm },
                        ]}
                        onPress={() => setDraftFilters((f) => ({ ...f, district: d }))}
                        activeOpacity={0.7}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[t.caption, { color: on ? colors.primaryForeground : colors.mutedForeground }]}>{d}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <Text style={[t.overline, { color: colors.inkFaint, marginTop: space.md, marginBottom: space.xs }]}>
                  Minimum rating
                </Text>
                <View style={[styles.wrapRow, { gap: space.xs }]}>
                  {[0, 4.0, 4.3, 4.5, 4.7].map((r) => {
                    const on = draftFilters.minRating === r;
                    return (
                      <TouchableOpacity
                        key={r}
                        style={[
                          styles.pickBtn,
                          { backgroundColor: on ? colors.actionSoft : colors.surface, borderColor: on ? colors.primary : colors.border, borderRadius: radius.xs, paddingHorizontal: space.sm },
                        ]}
                        onPress={() => setDraftFilters((f) => ({ ...f, minRating: r }))}
                        activeOpacity={0.7}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        {r > 0 && <Feather name="star" size={12} color={on ? colors.primary : colors.inkFaint} />}
                        <Text style={[t.caption, numeric, { color: on ? colors.primary : colors.mutedForeground }]}>
                          {r === 0 ? "Any" : `${r}+`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={[t.overline, { color: colors.inkFaint, marginTop: space.md, marginBottom: space.xs }]}>
                  Most you would pay per class
                </Text>
                <View style={[styles.wrapRow, { gap: space.xs }]}>
                  {([null, 300, 450, 600] as (number | null)[]).map((p) => {
                    const on = draftFilters.maxPrice === p;
                    return (
                      <TouchableOpacity
                        key={p ?? "any"}
                        style={[
                          styles.pickBtn,
                          { backgroundColor: on ? colors.actionSoft : colors.surface, borderColor: on ? colors.primary : colors.border, borderRadius: radius.xs, paddingHorizontal: space.sm },
                        ]}
                        onPress={() => setDraftFilters((f) => ({ ...f, maxPrice: p }))}
                        activeOpacity={0.7}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[t.caption, numeric, { color: on ? colors.primary : colors.mutedForeground }]}>
                          {p === null ? "Any" : `NPR ${p} or less`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              <TouchableOpacity
                style={[styles.applyBtn, { backgroundColor: colors.primary, borderRadius: radius.sm, marginTop: space.md }, elevation.card]}
                onPress={applyFilters}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                <Text style={[t.bodyStrong, { color: colors.primaryForeground }]}>
                  Show {filtered.length} {filtered.length === 1 ? "teacher" : "teachers"}
                </Text>
              </TouchableOpacity>
            </View>
          </Modal>
        </>
      )}
    </View>
  );
}

/**
 * The Single Classes view. Server-side search on submit; deterministic pagination; a
 * pagination failure keeps successful cards on screen; every card carries a "View & book"
 * action that opens the class on the teacher's page, where the existing Book & Pay flow lives.
 */
function ClassesView(props: {
  rows: PublicClass[];
  hasMore: boolean;
  initialLoad: boolean;
  loadingMore: boolean;
  initialError: string | null;
  paginationError: string | null;
  typedQuery: string;
  submittedQuery: string;
  onQueryChange: (next: string) => void;
  onSubmit: (query: string) => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onOpen: (row: PublicClass) => void;
}) {
  const { rows, hasMore, initialLoad, loadingMore, initialError, paginationError,
    typedQuery, submittedQuery, onQueryChange, onSubmit, onRetry, onLoadMore, onOpen } = props;
  const colors = useColors();
  const { t, gutter, space, radius, isCompact } = useLayout();
  const insets = useSafeAreaInsets();

  const state = publicClassListState({
    initialLoad, loadedRows: rows, hasMore, initialError, paginationError,
    submittedQuery,
  });

  return (
    <ScrollView
      testID="single-classes-scroll"
      contentContainerStyle={{
        paddingHorizontal: gutter, paddingTop: space.md,
        paddingBottom: insets.bottom + bottomNavClearance, gap: space.md,
        width: "100%",
        maxWidth: marketplaceColumnMax,
        alignSelf: "center",
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={{
          flexDirection: isCompact ? "column" : "row",
          alignItems: isCompact ? "stretch" : "center",
          gap: space.xs,
        }}
      >
        <View
          style={{
            flexDirection: "row", alignItems: "center", gap: space.xs,
            backgroundColor: colors.surfaceSunk, borderRadius: radius.sm,
            paddingHorizontal: space.sm, paddingVertical: space.xs,
            minHeight: HIT_SLOP_MIN, flex: 1,
          }}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            testID="single-classes-search"
            value={typedQuery}
            onChangeText={onQueryChange}
            placeholder="Search a subject, topic or teacher"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="search"
            onSubmitEditing={() => onSubmit(typedQuery)}
            accessibilityLabel="Search classes"
            style={[t.body, { flex: 1, color: colors.foreground, minHeight: HIT_SLOP_MIN, paddingVertical: space.xs }]}
          />
          {typedQuery.length > 0 ? (
            <Pressable
              testID="single-classes-clear"
              onPress={() => { onQueryChange(""); onSubmit(""); }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              style={{
                minWidth: HIT_SLOP_MIN, minHeight: HIT_SLOP_MIN,
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          testID="single-classes-search-submit"
          onPress={() => onSubmit(typedQuery)}
          accessibilityRole="button"
          accessibilityLabel="Search classes"
          style={{
            minWidth: HIT_SLOP_MIN, minHeight: HIT_SLOP_MIN,
            alignItems: "center", justifyContent: "center",
            paddingHorizontal: space.md,
            alignSelf: isCompact ? "stretch" : "auto",
            borderRadius: radius.sm,
            backgroundColor: colors.primary,
          }}
        >
          <Text style={[t.bodyStrong, { color: colors.onInverse }]}>Search</Text>
        </Pressable>
      </View>

      {state.kind === "loading" ? (
        <View testID="single-classes-loading" style={{ gap: space.sm }}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{
                height: space.xxxl * 3, borderRadius: radius.md,
                backgroundColor: colors.muted, opacity: 0.55,
              }}
            />
          ))}
        </View>
      ) : state.kind === "error" ? (
        <View
          testID="single-classes-failure"
          accessibilityRole="alert"
          style={{
            padding: space.lg, backgroundColor: colors.card, borderRadius: radius.md,
            borderWidth: 1, borderColor: colors.border, gap: space.sm,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Feather name="alert-circle" size={18} color={colors.warn} />
            <Text style={[t.title3, { color: colors.foreground }]}>Could not load classes</Text>
          </View>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>{state.message}</Text>
          <Pressable
            testID="single-classes-retry"
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Try loading classes again"
            style={{
              minHeight: HIT_SLOP_MIN,
              alignSelf: "flex-start",
              paddingHorizontal: space.md, paddingVertical: space.xs,
              borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary,
              backgroundColor: colors.card,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Text style={[t.bodyStrong, { color: colors.primary }]}>Try again</Text>
          </Pressable>
        </View>
      ) : state.kind === "empty" ? (
        <View
          testID="single-classes-empty"
          style={{
            padding: space.lg, backgroundColor: colors.card, borderRadius: radius.md,
            borderWidth: 1, borderColor: colors.border, gap: space.xs,
          }}
        >
          <Text style={[t.title3, { color: colors.foreground }]}>No classes yet</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>
            Teachers on Fadko have not scheduled any single classes right now. Tap Programs for
            full journeys, or Teachers to browse who is on Fadko.
          </Text>
        </View>
      ) : state.kind === "noMatch" ? (
        <View
          testID="single-classes-nomatch"
          style={{
            padding: space.lg, backgroundColor: colors.card, borderRadius: radius.md,
            borderWidth: 1, borderColor: colors.border, gap: space.xs,
          }}
        >
          <Text style={[t.title3, { color: colors.foreground }]}>No matching classes</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>
            {`No scheduled class on Fadko matches “${state.query}”. Try different words.`}
          </Text>
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          {state.rows.map((row) => (
            <PublicClassCard
              key={row.id}
              testID={`public-class-${row.id}`}
              fields={publicClassCard(row)}
              dateIso={row.date}
              onPress={() => onOpen(row)}
            />
          ))}
          {state.hasMore ? (
            <View style={{ gap: space.xs }}>
              <Pressable
                testID="single-classes-more"
                onPress={onLoadMore}
                accessibilityRole="button"
                accessibilityLabel="Show more classes"
                disabled={loadingMore}
                aria-busy={loadingMore}
                aria-disabled={loadingMore}
                style={{
                  minHeight: HIT_SLOP_MIN,
                  borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary,
                  backgroundColor: colors.card,
                  alignItems: "center", justifyContent: "center",
                  paddingHorizontal: space.md, paddingVertical: space.xs,
                  opacity: loadingMore ? 0.6 : 1,
                }}
              >
                <Text style={[t.bodyStrong, { color: colors.primary }]}>
                  {loadingMore ? "Loading…" : "Show more classes"}
                </Text>
              </Pressable>
              {state.paginationError !== null ? (
                <View
                  testID="single-classes-more-error"
                  accessibilityRole="alert"
                  style={{
                    flexDirection: "row", alignItems: "center", gap: space.xs,
                    padding: space.sm, borderRadius: radius.sm,
                    borderWidth: 1, borderColor: colors.border,
                    backgroundColor: colors.warnSoft,
                  }}
                >
                  <Feather name="alert-circle" size={16} color={colors.warn} />
                  <Text style={[t.caption, { flex: 1, color: colors.foreground }]}>
                    {state.paginationError}
                  </Text>
                  <Pressable
                    testID="single-classes-more-retry"
                    onPress={onLoadMore}
                    accessibilityRole="button"
                    accessibilityLabel="Try loading more classes again"
                    disabled={loadingMore}
                    style={{
                      minHeight: HIT_SLOP_MIN, minWidth: HIT_SLOP_MIN,
                      paddingHorizontal: space.sm,
                      alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <Text style={[t.bodyStrong, { color: colors.primary }]}>Try again</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

/** Structure only. Colour, spacing, radius and type arrive from the hooks at render time. */
const styles = StyleSheet.create({
  header: { borderBottomWidth: StyleSheet.hairlineWidth },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  bellBtn: { width: 44, height: 44, borderWidth: 1, justifyContent: "center", alignItems: "center" },
  bellBadge: {
    position: "absolute", top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9,
    borderWidth: 2, justifyContent: "center", alignItems: "center", paddingHorizontal: 3,
  },
  badgeText: { letterSpacing: 0, textTransform: "none" },

  subTabs: { flexDirection: "row" },
  subTab: { flex: 1, alignItems: "center", borderWidth: 1, paddingVertical: 9, minHeight: 44, justifyContent: "center" },

  searchBar: { flexDirection: "row", alignItems: "center", borderWidth: StyleSheet.hairlineWidth },
  chip: { borderWidth: StyleSheet.hairlineWidth, paddingVertical: 7, justifyContent: "center" },

  toolRow: { flexDirection: "row", alignItems: "center" },
  toolBtn: { flexDirection: "row", alignItems: "center", borderWidth: StyleSheet.hairlineWidth, paddingVertical: 8, maxWidth: 190, minHeight: 36 },
  filterBadge: { minWidth: 18, height: 18, justifyContent: "center", alignItems: "center", paddingHorizontal: 4 },

  monthlyEntry: { flexDirection: "row", alignItems: "center", borderWidth: 1 },
  monthlyIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  monthlyTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  billingTag: { paddingHorizontal: 7, paddingVertical: 3 },

  sectionHeader: { flexDirection: "row", alignItems: "center" },

  skelCard: { borderWidth: StyleSheet.hairlineWidth },
  empty: { alignItems: "center", paddingHorizontal: 24 },
  emptyIcon: { width: 68, height: 68, justifyContent: "center", alignItems: "center" },
  clearBtn: { paddingVertical: 12, marginTop: 4, minHeight: 48, justifyContent: "center" },

  overlay: { flex: 1 },
  sheet: { paddingTop: 12 },
  filterSheet: { maxHeight: "85%" },
  sheetHandle: { width: 40, height: 4, alignSelf: "center", marginBottom: 12 },
  sheetRow: { flexDirection: "row", alignItems: "center", paddingVertical: 13, marginBottom: 4, minHeight: 48 },

  filterHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  wrapRow: { flexDirection: "row", flexWrap: "wrap" },
  pickBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, paddingVertical: 9, minHeight: 40 },
  applyBtn: { paddingVertical: 15, alignItems: "center", minHeight: 52, justifyContent: "center" },
});
