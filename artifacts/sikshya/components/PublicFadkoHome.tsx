import React from "react";
import { Pressable } from "react-native";

import { HIT_SLOP_MIN } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { FadkoLogo } from "./FadkoLogo";

/** Branded home link for pages that can be opened from outside the signed-in app. */
export function PublicFadkoHome({
  onPress,
  inverse = false,
}: {
  onPress: () => void;
  inverse?: boolean;
}) {
  const colors = useColors();
  const { radius, space } = useLayout();
  const foreground = inverse ? colors.onInverse : colors.primary;

  return (
    <Pressable
      testID="public-fadko-home"
      accessibilityRole="link"
      accessibilityLabel="Fadko home"
      onPress={onPress}
      style={{
        minHeight: HIT_SLOP_MIN,
        alignSelf: "flex-start",
        justifyContent: "center",
        paddingHorizontal: space.xs,
        borderRadius: radius.sm,
      }}
    >
      <FadkoLogo compact color={foreground} wordmarkColor={foreground} />
    </Pressable>
  );
}
