import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useDates } from "@/context/DatePreferenceContext";
import { numeric } from "@/constants/typography";

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
}

interface SessionCardProps {
  session: Session;
  onPress?: () => void;
  showTeacher?: boolean;
}

export default function SessionCard({ session, onPress, showTeacher = false }: SessionCardProps) {
  const colors = useColors();
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
});
