import { Feather } from "@expo/vector-icons";
import type React from "react";
import { Platform, View } from "react-native";
import { HIT_SLOP_MIN, radius, space } from "@/constants/layout";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

/**
 * A quiet, immediate location signal for the main navigation.
 *
 * The whole tab remains the touch target. This is only the visual state: a blue wash, a crisp
 * outline, and a small light bar. It deliberately avoids a looping animation so five tabs do not
 * keep repainting while somebody reads a lesson on an inexpensive phone.
 */
export function PremiumTabIcon({
  name,
  color,
  focused,
  accent,
  soft,
}: {
  name: FeatherName;
  color: string;
  focused: boolean;
  accent: string;
  soft: string;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: HIT_SLOP_MIN,
          height: space.xxl,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: "transparent",
          backgroundColor: "transparent",
        },
        focused && {
          borderColor: accent,
          backgroundColor: soft,
          shadowColor: accent,
          shadowOpacity: 0.2,
          shadowRadius: space.xs,
          shadowOffset: { width: 0, height: space.xxs / 2 },
          ...(Platform.OS === "android" ? { elevation: space.xxs / 2 } : {}),
        },
      ]}
    >
      <Feather name={name} size={space.lg} color={color} />
      {focused ? (
        <View
          style={{
            position: "absolute",
            bottom: space.xxs / 2,
            width: space.sm,
            height: space.xxs / 2,
            borderRadius: radius.pill,
            backgroundColor: accent,
          }}
        />
      ) : null}
    </View>
  );
}
