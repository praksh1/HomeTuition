import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import {
  DISCOVER_SEARCH_PROMPT,
  cardFromSummary,
  programListState,
  programTypeFilters,
  type ProgramListState,
  type ProgramType,
  type PublicProgramSummary,
} from "@/utils/programDiscovery";
import ProgramCard from "./ProgramCard";
import { ProgramFailure } from "./ProgramPieces";

/**
 * The Programs view of Discover: search, filter chips, list of cards, "Show more".
 *
 * ## What the states look like, and why they differ from each other
 *
 * Loading, global-empty, no-match, first-load-failure and pagination-failure are five different
 * pictures. The choice between them is made in `programListState()` in the util rather than inline
 * here, so a screen and its test read the exact same rules. The project has been caught more than
 * once drawing a failed load as "no programs yet" — see `.agents/backlog/ui-upgrade-progress.md`.
 *
 * ## Where the filtering happens
 *
 * The **server** does the filtering: the words the student typed and the type they chose go to
 * `/programs` and the answer is exactly what this component draws. There is no client-side
 * post-filter: the API's `?q=` and `?type=` are the authoritative set, and re-running a local
 * `includes()` over the page would only invent divergences (a program that matches the server's
 * search over the teacher's name but not the local one would silently vanish).
 *
 * Tapping a chip is a filter change, and a filter change is a new query — the parent submits it.
 * Typing does *not* fetch on each keystroke: the request is fired by the visible Search button or
 * by the keyboard's return key, so a Nepali bus connection is not billed one call per letter.
 *
 * ## Pagination
 *
 * The server returns `nextCursor`. The screen shows the pages it has and, if there is another,
 * offers "Show more programs" — explicit rather than infinite-scroll, because a student on a slow
 * connection who scrolls past the end should not silently fetch a second megabyte. When the
 * "Show more" call fails, the retry sits *beside* the button and the cards already on screen stay
 * on screen. A pagination failure never replaces successful results with a failure card.
 */
export interface ProgramDiscoverListProps {
  query: string;
  onQueryChange: (next: string) => void;
  chosenType: ProgramType | "all";
  /** A chip tap is a filter change; the parent runs the new fetch. */
  onTypeChange: (next: ProgramType | "all") => void;
  programs: PublicProgramSummary[];
  initialLoad: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  /** The failure of the *first* load, if any — used only when nothing is on screen. */
  initialError: string | null;
  /** The failure of a "Show more" call — shown beside the button, never in place of results. */
  paginationError: string | null;
  onLoadMore: () => void;
  onRetry: () => void;
  onOpen: (id: number) => void;
  /**
   * The screen submits the typed query to the API. The list itself never fetches; it just draws
   * what the screen hands it. Called on Enter, on the Search button, and on the clear-search
   * action.
   */
  onSubmit: (query: string) => void;
}

