import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import {
  DISCOVER_SEARCH_PROMPT,
  cardFromSummary,
  localMatches,
  localTypeMatches,
  programTypeFilters,
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
 * Loading, empty, no-match and failed are four different pictures. A blank list with a spinner is
 * indistinguishable from a broken one on a slow phone, and both are indistinguishable from "there
 * are no programs" — which is not something this app should ever imply when a request failed. The
 * project has been caught doing that four times, most recently on the student monthly page; see
 * `.agents/backlog/ui-upgrade-progress.md`.
 *
 * ## Where the filtering happens
 *
 * The **server** does the real filtering: the words the student typed and the type they chose go
 * to `/programs` and come back as a page. Between that page arriving and the next one being asked
 * for, the chips still work locally — flipping a chip does not fire a request per tap on a Nepali
 * bus connection. The two agree because `localMatches` and `localTypeMatches` read the same fields
 * `/programs` searches, so a client-side pass can never *expand* the set.
 *
 * ## Pagination
 *
 * The server returns `nextCursor`. The screen shows one page at a time and, if there is another,
 * offers "Show more programs" — explicit rather than infinite-scroll, because a Nepali student on
 * a slow connection who scrolls past the end should not silently fetch a second megabyte.
 */
export interface ProgramDiscoverListProps {
  query: string;
  onQueryChange: (next: string) => void;
  chosenType: ProgramType | "all";
  onTypeChange: (next: ProgramType | "all") => void;
  programs: PublicProgramSummary[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  failure: string | null;
  onLoadMore: () => void;
  onRetry: () => void;
  onOpen: (id: number) => void;
  /**
   * The screen submits the typed query to the API. The list itself never fetches; it just draws
   * what the screen hands it. Called on Enter or on the clear-search action.
   */
  onSubmit?: (query: string) => void;
}

export default function ProgramDiscoverList(props: ProgramDiscoverListProps) {
  const {
    query, onQueryChange, chosenType, onTypeChange, programs, loading, loadingMore, hasMore,
    failure, onLoadMore, onRetry, onOpen, onSubmit,
  } = props;
  const colors = useColors();
  const { t, space, radius } = useLayout();

  // The two filters, applied locally so a chip change is instant. Anything unmatched here would
  // also have been unmatched at the server, so the client can only *narrow* the set.
  const chosen = new Set<ProgramType | "all">([chosenType]);
  const filtered = programs.filter(
    (row) => localMatches(row, query) && localTypeMatches(row, chosen),
  );

  return (
    <View style={{ gap: space.md }} testID="program-discover-list">
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
          testID="program-discover-search"
          value={query}
          onChangeText={onQueryChange}
          placeholder={DISCOVER_SEARCH_PROMPT}
          placeholderTextColor={colors.mutedForeground}
          returnKeyType="search"
          onSubmitEditing={() => onSubmit?.(query)}
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
            onPress={() => { onQueryChange(""); onSubmit?.(""); }}
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

      {/*
        Loading, empty and failed are three different pictures.

        A skeleton block for a first load beats a spinner — it holds the shape of what is coming,
        so the layout does not jump — and the empty and failed states are explicitly different.
      */}
      {loading ? (
        <View testID="program-discover-loading" style={{ gap: space.sm }}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{
                height: 140, borderRadius: radius.md,
                backgroundColor: colors.muted, opacity: 0.55,
              }}
            />
          ))}
        </View>
      ) : failure ? (
        <ProgramFailure
          testID="program-discover-failure"
          message={failure}
          onRetry={onRetry}
        />
      ) : programs.length === 0 ? (
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
      ) : filtered.length === 0 ? (
        <View
          testID="program-discover-nomatch"
          style={{
            padding: space.lg, backgroundColor: colors.card, borderRadius: radius.md,
            borderWidth: 1, borderColor: colors.border, gap: space.xs,
          }}
        >
          <Text style={[t.title3, { color: colors.foreground }]}>Nothing here for that</Text>
          <Text style={[t.callout, { color: colors.mutedForeground }]}>
            {query.trim().length > 0
              ? `No published program on Fadko matches “${query.trim()}” with the filter you chose. Try different words, or clear the filter.`
              : "No published program matches the filter you chose. Try All."}
          </Text>
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          {filtered.map((row) => (
            <ProgramCard
              key={row.id}
              testID={`program-card-${row.id}`}
              fields={cardFromSummary(row)}
              onPress={() => onOpen(row.id)}
            />
          ))}
          {hasMore ? (
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
          ) : null}
        </View>
      )}
    </View>
  );
}
