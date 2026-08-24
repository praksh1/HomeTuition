import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useDates } from "@/context/DatePreferenceContext";
import { formatDate } from "@/utils/nepaliDate";

/**
 * Choosing which calendar dates are shown in.
 *
 * Bikram Sambat is the default because this is a Nepali product and Bikram Sambat is the civil
 * calendar there. Gregorian stays one tap away rather than being removed: people coordinate with
 * relatives abroad and read international timetables, and forcing either calendar on everybody
 * would be the same mistake in the other direction.
 *
 * Today's date is shown under each option in that option's own format, so the choice is made by
 * looking at the thing rather than by reading a label about it.
 */
export default function DateSystemSetting() {
  const colors = useColors();
  const { system, nepaliNumerals, setSystem, setNepaliNumerals } = useDates();
  const today = new Date();

  const options = [
    {
      id: "bs" as const,
      label: "Nepali (Bikram Sambat)",
      sample: formatDate(today, { system: "bs", nepali: nepaliNumerals, withWeekday: true }),
    },
    {
      id: "ad" as const,
      label: "English (Gregorian)",
      sample: formatDate(today, { system: "ad", withWeekday: true }),
    },
  ];

  return (
    <View style={styles.wrap} testID="date-system-setting">
      <Text style={[styles.title, { color: colors.foreground }]}>Calendar</Text>
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
        Which calendar class dates are shown in.
      </Text>

      {options.map((option) => {
        const active = system === option.id;
        return (
          <TouchableOpacity
            key={option.id}
            testID={`date-system-${option.id}`}
            onPress={() => void setSystem(option.id)}
            activeOpacity={0.8}
            style={[
              styles.option,
              { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary + "10" : colors.card },
            ]}
          >
            <Feather
              name={active ? "check-circle" : "circle"}
              size={18}
              color={active ? colors.primary : colors.mutedForeground}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.optionLabel, { color: colors.foreground }]}>{option.label}</Text>
              <Text style={[styles.optionSample, { color: colors.mutedForeground }]}>{option.sample}</Text>
            </View>
          </TouchableOpacity>
        );
      })}

      {/* Only meaningful alongside Bikram Sambat, so it is hidden rather than greyed for the other. */}
      {system === "bs" && (
        <View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.optionLabel, { color: colors.foreground }]}>Nepali numerals</Text>
            <Text style={[styles.optionSample, { color: colors.mutedForeground }]}>
              {formatDate(today, { system: "bs", nepali: true })} instead of{" "}
              {formatDate(today, { system: "bs", nepali: false })}
            </Text>
          </View>
          <Switch
            testID="date-nepali-numerals"
            value={nepaliNumerals}
            onValueChange={(on) => void setNepaliNumerals(on)}
            trackColor={{ false: colors.border, true: colors.primary }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  title: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 4 },
  option: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderWidth: 1, borderRadius: 12, padding: 14,
  },
  optionLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  optionSample: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 4,
  },
});
