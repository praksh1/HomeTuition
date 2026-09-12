import { View } from "react-native";

// The component fixture runs inside Chromium, where the viewport itself is already the safe area.
// The app's real provider supplies device insets; this stand-in keeps the rendered layout honest
// without importing native codegen modules that do not exist in react-native-web.
export const SafeAreaView = View;
export const SafeAreaProvider = View;
export function useSafeAreaInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}
