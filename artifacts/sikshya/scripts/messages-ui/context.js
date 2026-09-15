import React from "react";
import { View } from "react-native";

export function SafeAreaView(props) {
  return React.createElement(View, props);
}

export function useSafeAreaInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function useDates() {
  return { format: () => "28 Bhadra 2083 BS" };
}
