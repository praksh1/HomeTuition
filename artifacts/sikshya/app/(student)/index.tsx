import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import FollowedTeachers from "@/components/FollowedTeachers";
import { useNotifications } from "@/context/NotificationContext";
import { apiGet } from "@/utils/api";
import { matches as matchesSearch, score as searchScore } from "@/utils/search";
import TeacherCard from "@/components/TeacherCard";
import type { Teacher } from "@/context/AuthContext";

const SUBJECTS = ["All", "Mathematics", "Science", "English", "Nepali", "Computer Science", "History", "Geography"];

const DISTRICTS = ["All Districts", "Kathmandu", "Lalitpur", "Bhaktapur", "Kaski", "Chitwan", "Morang", "Sunsari", "Rupandehi"];

type SortKey = "rating" | "students" | "price_asc" | "price_desc" | "experience";
const SORT_OPTIONS: { key: SortKey; label: string; icon: string }[] = [
  { key: "rating", label: "Highest Rated", icon: "star" },
  { key: "students", label: "Most Students", icon: "users" },
  { key: "price_asc", label: "Price: Low to High", icon: "trending-up" },
  { key: "price_desc", label: "Price: High to Low", icon: "trending-down" },
  { key: "experience", label: "Most Experienced", icon: "award" },
];

interface Filters {
  district: string;
  minRating: number;
  maxPrice: number | null;
  onlineOnly: boolean;
}

const DEFAULT_FILTERS: Filters = {
  district: "All Districts",
  minRating: 0,
  maxPrice: null,
  onlineOnly: false,
};

