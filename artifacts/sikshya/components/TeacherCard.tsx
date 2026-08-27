import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { numeric } from "@/constants/typography";
import StarRating from "./StarRating";
import type { Teacher } from "@/context/AuthContext";

interface TeacherCardProps {
  teacher: Teacher;
  onPress?: () => void;
  compact?: boolean;
  /**
   * This teacher also runs a monthly class, taken from `GET /monthly/classes`.
   *
   * Passed in rather than read here: the card cannot know it, and asking per card would be one
   * request per row. Undefined means "we have not checked", which is why the badge only appears
   * when it is explicitly true — a missing badge must never imply a missing class.
   */
  hasMonthlyClass?: boolean;
}

export default function TeacherCard({ teacher, onPress, compact, hasMonthlyClass }: TeacherCardProps) {
  const colors = useColors();
  const { t, space, radius, elevation } = useLayout();

  const initials = teacher.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  /**
   * A teacher with no reviews is unrated, not badly rated.
   *
   * This showed `0.0` beside an empty row of stars for everybody who had never been reviewed,
   * which on a storefront reads as "people tried this teacher and thought little of it". It is
   * the opposite of the truth for somebody who joined yesterday, and it is the first thing a
   * student sees about them.
   */
  const isRated = teacher.reviewCount > 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${teacher.name}, ${teacher.subject}${isRated ? `, rated ${teacher.rating.toFixed(1)} from ${teacher.reviewCount} reviews` : ", not yet reviewed"}`}
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: radius.md,
          padding: space.md,
          marginBottom: space.sm,
          gap: space.sm,
        },
        elevation.card,
      ]}
    >
      <View style={[styles.topRow, { gap: space.sm }]}>
        <View style={[styles.avatar, { backgroundColor: colors.actionSoft, borderRadius: radius.pill }]}>
          <Text style={[t.title3, { color: colors.primary }]}>{initials}</Text>
        </View>

        <View style={{ flex: 1, gap: 3 }}>
          <View style={styles.nameRow}>
            <Text style={[t.title3, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>
              {teacher.name}
            </Text>
            {teacher.approvalStatus === "approved" && (
              <Feather name="check-circle" size={14} color={colors.success} />
            )}
          </View>

          <Text style={[t.overline, { color: colors.inkFaint }]} numberOfLines={1}>
            {teacher.subject}
          </Text>

          {isRated ? (
            <View style={styles.ratingRow}>
              <StarRating rating={teacher.rating} size={12} />
              <Text style={[t.caption, numeric, { color: colors.foreground }]}>
                {teacher.rating.toFixed(1)}
              </Text>
              <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>
                ({teacher.reviewCount})
              </Text>
            </View>
          ) : (
            <Text style={[t.caption, { color: colors.inkFaint }]}>Not yet reviewed</Text>
          )}
        </View>

        {/*
          The price always carries its unit.

          "NPR 500" on a storefront that sells both single classes and whole months is
          ambiguous in the most expensive possible way. It said "/session"; it now says the
          billing model in words.
        */}
        {teacher.pricePerSession != null && (
          <View style={[styles.priceBadge, { backgroundColor: colors.actionSoft, borderRadius: radius.sm, paddingHorizontal: space.xs }]}>
            <Text style={[t.bodyStrong, numeric, { color: colors.primary }]}>
              NPR {teacher.pricePerSession.toLocaleString()}
            </Text>
            <Text style={[t.overline, { color: colors.primary }]}>per class</Text>
          </View>
        )}
      </View>

      {!compact && !!teacher.bio && (
        <Text style={[t.callout, { color: colors.mutedForeground }]} numberOfLines={2}>
          {teacher.bio}
        </Text>
      )}

      {!compact && teacher.subjects.length > 0 && (
        <View style={[styles.chips, { gap: space.xxs }]}>
          {teacher.subjects.slice(0, 3).map((s) => (
            <View
              key={s}
              style={[styles.chip, { backgroundColor: colors.muted, borderColor: colors.border, borderRadius: radius.xs }]}
            >
              <Text style={[t.caption, { color: colors.mutedForeground }]}>{s}</Text>
            </View>
          ))}
          {teacher.subjects.length > 3 && (
            <Text style={[t.caption, { color: colors.inkFaint, alignSelf: "center" }]}>
              +{teacher.subjects.length - 3}
            </Text>
          )}
        </View>
      )}

      <View style={[styles.footer, { gap: space.sm }]}>
        {/*
          There was an "Available" tag here, shown to every teacher who had not set an online
          flag — which is all of them, because nothing in the app has ever set it. A claim about
          whether somebody can teach you right now, made from no data at all, on the screen
          where a student is choosing. It is gone rather than restyled.
        */}
        <View style={styles.stat}>
          <Feather name="users" size={12} color={colors.inkFaint} />
          <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>
            {teacher.totalStudents} {teacher.totalStudents === 1 ? "student" : "students"}
          </Text>
        </View>

        {teacher.experienceYears != null && (
          <View style={styles.stat}>
            <Feather name="award" size={12} color={colors.inkFaint} />
            <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>
              {teacher.experienceYears}y experience
            </Text>
          </View>
        )}

        {!!teacher.location && (
          <View style={[styles.stat, { flexShrink: 1 }]}>
            <Feather name="map-pin" size={12} color={colors.inkFaint} />
            <Text style={[t.caption, { color: colors.mutedForeground }]} numberOfLines={1}>
              {teacher.location}
            </Text>
          </View>
        )}

        {/*
          Crimson, because this is a different *kind* of thing rather than a better one: it is
          the other billing model. A student must be able to tell before they tap.
        */}
        {hasMonthlyClass === true && (
          <View
            style={[
              styles.monthlyTag,
              { backgroundColor: colors.brandSoft, borderRadius: radius.pill, paddingHorizontal: space.xs },
            ]}
          >
            <Feather name="repeat" size={11} color={colors.brand} />
            <Text style={[t.overline, { color: colors.brand }]}>Monthly too</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

/** Structure only. Colour, spacing, radius and type arrive from the hooks at render time. */
const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth },
  topRow: { flexDirection: "row", alignItems: "flex-start" },
  avatar: { width: 52, height: 52, justifyContent: "center", alignItems: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  priceBadge: { alignItems: "center", justifyContent: "center", minHeight: 44, paddingVertical: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap" },
  chip: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingVertical: 3 },
  footer: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  monthlyTag: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 3 },
});
