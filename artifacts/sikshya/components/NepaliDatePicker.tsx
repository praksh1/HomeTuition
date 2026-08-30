import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useDates } from "@/context/DatePreferenceContext";
import {
  BS_MONTHS,
  BS_MONTHS_NP,
  BS_WEEKDAYS,
  BS_WEEKDAYS_NP,
  bsDaysInMonth,
  fromBikramSambat,
  toBikramSambat,
  toNepaliDigits,
} from "@/utils/nepaliDate";

/**
 * A calendar a Nepali teacher can actually read.
 *
 * The date fields on this app have been a Gregorian `<input type="date">` on the web and a typed
 * `YYYY-MM-DD` on a phone. Neither is usable by somebody who keeps their diary in Bikram Sambat:
 * they have to convert their own date before they can enter it, every time, and a slip means a
 * class scheduled on the wrong day.
 *
 * So this is a month grid in Bikram Sambat. The month lengths come from the same conversion the
 * rest of the app uses — 29 to 32 days, published rather than derived — so a grid can never
 * offer a day that does not exist.
 *
 * The Gregorian date is shown underneath rather than hidden. Somebody coordinating with a
 * relative abroad, or filling in a form that wants Gregorian, should not have to convert
 * anything themselves, and a teacher glancing at it can tell immediately whether they have
 * picked what they meant.
 */

interface Props {
  visible: boolean;
  /** The date the picker opens on. */
  value: Date | null;
  onCancel: () => void;
  onPick: (date: Date) => void;
  /** Days before this cannot be chosen. Classes cannot be scheduled in the past. */
  minDate?: Date | null;
  /** Days after this cannot be chosen. The day itself remains available. */
  maxDate?: Date | null;
  title?: string;
}

export default function NepaliDatePicker({
  visible, value, onCancel, onPick, minDate, maxDate, title = "Pick a date",
}: Props) {
  const colors = useColors();
  const { nepaliNumerals } = useDates();

  const opening = value ?? new Date();
  const openingBs = toBikramSambat(opening) ?? toBikramSambat(new Date());

  const [year, setYear] = useState(openingBs?.year ?? 2083);
  const [month, setMonth] = useState(openingBs?.month ?? 1);
  const [chosen, setChosen] = useState<number | null>(openingBs?.day ?? null);

  const num = (n: number) => (nepaliNumerals ? toNepaliDigits(n) : String(n));
  const monthNames = nepaliNumerals ? BS_MONTHS_NP : BS_MONTHS;
  const weekdayNames = nepaliNumerals ? BS_WEEKDAYS_NP : BS_WEEKDAYS;

  /**
   * The grid: how many days this month has, and which column the 1st falls in.
   *
   * Both come from converting real dates rather than from arithmetic on a table of our own — a
   * second table would be a second thing to drift out of step with the first.
   */
  const grid = useMemo(() => {
    const days = bsDaysInMonth(year, month);
    const first = fromBikramSambat(year, month, 1);
    const leading = first ? first.getDay() : 0;
    return { days, leading };
  }, [year, month]);

  const step = (by: number) => {
    let nextMonth = month + by;
    let nextYear = year;
    if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
    if (nextMonth < 1) { nextMonth = 12; nextYear -= 1; }
    // Refuse to step outside the conversion table rather than showing an empty month.
    if (!fromBikramSambat(nextYear, nextMonth, 1)) return;
    setYear(nextYear);
    setMonth(nextMonth);
    setChosen(null);
  };

  const dayIsAllowed = (day: number): boolean => {
    const atStart = fromBikramSambat(year, month, day);
    const atEnd = fromBikramSambat(year, month, day, 23, 59);
    if (!atStart || !atEnd) return false;
    if (minDate && atEnd.getTime() < minDate.getTime()) return false;
    if (maxDate && atStart.getTime() > maxDate.getTime()) return false;
    return true;
  };

  const chosenDate = chosen === null ? null : fromBikramSambat(year, month, chosen);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View
          testID="nepali-date-picker"
          style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>

          <View style={styles.monthRow}>
            <TouchableOpacity
              testID="bs-prev-month"
              onPress={() => step(-1)}
              style={[styles.stepBtn, { borderColor: colors.border }]}
              activeOpacity={0.8}
            >
              <Feather name="chevron-left" size={20} color={colors.foreground} />
            </TouchableOpacity>
            <View style={styles.monthLabel}>
              <Text testID="bs-month-label" style={[styles.monthText, { color: colors.foreground }]}>
                {monthNames[month - 1]} {num(year)}
              </Text>
            </View>
            <TouchableOpacity
              testID="bs-next-month"
              onPress={() => step(1)}
              style={[styles.stepBtn, { borderColor: colors.border }]}
              activeOpacity={0.8}
            >
              <Feather name="chevron-right" size={20} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekdays}>
            {weekdayNames.map((day) => (
              <Text key={day} style={[styles.weekday, { color: colors.mutedForeground }]}>{day}</Text>
            ))}
          </View>

          <ScrollView bounces={false} style={styles.gridWrap}>
            <View style={styles.grid}>
              {Array.from({ length: grid.leading }).map((_, i) => (
                <View key={`blank-${i}`} style={styles.cell} />
              ))}
              {Array.from({ length: grid.days }).map((_, i) => {
                const day = i + 1;
                const allowed = dayIsAllowed(day);
                const selected = chosen === day;
                return (
                  <TouchableOpacity
                    key={day}
                    testID={`bs-day-${day}`}
                    disabled={!allowed}
                    onPress={() => setChosen(day)}
                    activeOpacity={0.8}
                    style={[
                      styles.cell,
                      styles.dayCell,
                      selected && { backgroundColor: colors.primary },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        { color: selected ? "#fff" : allowed ? colors.foreground : colors.border },
                      ]}
                    >
                      {num(day)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {/*
            The Gregorian date, shown rather than hidden. It is how a teacher checks at a glance
            that they picked what they meant, and how anybody coordinating outside Nepal reads it.
          */}
          <View style={[styles.echo, { borderTopColor: colors.border }]}>
            <Text testID="bs-picked-echo" style={[styles.echoText, { color: colors.mutedForeground }]}>
              {chosenDate
                ? chosenDate.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })
                : "No day chosen yet."}
            </Text>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              testID="bs-cancel"
              onPress={onCancel}
              activeOpacity={0.85}
              style={[styles.btn, { borderColor: colors.border }]}
            >
              <Text style={[styles.btnText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="bs-confirm"
              disabled={!chosenDate}
              onPress={() => chosenDate && onPick(chosenDate)}
              activeOpacity={0.85}
              style={[
                styles.btn,
                { backgroundColor: chosenDate ? colors.primary : colors.muted, borderColor: chosenDate ? colors.primary : colors.border },
              ]}
            >
              <Text style={[styles.btnText, { color: chosenDate ? "#fff" : colors.mutedForeground }]}>
                Use this date
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center", padding: 20,
  },
  sheet: { width: "100%", maxWidth: 420, maxHeight: "88%", borderRadius: 20, borderWidth: 1, padding: 18, gap: 12 },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  monthRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  monthLabel: { flex: 1, alignItems: "center" },
  monthText: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  weekdays: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  gridWrap: { maxHeight: 300 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  dayCell: { borderRadius: 10 },
  dayText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  echo: { borderTopWidth: 1, paddingTop: 10 },
  echoText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  actions: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, alignItems: "center", borderWidth: 1, borderRadius: 12, paddingVertical: 13 },
  btnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
