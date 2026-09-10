import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { cardFromSummary, type ProgramList } from "@/utils/programDiscovery";
import ProgramCard from "./ProgramCard";

export interface TeacherProgramsPanelProps {
  list: ProgramList;
  state: "loading" | "ready" | "failed";
  loadingMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  onOpen: (programId: number) => void;
}

/** A real empty response disappears; a failed response is never translated into "none". */
export function TeacherProgramsPanel({
  list,
  state,
  loadingMore,
  onRetry,
  onLoadMore,
  onOpen,
}: TeacherProgramsPanelProps) {
  const colors = useColors();
  const { t, space, radius } = useLayout();

  if (state === "ready" && list.rows.length === 0) return null;

  return (
    <View testID="teacher-programs-section" style={{ gap: space.sm, marginBottom: space.xl }}>
      <View style={{ gap: space.xxs }}>
        <Text accessibilityRole="header" style={[t.title2, { color: colors.foreground }]}>Learning programs</Text>
        <Text style={[t.callout, { color: colors.mutedForeground }]}>Structured learning paths this teacher has published.</Text>
      </View>

      {state === "loading" ? (
        <View style={{ alignItems: "center", paddingVertical: space.lg, gap: space.sm }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[t.callout, { color: colors.mutedForeground }]}>Loading programs…</Text>
        </View>
      ) : null}

      {state === "failed" && list.rows.length === 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.muted, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm }}>
          <Feather name="wifi-off" size={18} color={colors.mutedForeground} />
          <View style={{ flex: 1, gap: space.xxs }}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>Programs couldn&apos;t load</Text>
            <Text style={[t.callout, { color: colors.mutedForeground }]}>The teacher&apos;s profile is still available.</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" onPress={onRetry} activeOpacity={0.7}>
            <Text style={[t.bodyStrong, { color: colors.primary }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {list.rows.map((program) => (
        <ProgramCard key={program.id} fields={cardFromSummary(program)} testID={`teacher-program-${program.id}`} onPress={() => onOpen(program.id)} />
      ))}

      {state === "failed" && list.rows.length > 0 ? (
        <TouchableOpacity accessibilityRole="button" onPress={onRetry} activeOpacity={0.7}>
          <Text style={[t.bodyStrong, { color: colors.primary, textAlign: "center" }]}>Retry loading more</Text>
        </TouchableOpacity>
      ) : list.nextCursor ? (
        <TouchableOpacity
          testID="teacher-programs-more"
          accessibilityRole="button"
          accessibilityState={{ disabled: loadingMore }}
          aria-disabled={loadingMore}
          disabled={loadingMore}
          onPress={onLoadMore}
          activeOpacity={0.7}
          style={{ minHeight: HIT_SLOP_MIN, alignItems: "center", justifyContent: "center" }}
        >
          {loadingMore ? <ActivityIndicator color={colors.primary} /> : <Text style={[t.bodyStrong, { color: colors.primary }]}>Show more programs</Text>}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
