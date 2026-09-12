import Svg, { Path, Rect } from "react-native-svg";
import { Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

interface FadkoLogoProps {
  showWordmark?: boolean;
  compact?: boolean;
  color?: string;
  wordmarkColor?: string;
}

/** Fadko's open threshold mark and crimson milestone. */
export function FadkoLogo({
  showWordmark = true,
  compact = false,
  color,
  wordmarkColor,
}: FadkoLogoProps) {
  const colors = useColors();
  const { t, space } = useLayout();
  const markColor = color ?? colors.primary;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Fadko"
      style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
    >
      <Svg
        width={compact ? space.huge : space.huge * 2}
        height={compact ? space.xl : space.huge}
        viewBox="0 0 192 96"
        aria-hidden
      >
        <Path
          d="M18 78h28c8 0 13-4 17-11l32-55c4-7 9-10 17-10h47"
          fill="none"
          stroke={markColor}
          strokeWidth={16}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M80 42h62M102 78h57"
          fill="none"
          stroke={markColor}
          strokeWidth={16}
          strokeLinecap="round"
        />
        <Rect x={122} y={51} width={16} height={16} rx={3} fill={colors.brand} />
      </Svg>
      {showWordmark ? (
        <Text style={[compact ? t.title3 : t.display, { color: wordmarkColor ?? markColor }]}>Fadko</Text>
      ) : null}
    </View>
  );
}
