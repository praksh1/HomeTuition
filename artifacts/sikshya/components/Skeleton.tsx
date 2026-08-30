import React, { useEffect, useRef } from "react";
import { Animated, type DimensionValue } from "react-native";

import { useColors } from "@/hooks/useColors";

/**
 * A grey bar where text is about to be.
 *
 * Cheaper than it looks: the opacity loop runs on the native driver, so it never touches the
 * JavaScript thread and costs nothing on the budget Android this app is built for.
 *
 * Worth having over a spinner because it holds the *shape* of what is coming — the layout does
 * not jump when the numbers land, and on a slow Nepali connection that is most of what "fast"
 * actually feels like. A spinner says "something is happening"; a skeleton says "your classes
 * are on their way, and here is where they will be".
 *
 * It is deliberately not used for a value that failed to load. Loading and unavailable are
 * different claims, and a skeleton that never resolves is a lie that pulses.
 */
export default function Skeleton({
  width,
  height = 14,
  radius = 6,
  tint,
}: {
  width: DimensionValue;
  height?: number;
  radius?: number;
  /** Defaults to the sunk surface. Pass one explicitly on a dark or branded background. */
  tint?: string;
}) {
  const colors = useColors();
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      accessibilityLabel="Loading"
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: tint ?? colors.muted,
        opacity: pulse,
      }}
    />
  );
}
