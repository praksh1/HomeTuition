import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useDates } from "@/context/DatePreferenceContext";
import { numeric } from "@/constants/typography";
import { TEST_BOOKING_LABEL, TEST_CLASS_LABEL } from "@/utils/testAccess";

interface Session {
  id: string;
  teacherName?: string;
  subject: string;
  topic: string;
  date: string;
  duration: number;
  maxStudents: number;
  enrolledStudents: string[];
  price: number;
  status: "upcoming" | "live" | "completed" | "cancelled";
  /**
   * This viewer's own place in the class, as the server reports it. `test` means an operator
   * granted the place and no money was taken **for them**.
   */
  enrolment?: string | null;
  /**
   * The class was created under a teacher's test grant — the server's fact, from `test_classes`.
   *
   * **Eligibility, not a payment claim.** A test class is merely *open* to approved test
   * bookings; anybody without a grant pays the price on this card in full. Shown only to the
   * teacher who owns the class (see `showTestClass`), because to a student browsing it the class
   * is an ordinary paid one and the marker would invite exactly the misreading it is trying to
   * prevent.
   */
  testClass?: boolean;
  /** The server's own wording for the class-level fact. */
  testClassLabel?: string;
}

interface SessionCardProps {
  session: Session;
  onPress?: () => void;
  showTeacher?: boolean;
  /**
   * Show the class-level "test-enabled" marker.
   *
   * Off by default, and on only where the audience is the teacher who owns the class. An
   * ordinary student pays full price for a test class, so telling them the class is test-enabled
   * answers a question they did not ask with a word that sounds like "free". They get normal
   * price and payment language; the marker on their own card is about *their* booking, and comes
   * from `enrolment` instead.
   */
  showTestClass?: boolean;
}

export default function SessionCard({
  session, onPress, showTeacher = false, showTestClass = false,
}: SessionCardProps) {
  const colors = useColors();
  const { t } = useLayout();
  const date = new Date(session.date);
  const isLive = session.status === "live";
  const isCompleted = session.status === "completed";

  const dates = useDates();
  const statusColor = isLive ? colors.success : isCompleted ? colors.mutedForeground : colors.accent;
  const statusBg = isLive ? colors.success + "15" : isCompleted ? colors.muted : colors.accent + "15";
  const statusLabel = isLive ? "LIVE" : isCompleted ? "Completed" : "Upcoming";

  // Bikram Sambat unless this person has asked for Gregorian. See context/DatePreferenceContext.
  const formatted = dates.format(date, { withWeekday: true, withTime: true });

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      {isLive && (
        <View style={[styles.livePulse, { backgroundColor: colors.success }]} />
      )}
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={[styles.subject, { color: colors.primary }]}>{session.subject}</Text>
          <Text style={[styles.topic, { color: colors.foreground }]} numberOfLines={2}>
            {session.topic}
          </Text>
          {showTeacher && session.teacherName && (
            <Text style={[styles.teacherName, { color: colors.mutedForeground }]}>
              by {session.teacherName}
            </Text>
          )}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.meta}>
        <View style={styles.metaItem}>
          <Feather name="calendar" size={13} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{formatted}</Text>
        </View>
        <View style={styles.metaItem}>
          <Feather name="clock" size={13} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{session.duration} min</Text>
        </View>
        <View style={styles.metaItem}>
          <Feather name="users" size={13} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
            {session.enrolledStudents.length}/{session.maxStudents}
          </Text>
        </View>
        <Text style={[styles.price, numeric, { color: colors.primary }]}>
          NPR {session.price.toLocaleString()} per class
        </Text>
      </View>

      {/*
        Two different sentences, next to the price, and never both at once.

        A card showing "NPR 500 per class" above a seat nobody paid for is the fabrication this
        project keeps finding — but the fix for it produced a second one, in the other direction:
        the same "no payment was processed" label went to every viewer of a test class, so a
        student about to be charged full price for it read that they would not be.

        So: this viewer's own place being a granted one is the only thing that may say no payment
        was taken. The class merely being open to such bookings is a different sentence, and is
        shown only to the teacher who owns it.
      */}
      {session.enrolment === "test" ? (
        <View
          testID={`session-test-booking-${session.id}`}
          accessibilityRole="text"
          style={[styles.testLabel, { backgroundColor: colors.warnSoft, borderColor: colors.warn }]}
        >
          <Feather name="alert-triangle" size={12} color={colors.warn} />
          <Text style={[t.overline, { color: colors.warn }]}>{TEST_BOOKING_LABEL}</Text>
        </View>
      ) : showTestClass && session.testClass ? (
        <View
          testID={`session-test-class-${session.id}`}
          accessibilityRole="text"
          style={[styles.testLabel, { backgroundColor: colors.warnSoft, borderColor: colors.warn }]}
        >
          <Feather name="alert-triangle" size={12} color={colors.warn} />
          <Text style={[t.overline, { color: colors.warn }]}>
            {session.testClassLabel ?? TEST_CLASS_LABEL}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    overflow: "hidden",
  },
  livePulse: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  header: { flexDirection: "row", gap: 12, marginBottom: 12 },
  titleBlock: { flex: 1 },
  subject: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  topic: { fontSize: 15, fontFamily: "Inter_600SemiBold", lineHeight: 22 },
  teacherName: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  meta: { flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  price: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginLeft: "auto" },
  testLabel: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
});