export default function ProgramDiscoverList(props: ProgramDiscoverListProps) {
  const {
    query, onQueryChange, chosenType, onTypeChange, programs, initialLoad, loadingMore, hasMore,
    initialError, paginationError, onLoadMore, onRetry, onOpen, onSubmit,
  } = props;
  const colors = useColors();
  const { t, space, radius } = useLayout();

  // The one place the five states are decided from what happened, so every screen and every test
  // reads the same answer.
  const state: ProgramListState = programListState({
    initialLoad,
    loadedRows: programs,
    hasMore,
    initialError,
    paginationError,
    query,
    chosenType,
  });

  return (
    <View style={{ gap: space.md }} testID="program-discover-list">
      {/* Search input plus a visible Search button. The button is a real control, not a
          decoration — a non-technical student is not expected to know that the keyboard's return
          key runs a search. Both submit the same query. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
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
            testID="program-discover-search"
            value={query}
            onChangeText={onQueryChange}
            placeholder={DISCOVER_SEARCH_PROMPT}
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="search"
            onSubmitEditing={() => onSubmit(query)}
            accessibilityLabel={DISCOVER_SEARCH_PROMPT}
            /*
              Full 44-point height on the input itself, not only on the wrapping row. React Native
              Web maps the input to a native `<input>`, and the browser sizes that from its own
              padding rather than from the flex box around it — so a wrapper with `minHeight: 44`
              can still hold an input that is 22 high and misses the touch floor.
            */
            style={[t.body, { flex: 1, color: colors.foreground, minHeight: HIT_SLOP_MIN, paddingVertical: space.xs }]}
          />
          {query.length > 0 ? (
            <Pressable
              testID="program-discover-clear"
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
          testID="program-discover-search-submit"
          onPress={() => onSubmit(query)}
          accessibilityRole="button"
          accessibilityLabel="Search programs"
          style={{
            minWidth: HIT_SLOP_MIN, minHeight: HIT_SLOP_MIN,
            alignItems: "center", justifyContent: "center",
            paddingHorizontal: space.md,
            borderRadius: radius.sm,
            backgroundColor: colors.primary,
          }}
        >
          <Text style={[t.bodyStrong, { color: colors.onInverse }]}>Search</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.xxs, paddingVertical: space.xxs }}
        testID="program-discover-chips"
      >
        {programTypeFilters().map((filter) => {
          const active = filter.type === chosenType;
          return (
            <Pressable
              key={filter.type}
              testID={`program-discover-chip-${filter.type}`}
              onPress={() => onTypeChange(filter.type)}
              accessibilityRole="button"
              accessibilityLabel={filter.label}
              accessibilityState={{ selected: active }}
              aria-pressed={active}
              style={{
                minHeight: HIT_SLOP_MIN,
                paddingHorizontal: space.sm, paddingVertical: space.xxs,
                borderRadius: radius.pill, borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.actionSoft : colors.card,
                justifyContent: "center", alignItems: "center",
              }}
            >
              <Text style={[t.bodyStrong, { color: active ? colors.primary : colors.foreground }]}>
                {filter.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {state.kind === "loading" ? (
        <View testID="program-discover-loading" style={{ gap: space.sm }}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{
                // A skeleton card at roughly the height of a real one — three lines of text plus
                // padding — kept as a token multiple so the number is a choice from the scale.
                height: space.xxxl * 3,
                borderRadius: radius.md,
                backgroundColor: colors.muted, opacity: 0.55,
              }}
            />
          ))}
        </View>
      ) : state.kind === "error" ? (
        <ProgramFailure
          testID="program-discover-failure"
          message={state.message}
          onRetry={onRetry}
        />
      ) : state.kind === "empty" ? (
        <View
          testID="program-discover-empty"
          style={{
            padding: space.lg, backgroundColor: colors.card, borderRadius: radius.md,
            borderWidth: 1, borderColor: colors.border, gap: space.xs,
          }}
        >
          <Text style={[t.title3, { color: colors.foreground }]}>No programs yet</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>
            Teachers on Fadko are still setting up their programs. A Learning Program is a full course
            with an outcome, a path and a teacher — different from a single class.
          </Text>
        </View>
      ) : state.kind === "noMatch" ? (
        <View
          testID="program-discover-nomatch"
          style={{
            padding: space.lg, backgroundColor: colors.card, borderRadius: radius.md,
            borderWidth: 1, borderColor: colors.border, gap: space.xs,
          }}
        >
          <Text style={[t.title3, { color: colors.foreground }]}>No matching programs</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>
            {state.query.length > 0 && state.filterActive
              ? `No published program on Fadko matches “${state.query}” with the filter you chose. Try different words, or clear the filter.`
              : state.query.length > 0
                ? `No published program on Fadko matches “${state.query}”. Try different words.`
                : "No published program matches the filter you chose. Try All."}
          </Text>
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          {state.rows.map((row) => (
            <ProgramCard
              key={row.id}
              testID={`program-card-${row.id}`}
              fields={cardFromSummary(row)}
              onPress={() => onOpen(row.id)}
            />
          ))}
          {state.hasMore ? (
            <View style={{ gap: space.xs }}>
              <Pressable
                testID="program-discover-more"
                onPress={onLoadMore}
                accessibilityRole="button"
                accessibilityLabel="Show more programs"
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
                {loadingMore ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={[t.bodyStrong, { color: colors.primary }]}>Show more programs</Text>
                )}
              </Pressable>
              {state.paginationError !== null ? (
                <View
                  testID="program-discover-more-error"
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
                    testID="program-discover-more-retry"
                    onPress={onLoadMore}
                    accessibilityRole="button"
                    accessibilityLabel="Try loading more programs again"
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
    </View>
  );
}
