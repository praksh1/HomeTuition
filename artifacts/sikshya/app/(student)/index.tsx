import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { HIT_SLOP_MIN } from "@/constants/layout";
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
import SessionCard from "@/components/SessionCard";
import ProgramDiscoverList from "@/components/programs/ProgramDiscoverList";
import {
  appendPage,
  DISCOVER_SEARCH_PROMPT,
  DISCOVER_TABS,
  TEACHERS_TABS,
  type DiscoverView,
  type ProgramType,
  type PublicProgramSummary,
  type TeachersView,
} from "@/utils/programDiscovery";
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

/** One single (non-monthly) class as `/sessions` returns it for browsing. */
interface ApiSingleClass {
  id: number;
  teacherName: string;
  subject: string;
  topic: string;
  date: string;
  duration: number;
  maxStudents: number;
  enrolledCount: number;
  price: number;
  status: string;
  expired?: boolean;
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
  const programRequestRef = React.useRef(0);

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
          // Do not wipe the already-loaded page. The retry sits beside "Show more" and the
          // cards on screen stay put.
          setProgramsMoreError(message);
        } else {
          // A first-load failure. Nothing was on screen, so the failure card is the screen.
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

  // First load, and whenever the primary type filter changes. Typing does *not* fetch on every
  // keystroke — the query only re-fetches when the student submits (the visible Search button or
  // the keyboard's return key), so a Nepali bus connection is not billed one call per letter.
  React.useEffect(() => {
    void loadPrograms({ type: programType, query: programQuery });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programType]);

  /* ---------------------------------------------------------- single classes --- */

  const [singleClasses, setSingleClasses] = useState<ApiSingleClass[]>([]);
  const [singleLoading, setSingleLoading] = useState(true);
  const [singleFailed, setSingleFailed] = useState(false);
  const [singleQuery, setSingleQuery] = useState("");

  const loadSingleClasses = useCallback(async () => {
    setSingleLoading(true);
    setSingleFailed(false);
    try {
      const res = await apiGet<{ sessions: ApiSingleClass[] }>(`/sessions?status=upcoming&limit=50`);
      /*
        The class must still be sellable. `expired` is the server's fact from the clock rather
        than from the row: a class whose `status` is still "upcoming" but whose booked slot has
        gone by should not appear as buyable, and — as noted on the teacher-details page — 19 of
        20 "upcoming" rows on the live site had already passed. Filter on the server's answer
        rather than re-computing here.
      */
      setSingleClasses((res.sessions ?? []).filter((s) => s.expired !== true));
    } catch {
      setSingleFailed(true);
      setSingleClasses([]);
    } finally {
      setSingleLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadSingleClasses(); }, [loadSingleClasses]));

  const filteredSingleClasses = useMemo(() => {
    const q = singleQuery.trim().toLowerCase();
    if (q === "") return singleClasses;
    return singleClasses.filter((s) =>
      [s.teacherName, s.subject, s.topic].some((field) =>
        (field ?? "").toLowerCase().includes(q),
      ),
    );
  }, [singleClasses, singleQuery]);

  /* --------------------------------------------------------------- teachers --- */

  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("All");
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  /**
   * How many approved teachers there are, as opposed to how many arrived in this page.
   *
   * The API caps pages at 100; loadTeacherDirectory follows its pagination so local search
   * covers the same directory as this total, including new unrated teachers on later pages.
   */
  const [teacherTotal, setTeacherTotal] = useState<number | null>(null);
  /**
   * True until the first fetch answers.
   *
   * Without it this screen said "No teachers found — try a different keyword" for the second
   * or two before anyone arrived, which is not merely blank but wrong: it blames the student
   * for a search that has not run yet.
   */
  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [teacherLoadFailed, setTeacherLoadFailed] = useState(false);
  /**
   * The monthly classes running right now.
   *
   * One public request, not one per teacher. It answers two questions this screen could not
   * answer before: how many monthly classes actually exist, and which teachers run one — so a
   * student can tell the two billing models apart before they tap rather than after.
   *
   * Null means we have not heard back. A teacher is never marked as *not* having a monthly
   * class on the strength of a request that failed.
   */
  const [monthly, setMonthly] = useState<MonthlyBrief[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("rating");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showSort, setShowSort] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [draftFilters, setDraftFilters] = useState<Filters>(DEFAULT_FILTERS);

  useFocusEffect(
    useCallback(() => {
      loadTeachers();
      loadMonthly();
    }, [])
  );

  const loadTeachers = async () => {
    setLoadingTeachers(true);
    setTeacherLoadFailed(false);
    try {
      const res = await loadTeacherDirectory<Teacher>(apiGet);
      setTeachers(res.teachers.map((t: Teacher) => ({ ...t, credentials: [] })));
      setTeacherTotal(res.total ?? res.teachers.length);
    } catch (_e) {
      setTeacherLoadFailed(true);
      setTeachers([]);
      setTeacherTotal(null);
    } finally {
      setLoadingTeachers(false);
    }
  };

  const loadMonthly = async () => {
    try {
      const res = await apiGet<{ classes: MonthlyBrief[] }>("/monthly/classes");
      setMonthly(res.classes ?? []);
    } catch {
      setMonthly(null);
    }
  };

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
        /**
         * Spacing carries no meaning in a search box.
         *
         * This was a plain substring match, so looking for "Ram Prasad" as `RamPrasad`,
         * `ram p rasa d` or `r ampr asad` — all reported — found nobody. See utils/search.ts.
         * Each field is offered separately rather than glued into one string, so a name match
         * can outrank a word that merely appears in a bio.
         */
        const fields = [
          teacher.name,
          teacher.email ?? "",
          teacher.subject,
          teacher.bio,
          teacher.location ?? "",
          teacher.district ?? "",
          ...(teacher.subjects ?? []),
          ...(teacher.languages ?? []),
        ];
        if (!fields.some((field) => matchesSearch(field, q))) return false;
      }
      if (subject !== "All" && teacher.subject !== subject) return false;
      if (filters.district !== "All Districts" && teacher.district !== filters.district) return false;
      if (filters.minRating > 0 && teacher.rating < filters.minRating) return false;
      if (filters.maxPrice !== null && (teacher.pricePerSession ?? 0) > filters.maxPrice) return false;
      return true;
    });

    // A search is itself a ranking. Sorting by rating while someone is typing a name buries
    // the person they asked for under whoever happens to be rated highest.
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

  /**
   * Only crown somebody the students have actually rated.
   *
   * "Top Pick" was `filtered[0]` — whoever sorted first. Before anybody has left a review every
   * teacher is rated zero, so the platform was picking a favourite at random and presenting it
   * as a recommendation, in the largest card on the storefront.
   */
  const topPick = filtered.length > 0 && filtered[0].reviewCount > 0 ? filtered[0] : null;
  const restTeachers = topPick ? filtered.slice(1) : filtered;
  const isSearching = !!search.trim() || subject !== "All" || activeFilterCount > 0;

  const openFilter = () => {
    setDraftFilters({ ...filters });
    setShowFilter(true);
  };

  const applyFilters = () => {
    setFilters({ ...draftFilters });
    setShowFilter(false);
  };

  const resetFilters = () => {
    setDraftFilters({ ...DEFAULT_FILTERS });
  };

  const currentSortLabel = SORT_OPTIONS.find((s) => s.key === sortKey)?.label ?? "Sort";

  const inTeachersAll = view === "teachers" && teachersView === "all";

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
            {/*
              Each view carries its own heading and one-line subtitle. Before this round the page
              always said "Find a teacher" and "197 verified teachers", whatever tab the student
              had picked — a page that says teacher-teacher-teacher while a Programs list is on
              screen is telling the student they are somewhere they are not. See `DISCOVER_TABS`
              in `utils/programDiscovery.ts`.
            */}
            <Text testID="discover-heading" style={[t.title1, { color: colors.foreground }]}>
              {currentTab.heading}
            </Text>
            {view === "teachers" ? (
              loadingTeachers ? (
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

        {/*
          The three primary product views, in the shape Codex approved: Programs, Classes,
          Teachers. Each pill uses the short `label` so the row fits at 390pt; the screen reader
          hears the full `accessibilityLabel` ("Single classes" rather than just "Classes").
        */}
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

        {/*
          The Teachers view has its own two sub-choices, All and Following. They sit *under*
          Teachers because a follow is a relationship with a teacher and belongs where teachers
          live. Codex correction round 1, item 1.
        */}
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
            paddingHorizontal: gutter, paddingTop: space.md, paddingBottom: insets.bottom + 100, gap: space.md,
            /*
              A readable column on a laptop, and nothing at all on a phone. Same 760pt cap the
              studio and teacher dashboard use — without it, cards stretch across a metre of screen
              and the page reads as an admin table rather than a learning surface.
            */
            width: "100%",
            maxWidth: 760,
            alignSelf: "center",
          }}
          keyboardShouldPersistTaps="handled"
        >
          <ProgramDiscoverList
            query={programQuery}
            onQueryChange={setProgramQuery}
            chosenType={programType}
            /*
              A chip tap is a new filter, and a new filter is a new fetch — the parent runs it.
              The comment in `ProgramDiscoverList` says the same thing; the two matching is
              Codex correction round 1, item 5.
            */
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
          classes={filteredSingleClasses}
          totalCount={singleClasses.length}
          loading={singleLoading}
          failed={singleFailed}
          query={singleQuery}
          onQueryChange={setSingleQuery}
          onRetry={() => void loadSingleClasses()}
          onOpen={(id) => router.push(`/session/${id}`)}
        />
      ) : view === "teachers" && teachersView === "following" ? (
        <ScrollView
          testID="teachers-following-scroll"
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        >
          <FollowedTeachers />
        </ScrollView>
      ) : (
        <>
          <FlatList
            data={isSearching ? filtered : restTeachers}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.md, paddingBottom: insets.bottom + 100 }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <>
                {/*
                  The two billing models, told apart before anybody taps.
                  ────────────────────────────────────────────────────────
                  Everything below this row is bought one class at a time. This row is the other
                  kind: bought once for a month of daily classes. They were previously
                  distinguished only by the word "Monthly" in a title, and a student who read
                  "NPR 3,000" on one and "NPR 500" on the other had no way to know that one was
                  a month and the other was an hour.

                  So the row wears the brand crimson and says its billing model in a badge, and
                  every price in the list below now carries "per class" in words.
                */}
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
              loadingTeachers ? (
                // Holds the shape of the cards that are coming, so nothing jumps into place.
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

          {/* ------------------------------------------------------------ sort sheet */}
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

          {/* ---------------------------------------------------------- filter sheet */}
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
 * The Single Classes view: real bookable classes from `/sessions`, one per row.
 *
 * Never invents a bookable class. If the fetch failed, the screen says it failed and offers a
 * retry; if nothing is running, it says so honestly rather than showing a made-up list. Tapping
 * a card opens the session page — the same route the Sessions screen uses — where the real
 * booking flow (payment, join window) lives.
 */
function ClassesView(props: {
  classes: ApiSingleClass[];
  totalCount: number;
  loading: boolean;
  failed: boolean;
  query: string;
  onQueryChange: (next: string) => void;
  onRetry: () => void;
  onOpen: (id: number) => void;
}) {
  const { classes, totalCount, loading, failed, query, onQueryChange, onRetry, onOpen } = props;
  const colors = useColors();
  const { t, gutter, space, radius } = useLayout();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      testID="single-classes-scroll"
      contentContainerStyle={{
        paddingHorizontal: gutter, paddingTop: space.md, paddingBottom: insets.bottom + 100, gap: space.md,
        width: "100%", maxWidth: 760, alignSelf: "center",
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={{
          flexDirection: "row", alignItems: "center", gap: space.xs,
          backgroundColor: colors.surfaceSunk, borderRadius: radius.sm,
          paddingHorizontal: space.sm, paddingVertical: space.xs,
          minHeight: HIT_SLOP_MIN,
        }}
      >
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          testID="single-classes-search"
          value={query}
          onChangeText={onQueryChange}
          placeholder={DISCOVER_SEARCH_PROMPT}
          placeholderTextColor={colors.mutedForeground}
          accessibilityLabel={DISCOVER_SEARCH_PROMPT}
          style={[t.body, { flex: 1, color: colors.foreground, minHeight: HIT_SLOP_MIN, paddingVertical: space.xs }]}
        />
        {query.length > 0 ? (
          <TouchableOpacity
            testID="single-classes-clear"
            onPress={() => onQueryChange("")}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            style={{
              minWidth: HIT_SLOP_MIN, minHeight: HIT_SLOP_MIN,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
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
      ) : failed ? (
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
          <Text style={[t.callout, { color: colors.mutedForeground }]}>
            Check your connection and try again.
          </Text>
          <TouchableOpacity
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
          </TouchableOpacity>
        </View>
      ) : totalCount === 0 ? (
        <View
          testID="single-classes-empty"
          style={{
            padding: space.lg, backgroundColor: colors.card, borderRadius: radius.md,
            borderWidth: 1, borderColor: colors.border, gap: space.xs,
          }}
        >
          <Text style={[t.title3, { color: colors.foreground }]}>No classes yet</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>
            Teachers have not scheduled any single classes right now. Tap Programs for full journeys,
            or Teachers to browse who is on Fadko.
          </Text>
        </View>
      ) : classes.length === 0 ? (
        <View
          testID="single-classes-nomatch"
          style={{
            padding: space.lg, backgroundColor: colors.card, borderRadius: radius.md,
            borderWidth: 1, borderColor: colors.border, gap: space.xs,
          }}
        >
          <Text style={[t.title3, { color: colors.foreground }]}>No matching classes</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>
            No scheduled class on Fadko matches “{query.trim()}”. Try different words.
          </Text>
        </View>
      ) : (
        classes.map((s) => (
          <SessionCard
            key={s.id}
            session={{
              id: String(s.id),
              teacherName: s.teacherName,
              subject: s.subject,
              topic: s.topic,
              date: s.date,
              duration: s.duration,
              maxStudents: s.maxStudents,
              enrolledStudents: Array(s.enrolledCount).fill(""),
              price: s.price,
              status: s.status as "upcoming" | "live" | "completed" | "cancelled",
            }}
            showTeacher
            onPress={() => onOpen(s.id)}
          />
        ))
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
  // The overline step carries uppercase and tracking; a counter needs neither.
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
