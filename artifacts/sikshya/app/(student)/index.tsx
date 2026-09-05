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

  /** Which half of Discover is showing: everybody, or just the teachers you follow. */
  const [view, setView] = useState<"discover" | "following">("discover");
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
            <Text style={[t.title1, { color: colors.foreground }]}>Find a teacher</Text>
            {loadingTeachers ? (
              <View style={{ marginTop: 4 }}><Skeleton width={168} height={13} /></View>
            ) : (
              <Text style={[t.caption, numeric, { color: colors.mutedForeground, marginTop: 2 }]}>
                {teacherTotal === null
                  ? "Browse teachers across Nepal"
                  : `${teacherTotal} verified ${teacherTotal === 1 ? "teacher" : "teachers"} across Nepal`}
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
          Two ways to arrive at a teacher, side by side.

          The owner asked for "Teachers You Follow" to move here from Profile and to sit in a
          sub-tab of its own. Finding somebody new and going back to somebody you already like
          are the same errand, and the second one was buried at the bottom of a settings screen.
        */}
        <View style={[styles.subTabs, { gap: space.xs }]}>
          {([
            { id: "discover", label: "Discover" },
            { id: "following", label: "Following" },
          ] as const).map((tab) => {
            const active = view === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                testID={`discover-subtab-${tab.id}`}
                onPress={() => setView(tab.id)}
                activeOpacity={0.75}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
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

        {/* Searching, filtering and sorting are Discover's; Following is just a list. */}
        {view === "discover" && (
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
                style={[t.body, { flex: 1, color: colors.foreground, paddingVertical: space.sm }]}
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

      {view === "following" ? (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
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
  subTab: { flex: 1, alignItems: "center", borderWidth: 1, paddingVertical: 9, minHeight: 42, justifyContent: "center" },

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