export default function Discover() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { unreadCount } = useNotifications();

  /** Which half of Discover is showing: everybody, or just the teachers you follow. */
  const [view, setView] = useState<"discover" | "following">("discover");
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("All");
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  /**
   * True until the first fetch answers.
   *
   * Without it this screen said "No teachers found — try a different keyword" for the second
   * or two before anyone arrived, which is not merely blank but wrong: it blames the student
   * for a search that has not run yet.
   */
  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("rating");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showSort, setShowSort] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [draftFilters, setDraftFilters] = useState<Filters>(DEFAULT_FILTERS);

  useFocusEffect(
    useCallback(() => {
      loadTeachers();
    }, [])
  );

  const loadTeachers = async () => {
    try {
      const res = await apiGet<{ teachers: Teacher[]; total: number }>("/teachers?limit=200");
      setTeachers(res.teachers.map((t: Teacher) => ({ ...t, credentials: [] })));
    } catch (_e) {
      setTeachers([]);
    } finally {
      setLoadingTeachers(false);
    }
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.district !== "All Districts") count++;
    if (filters.minRating > 0) count++;
    if (filters.maxPrice !== null) count++;
    if (filters.onlineOnly) count++;
    return count;
  }, [filters]);

  const filtered = useMemo(() => {
    const q = search.trim();
    let result = teachers.filter((t) => {
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
          t.name,
          t.subject,
          t.bio,
          t.location ?? "",
          t.district ?? "",
          ...(t.subjects ?? []),
          ...(t.languages ?? []),
        ];
        if (!fields.some((field) => matchesSearch(field, q))) return false;
      }
      if (subject !== "All" && t.subject !== subject) return false;
      if (filters.district !== "All Districts" && t.district !== filters.district) return false;
      if (filters.minRating > 0 && t.rating < filters.minRating) return false;
      if (filters.maxPrice !== null && (t.pricePerSession ?? 0) > filters.maxPrice) return false;
      if (filters.onlineOnly && !t.isOnline) return false;
      return true;
    });

    // A search is itself a ranking. Sorting by rating while someone is typing a name buries
    // the person they asked for under whoever happens to be rated highest.
    if (q) {
      const rank = (t: Teacher) =>
        searchScore(
          [
            { value: t.name, weight: 4 },
            { value: t.subject, weight: 2 },
            { value: (t.subjects ?? []).join(" "), weight: 2 },
            { value: t.district ?? "", weight: 2 },
            { value: t.location ?? "", weight: 1 },
            { value: t.bio, weight: 1 },
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

  const topPick = filtered.length > 0 ? filtered[0] : null;
  const restTeachers = filtered.length > 1 ? filtered.slice(1) : filtered;
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 16, borderBottomColor: colors.border }]}>
        <View style={styles.titleRow}>
          <View>
            <Text style={[styles.title, { color: colors.foreground }]}>Find Teachers</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {teachers.length} verified teachers across Nepal
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.bellBtn, { borderColor: colors.border }]}
            onPress={() => router.push("/notifications")}
            activeOpacity={0.7}
          >
            <Feather name="bell" size={20} color={colors.foreground} />
            {unreadCount > 0 && (
              <View style={[styles.bellBadge, { backgroundColor: colors.secondary }]}>
                <Text style={styles.bellBadgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
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
        <View style={styles.subTabs}>
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
                style={[
                  styles.subTab,
                  {
                    borderColor: active ? colors.secondary : colors.border,
                    backgroundColor: active ? colors.secondary + "12" : colors.muted,
                  },
                ]}
              >
                <Text style={[styles.subTabText, { color: active ? colors.secondary : colors.mutedForeground }]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Searching, filtering and sorting are Discover's; Following is just a list. */}
        {view === "discover" && (
          <>
          {/* Search bar */}
          <View style={[styles.searchBar, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Feather name="search" size={17} color={colors.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="Search name, subject, location, keyword..."
              placeholderTextColor={colors.mutedForeground}
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
            />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>

          {/* Subject chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {SUBJECTS.map((s) => (
              <TouchableOpacity
                key={s}
                style={[
                  styles.chip,
                  {
                    backgroundColor: subject === s ? colors.secondary : colors.muted,
                    borderColor: subject === s ? colors.secondary : colors.border,
                  },
                ]}
                onPress={() => { setSubject(s); Haptics.selectionAsync(); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, { color: subject === s ? "#fff" : colors.mutedForeground }]}>
                  {s}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Sort + Filter row */}
          <View style={styles.toolRow}>
            <TouchableOpacity
              style={[styles.toolBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
              onPress={() => setShowSort(true)}
              activeOpacity={0.7}
            >
              <Feather name="bar-chart-2" size={14} color={colors.foreground} />
              <Text style={[styles.toolBtnText, { color: colors.foreground }]} numberOfLines={1}>
                {currentSortLabel}
              </Text>
              <Feather name="chevron-down" size={13} color={colors.mutedForeground} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.toolBtn,
                {
                  backgroundColor: activeFilterCount > 0 ? colors.primary + "12" : colors.muted,
                  borderColor: activeFilterCount > 0 ? colors.primary + "40" : colors.border,
                },
              ]}
              onPress={openFilter}
              activeOpacity={0.7}
            >
              <Feather name="sliders" size={14} color={activeFilterCount > 0 ? colors.primary : colors.foreground} />
              <Text style={[styles.toolBtnText, { color: activeFilterCount > 0 ? colors.primary : colors.foreground }]}>
                Filters
              </Text>
              {activeFilterCount > 0 && (
                <View style={[styles.filterBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                </View>
              )}
            </TouchableOpacity>

            <Text style={[styles.resultCount, { color: colors.mutedForeground }]}>
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
      {/* ── List ── */}
      <FlatList
        data={isSearching ? filtered : restTeachers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          !isSearching && topPick ? (
            <View style={styles.featuredSection}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionDot, { backgroundColor: colors.accent }]} />
                <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Top Pick</Text>
              </View>
              <TouchableOpacity
                onPress={() => router.push(`/(student)/teacher/${topPick.id}`)}
                activeOpacity={0.85}
                style={[styles.featuredCard, { backgroundColor: colors.secondary, borderColor: colors.secondary }]}
              >
                <View style={styles.featuredInner}>
                  <View style={[styles.featuredAvatar, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
                    <Text style={styles.featuredInitials}>
                      {topPick.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                    </Text>
                    {topPick.isOnline && (
                      <View style={[styles.featuredOnline, { backgroundColor: "#22C55E", borderColor: colors.secondary }]} />
                    )}
                  </View>
                  <View style={styles.featuredInfo}>
                    <View style={styles.featuredNameRow}>
                      <Text style={styles.featuredName}>{topPick.name}</Text>
                      <Feather name="check-circle" size={14} color="rgba(255,255,255,0.8)" />
                    </View>
                    <Text style={styles.featuredSubject}>{topPick.subject}</Text>
                    <Text style={styles.featuredBio} numberOfLines={2}>{topPick.bio}</Text>
                    <View style={styles.featuredMeta}>
                      <View style={styles.featuredStat}>
                        <Feather name="star" size={12} color="#F5A623" />
                        <Text style={styles.featuredStatText}>{topPick.rating.toFixed(1)} ({topPick.reviewCount})</Text>
                      </View>
                      <View style={styles.featuredStat}>
                        <Feather name="map-pin" size={12} color="rgba(255,255,255,0.7)" />
                        <Text style={styles.featuredStatText}>{topPick.location}</Text>
                      </View>
                      {topPick.pricePerSession != null && (
                        <View style={styles.featuredStat}>
                          <Feather name="tag" size={12} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.featuredStatText}>NPR {topPick.pricePerSession}/session</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              </TouchableOpacity>

              <View style={[styles.sectionHeader, { marginTop: 20 }]}>
                <View style={[styles.sectionDot, { backgroundColor: colors.primary }]} />
                <Text style={[styles.sectionLabel, { color: colors.foreground }]}>All Teachers</Text>
              </View>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <TeacherCard
            teacher={item}
            onPress={() => router.push(`/(student)/teacher/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          loadingTeachers ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Finding teachers…
              </Text>
            </View>
          ) : (
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
              <Feather name="search" size={32} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No teachers found</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Try a different keyword, subject, or adjust your filters
            </Text>
            {(activeFilterCount > 0 || subject !== "All") && (
              <TouchableOpacity
                style={[styles.clearBtn, { backgroundColor: colors.primary }]}
                onPress={() => { setFilters(DEFAULT_FILTERS); setSubject("All"); setSearch(""); }}
                activeOpacity={0.8}
              >
                <Text style={styles.clearBtnText}>Clear all filters</Text>
              </TouchableOpacity>
            )}
          </View>
          )
        }
      />

      {/* ── Sort Modal ── */}
      <Modal visible={showSort} transparent animationType="slide" onRequestClose={() => setShowSort(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowSort(false)} />
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Sort By</Text>
          {SORT_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[
                styles.sheetRow,
                sortKey === opt.key && { backgroundColor: colors.primary + "10" },
              ]}
              onPress={() => { setSortKey(opt.key); setShowSort(false); Haptics.selectionAsync(); }}
              activeOpacity={0.7}
            >
              <Feather name={opt.icon as "star"} size={18} color={sortKey === opt.key ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.sheetRowText, { color: sortKey === opt.key ? colors.primary : colors.foreground }]}>
                {opt.label}
              </Text>
              {sortKey === opt.key && <Feather name="check" size={16} color={colors.primary} style={{ marginLeft: "auto" }} />}
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      {/* ── Filter Modal ── */}
      <Modal visible={showFilter} transparent animationType="slide" onRequestClose={() => setShowFilter(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowFilter(false)} />
        <View style={[styles.sheet, styles.filterSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
          <View style={styles.filterHeader}>
            <Text style={[styles.sheetTitle, { color: colors.foreground, marginBottom: 0 }]}>Filters</Text>
            <TouchableOpacity onPress={resetFilters} activeOpacity={0.7}>
              <Text style={[styles.resetText, { color: colors.primary }]}>Reset all</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* District */}
            <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>District</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChips}>
              {DISTRICTS.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: draftFilters.district === d ? colors.secondary : colors.muted,
                      borderColor: draftFilters.district === d ? colors.secondary : colors.border,
                    },
                  ]}
                  onPress={() => setDraftFilters((f) => ({ ...f, district: d }))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.filterChipText, { color: draftFilters.district === d ? "#fff" : colors.mutedForeground }]}>
                    {d}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Min rating */}
            <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>Minimum Rating</Text>
            <View style={styles.ratingBtns}>
              {[0, 4.0, 4.3, 4.5, 4.7].map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[
                    styles.ratingBtn,
                    {
                      backgroundColor: draftFilters.minRating === r ? colors.accent + "20" : colors.muted,
                      borderColor: draftFilters.minRating === r ? colors.accent : colors.border,
                    },
                  ]}
                  onPress={() => setDraftFilters((f) => ({ ...f, minRating: r }))}
                  activeOpacity={0.7}
                >
                  {r === 0 ? (
                    <Text style={[styles.ratingBtnText, { color: draftFilters.minRating === r ? colors.accent : colors.mutedForeground }]}>Any</Text>
                  ) : (
                    <View style={styles.ratingBtnInner}>
                      <Feather name="star" size={12} color={draftFilters.minRating === r ? colors.accent : colors.mutedForeground} />
                      <Text style={[styles.ratingBtnText, { color: draftFilters.minRating === r ? colors.accent : colors.mutedForeground }]}>{r}+</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Max price */}
            <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>Max Price per Session</Text>
            <View style={styles.ratingBtns}>
              {([null, 300, 450, 600] as (number | null)[]).map((p) => (
                <TouchableOpacity
                  key={p ?? "any"}
                  style={[
                    styles.ratingBtn,
                    {
                      backgroundColor: draftFilters.maxPrice === p ? colors.primary + "15" : colors.muted,
                      borderColor: draftFilters.maxPrice === p ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setDraftFilters((f) => ({ ...f, maxPrice: p }))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.ratingBtnText, { color: draftFilters.maxPrice === p ? colors.primary : colors.mutedForeground }]}>
                    {p === null ? "Any" : `≤NPR ${p}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Online only */}
            <TouchableOpacity
              style={[styles.toggleRow, { borderColor: colors.border }]}
              onPress={() => setDraftFilters((f) => ({ ...f, onlineOnly: !f.onlineOnly }))}
              activeOpacity={0.7}
            >
              <View>
                <Text style={[styles.toggleLabel, { color: colors.foreground }]}>Online Now Only</Text>
                <Text style={[styles.toggleSub, { color: colors.mutedForeground }]}>Show only teachers currently available online</Text>
              </View>
              <View style={[styles.toggle, { backgroundColor: draftFilters.onlineOnly ? "#22C55E" : colors.muted, borderColor: draftFilters.onlineOnly ? "#22C55E" : colors.border }]}>
                <View style={[styles.toggleThumb, { marginLeft: draftFilters.onlineOnly ? 16 : 2 }]} />
              </View>
            </TouchableOpacity>
          </ScrollView>

          <TouchableOpacity
            style={[styles.applyBtn, { backgroundColor: colors.primary }]}
            onPress={applyFilters}
            activeOpacity={0.85}
          >
            <Text style={styles.applyBtnText}>
              Apply Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, gap: 12, paddingBottom: 12, borderBottomWidth: 1 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  bellBtn: { width: 42, height: 42, borderRadius: 12, borderWidth: 1, justifyContent: "center", alignItems: "center" },
  bellBadge: { position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, justifyContent: "center", alignItems: "center", paddingHorizontal: 3 },
  bellBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 13 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  subTabs: { flexDirection: "row", gap: 8, marginBottom: 12 },
  subTab: { flex: 1, alignItems: "center", borderRadius: 12, borderWidth: 1, paddingVertical: 9 },
  subTabText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  toolRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  toolBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, maxWidth: 180 },
  toolBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  filterBadge: { width: 16, height: 16, borderRadius: 8, justifyContent: "center", alignItems: "center" },
  filterBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
  resultCount: { fontSize: 12, fontFamily: "Inter_400Regular", marginLeft: "auto" },
  list: { paddingHorizontal: 20, paddingTop: 16 },

  featuredSection: { marginBottom: 4 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },

  featuredCard: { borderRadius: 20, borderWidth: 1, padding: 18, marginBottom: 4 },
  featuredInner: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  featuredAvatar: { width: 60, height: 60, borderRadius: 30, justifyContent: "center", alignItems: "center", position: "relative" },
  featuredInitials: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  featuredOnline: { position: "absolute", bottom: 1, right: 1, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  featuredInfo: { flex: 1, gap: 5 },
  featuredNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  featuredName: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  featuredSubject: { fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.75)" },
  featuredBio: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)", lineHeight: 18 },
  featuredMeta: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  featuredStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  featuredStatText: { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.85)" },

  empty: { alignItems: "center", paddingTop: 64, gap: 12, paddingHorizontal: 40 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, justifyContent: "center", alignItems: "center" },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21 },
  clearBtn: { borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, marginTop: 4 },
  clearBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingHorizontal: 20, gap: 4 },
  filterSheet: { maxHeight: "85%" },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 12 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 16 },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12, marginBottom: 4 },
  sheetRowText: { fontSize: 15, fontFamily: "Inter_500Medium" },

  filterHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  resetText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  filterLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.7, marginTop: 16, marginBottom: 10 },
  filterChips: { gap: 8, paddingBottom: 4 },
  filterChip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  filterChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  ratingBtns: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  ratingBtn: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  ratingBtnInner: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 16 },
  toggleLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  toggleSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  toggle: { width: 44, height: 26, borderRadius: 13, borderWidth: 1, justifyContent: "center" },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  applyBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 16 },
  applyBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
