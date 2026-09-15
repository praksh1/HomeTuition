import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useDates } from "@/context/DatePreferenceContext";
import { formatDate } from "@/utils/nepaliDate";
import { HIT_SLOP_MIN } from "@/constants/layout";
import { useLayout } from "@/hooks/useLayout";

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
  const { t, space, radius } = useLayout();
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
    <View style={{ gap: space.xs }} testID="date-system-setting">
      <Text style={[t.title3, { color: colors.foreground }]}>Calendar</Text>
      <Text style={[t.callout, { color: colors.mutedForeground, marginBottom: space.xxs }]}>
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
              {
                minHeight: HIT_SLOP_MIN,
                gap: space.sm,
                padding: space.sm,
                borderRadius: radius.sm,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.actionSoft : colors.card,
              },
            ]}
          >
            <Feather
              name={active ? "check-circle" : "circle"}
              size={18}
              color={active ? colors.primary : colors.mutedForeground}
            />
            <View style={{ flex: 1 }}>
              <Text style={[t.bodyStrong, { color: colors.foreground }]}>{option.label}</Text>
              <Text style={[t.caption, { color: colors.mutedForeground, marginTop: space.xxs }]}>{option.sample}</Text>
            </View>
          </TouchableOpacity>
        );
      })}

      {/* Only meaningful alongside Bikram Sambat, so it is hidden rather than greyed for the other. */}
      {system === "bs" && (
        <View style={[styles.row, { minHeight: HIT_SLOP_MIN, gap: space.sm, padding: space.sm, marginTop: space.xxs, borderRadius: radius.sm, borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={{ flex: 1 }}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>Nepali numerals</Text>
            <Text style={[t.caption, { color: colors.mutedForeground, marginTop: space.xxs }]}>
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
  option: {
    flexDirection: "row", alignItems: "center", borderWidth: 1,
  },
  row: {
    flexDirection: "row", alignItems: "center", borderWidth: 1,
  },
});
