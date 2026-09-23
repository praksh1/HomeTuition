import React from "react";
import { Animated, Text, View } from "react-native";
import type { FloatingReaction } from "@/hooks/useClassroomSocket";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

/** A small, non-interactive feedback lane, never a screen-filling confetti overlay. */
export function ClassroomReactions({ reactions }: { reactions: FloatingReaction[] }) {
  const colors = useColors();
  const { t, radius, space } = useLayout();
  return <View testID="classroom-reaction-lane" pointerEvents="none"
    style={{ position: "absolute", right: space.md, bottom: 132, width: 220, height: 144, zIndex: 100 }}>
    {reactions.map((reaction) => <Animated.View key={reaction.id} testID="classroom-floating-reaction"
      style={{ position: "absolute", bottom: 0, left: reaction.x * 180,
        alignItems: "center", gap: space.xxs, opacity: reaction.opacity, transform: [{ translateY: reaction.translateY }] }}>
      <Text style={t.display}>{reaction.emoji}</Text>
      <Text numberOfLines={1} style={[t.overline, { maxWidth: 108, color: colors.mutedForeground,
        backgroundColor: colors.card, paddingHorizontal: space.xs, borderRadius: radius.pill }]}>{reaction.senderName}</Text>
    </Animated.View>)}
  </View>;
}
