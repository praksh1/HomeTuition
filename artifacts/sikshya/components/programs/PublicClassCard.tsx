import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { numeric } from "@/constants/typography";
import { useDates } from "@/context/DatePreferenceContext";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import type { PublicClassCardFields } from "@/utils/publicClasses";

/**
 * A single class the student may book right now, drawn honestly.
 *
 * ## What is on it, and what is not
 *
 * The topic and subject, the teacher's name, the date and time (in the student's chosen calendar
 * via `useDates()`), the duration, the pay-per-class billing model and the actual NPR price, the
 * seats-left count or "Sold out" if the class is full, and a single royal-blue "View & book"
 * action. No rating, no popularity, no fake availability signal, no fabricated enrolment total —
 * the public API deliberately does not carry any of those.
 *
 * ## What the tap does
 *
 * Opens the class's teacher page with a `?session=<id>` query parameter, so the existing Book &
 * Pay flow on that page handles the purchase. This card **never** routes to a video room or a
 * booking-completion screen: the class is not booked until the payment sheet on the teacher
 * page returns success.
 */
export interface PublicClassCardProps {
  fields: PublicClassCardFields;
  /** ISO string of the booked slot; the card localises the display. */
  dateIso: string;
  onPress: () => void;
  testID?: string;
}

export default function PublicClassCard({ fields, dateIso, onPress, testID }: PublicClassCardProps) {
  const colors = useColors();
  const { t, space, radius } = useLayout();
  const dates = useDates();

  const dateText = dates.format(dateIso, { withWeekday: true, withTime: true });

  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={fields.spokenLabel}
      onPress={onPress}
      style={{
        backgroundColor: colors.card,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        padding: space.lg,
        gap: space.sm,
      }}
    >
      {/* Billing model up top: same "Pay per class" wording as the teacher page's own row, so a
          student can tell the two billing models apart before they open anything. */}
      <View
        style={{ alignSelf: "flex-start", backgroundColor: colors.actionSoft, borderRadius: radius.pill, paddingHorizontal: space.xs, paddingVertical: space.xxs }}
        testID={testID ? `${testID}-billing` : undefined}
      >
        <Text style={[t.caption, { color: colors.primary }]}>{fields.billingLine}</Text>
      </View>

      <Text style={[t.title3, { color: colors.foreground }]} testID={testID ? `${testID}-topic` : undefined}>
        {fields.topic}
      </Text>

      <Text style={[t.callout, { color: colors.mutedForeground }]}>{fields.subject}</Text>

      <View style={{ gap: space.xxs }}>
        <Line
          icon="user"
          label="Taught by"
          value={fields.teacherName}
          testID={testID ? `${testID}-teacher` : undefined}
        />
        <Line
          icon="calendar"
          label="When"
          value={dateText}
          testID={testID ? `${testID}-when` : undefined}
        />
        <Line
          icon="clock"
          label="Length"
          value={fields.durationLine}
          testID={testID ? `${testID}-length` : undefined}
        />
        <Line
          icon="users"
          label="Seats"
          value={fields.seatsLine}
          testID={testID ? `${testID}-seats` : undefined}
          tone={fields.soldOut ? "warn" : "muted"}
        />
      </View>

      <View
        style={{
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          gap: space.sm, minHeight: HIT_SLOP_MIN,
        }}
      >
        <Text style={[t.title3, numeric, { color: colors.foreground }]} testID={testID ? `${testID}-price` : undefined}>
          {fields.priceLine}
        </Text>
        <View
          testID={testID ? `${testID}-action` : undefined}
          accessibilityRole="text"
          style={{
            flexDirection: "row", alignItems: "center", gap: space.xxs,
            minHeight: HIT_SLOP_MIN, paddingHorizontal: space.sm,
          }}
        >
          <Text style={[t.bodyStrong, { color: colors.primary }]}>{fields.actionLabel}</Text>
          <Feather name="chevron-right" size={16} color={colors.primary} />
        </View>
      </View>
    </Pressable>
  );
}

function Line({
  icon,
  label,
  value,
  testID,
  tone = "muted",
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value: string;
  testID?: string;
  tone?: "muted" | "warn";
}) {
  const colors = useColors();
  const { t, space } = useLayout();
  const valueColor = tone === "warn" ? colors.warn : colors.foreground;
  return (
    <View
      testID={testID}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: space.xs }}
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Feather name={icon} size={14} color={colors.inkFaint} />
      <View style={{ flex: 1, gap: space.xxs }}>
        <Text style={[t.caption, { color: colors.inkFaint }]}>{label}</Text>
        <Text style={[t.callout, { color: valueColor }]}>{value}</Text>
      </View>
    </View>
  );
}
