import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
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
import FollowedTeachers from "@/components/FollowedTeachers";
import TeacherFinder from "@/components/discovery/TeacherFinder";
import { useNotifications } from "@/context/NotificationContext";
import { apiGet } from "@/utils/api";
import ProgramDiscoverList from "@/components/programs/ProgramDiscoverList";
import PublicClassCard from "@/components/programs/PublicClassCard";
import {
  appendPage,
  DISCOVER_TABS,
  discoverIntentFor,
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
import type { PublicTeacher } from "@/utils/teacherDiscovery";

type ClassCatalogMode = "tuition" | "courses" | "single";

const CLASS_CATALOG_TABS: readonly { mode: ClassCatalogMode; label: string }[] = [
  { mode: "tuition", label: "Tuition classes" },
  { mode: "courses", label: "Exam, language & skills" },
  { mode: "single", label: "One-time lessons" },
];

export default function Discover() {
  const colors = useColors();
  const { t, gutter, space, radius } = useLayout();
  const insets = useSafeAreaInsets();
  const { unreadCount } = useNotifications();

  /**
   * Which of the three product views is showing.
   *
   * Programs, Single classes, Teachers — the shape Codex approved for this phase. Following used
   * to be one of the top-level tabs; it has moved back inside Teachers as a sub-choice, because a
   * follow is a relationship with a teacher and not a product category of its own.
   */
  const [view, setView] = useState<DiscoverView>("classes");

  /**
   * When Teachers is the primary view, which of its two sub-lists to show.
   */
  const [teachersView, setTeachersView] = useState<TeachersView>("all");

  const currentTab = useMemo(
    () => DISCOVER_TABS.find((tab) => tab.view === discoverIntentFor(view)) ?? DISCOVER_TABS[0],
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
        params.set("presentation", "program");
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
    if (view === "programs") void loadPrograms({ type: programType, query: programQuery });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, programType]);

  /* ----------------------------------------------------- tuition / short classes --- */

  const [classCatalogMode, setClassCatalogMode] = useState<ClassCatalogMode>("tuition");
  const [listedClasses, setListedClasses] = useState<PublicProgramSummary[]>([]);
  const [listedClassesCursor, setListedClassesCursor] = useState<string | null>(null);
  const [listedClassesLoading, setListedClassesLoading] = useState(true);
  const [listedClassesLoadingMore, setListedClassesLoadingMore] = useState(false);
  const [listedClassesInitialError, setListedClassesInitialError] = useState<string | null>(null);
  const [listedClassesMoreError, setListedClassesMoreError] = useState<string | null>(null);
  const [listedClassQuery, setListedClassQuery] = useState("");
  const [listedClassesLoadedOnce, setListedClassesLoadedOnce] = useState(false);
  const listedClassRequestRef = useRef(0);

  const loadListedClasses = useCallback(
    async (opts: { append?: boolean; query?: string } = {}) => {
      const append = opts.append === true;
      const q = opts.query !== undefined ? opts.query : listedClassQuery;
      const cursor = append ? listedClassesCursor : null;

      if (append) {
        setListedClassesLoadingMore(true);
        setListedClassesMoreError(null);
      } else {
        setListedClassesLoading(true);
        setListedClassesInitialError(null);
        setListedClassesMoreError(null);
      }
      const mine = ++listedClassRequestRef.current;
      try {
        const params = new URLSearchParams();
        params.set("limit", "20");
        params.set("presentation", "class");
        if (q.trim().length > 0) params.set("q", q.trim());
        if (cursor) params.set("cursor", cursor);
        const answer = await apiGet<{ programs: PublicProgramSummary[]; nextCursor: string | null }>(
          `/programs?${params.toString()}`,
        );
        if (mine !== listedClassRequestRef.current) return;
        if (append) {
          setListedClasses((current) => appendPage(
            { rows: current, nextCursor: listedClassesCursor },
            { rows: answer.programs, nextCursor: answer.nextCursor },
          ).rows);
        } else {
          setListedClasses(answer.programs);
        }
        setListedClassesCursor(answer.nextCursor);
        setListedClassesLoadedOnce(true);
      } catch (err) {
        if (mine !== listedClassRequestRef.current) return;
        const message = err instanceof ApiError
          ? err.message
          : "Fadko could not reach the server. Check your connection and try again.";
        if (append) setListedClassesMoreError(message);
        else {
          setListedClasses([]);
          setListedClassesInitialError(message);
        }
      } finally {
        if (mine !== listedClassRequestRef.current) return;
        if (append) setListedClassesLoadingMore(false);
        else setListedClassesLoading(false);
      }
    },
    [listedClassQuery, listedClassesCursor],
  );

  React.useEffect(() => {
    if (view === "classes" && classCatalogMode === "tuition" && !listedClassesLoadedOnce) {
      void loadListedClasses();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, classCatalogMode]);

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
    if (view === "classes" && classCatalogMode === "single" && !classesLoadedOnce && !classesLoading) void loadClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, classCatalogMode]);
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
            <Text
              testID="discover-subtitle"
              style={[t.caption, { color: colors.mutedForeground, marginTop: space.xxs / 2 }]}
            >
              {currentTab.subtitle}
            </Text>
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

        <View style={[styles.subTabs, { gap: space.xs }]} accessibilityRole="tablist">
          {DISCOVER_TABS.map((tab) => {
            // Courses are one class-finding catalogue, not a third top-level intention.
            // Keep the parent intention selected while that catalogue is open.
            const active = discoverIntentFor(view) === tab.view;
            const icon = tab.view === "teachers" ? "user-check" : "book-open";
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
                    paddingHorizontal: space.sm,
                    paddingVertical: space.xs,
                    gap: space.xs,
                  },
                ]}
              >
                <Feather name={icon} size={18} color={active ? colors.primary : colors.mutedForeground} />
                <View style={{ flex: 1, gap: space.xxs }}>
                  <Text style={[t.bodyStrong, { color: active ? colors.primary : colors.foreground }]}>
                    {tab.label}
                  </Text>
                  <Text style={[t.caption, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {tab.view === "teachers" ? "Name, school or place" : "Subject, exam or skill"}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {view !== "teachers" ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.xs }}
            testID="class-catalog-tabs"
          >
            {CLASS_CATALOG_TABS.map((tab) => {
              const active = tab.mode === "courses"
                ? view === "programs"
                : view === "classes" && classCatalogMode === tab.mode;
              return (
                <TouchableOpacity
                  key={tab.mode}
                  testID={tab.mode === "courses" ? "discover-subtab-programs" : `class-catalog-${tab.mode}`}
                  onPress={() => {
                    if (tab.mode === "courses") setView("programs");
                    else {
                      setClassCatalogMode(tab.mode);
                      setView("classes");
                    }
                  }}
                  activeOpacity={0.75}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  aria-selected={active}
                  style={{
                    minHeight: HIT_SLOP_MIN,
                    justifyContent: "center",
                    paddingHorizontal: space.sm,
                    borderWidth: 1,
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.actionSoft : colors.surface,
                    borderRadius: radius.pill,
                  }}
                >
                  <Text style={[t.bodyStrong, { color: active ? colors.primary : colors.mutedForeground }]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

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
      ) : view === "classes" && classCatalogMode === "tuition" ? (
        <ScrollView
          testID="teaching-classes-scroll"
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
            catalog="class"
            query={listedClassQuery}
            onQueryChange={setListedClassQuery}
            chosenType="all"
            onTypeChange={() => undefined}
            programs={listedClasses}
            initialLoad={listedClassesLoading}
            loadingMore={listedClassesLoadingMore}
            hasMore={listedClassesCursor !== null}
            initialError={listedClassesInitialError}
            paginationError={listedClassesMoreError}
            onLoadMore={() => void loadListedClasses({ append: true })}
            onRetry={() => void loadListedClasses({ query: listedClassQuery })}
            onOpen={(id) => router.push(`/(student)/program/${id}`)}
            onSubmit={(text) => { setListedClassQuery(text); void loadListedClasses({ query: text }); }}
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
        <TeacherFinder onOpen={(teacher: PublicTeacher) => router.push(`/(student)/teacher/${teacher.id}`)} />
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
  subTab: {
    flex: 1,
    minHeight: HIT_SLOP_MIN,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    justifyContent: "center",
  },
});
