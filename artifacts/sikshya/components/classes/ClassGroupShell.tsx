import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { readingWidth } from "@/constants/layout";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

export function ClassGroupShell({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  const colors = useColors();
  const { t, gutter, space } = useLayout();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          width: "100%",
          maxWidth: readingWidth,
          alignSelf: "center",
          paddingHorizontal: gutter,
          paddingTop: insets.top + space.md,
          paddingBottom: insets.bottom + space.xxxl,
          gap: space.lg,
        }}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={{
            minHeight: 44,
            minWidth: 44,
            alignSelf: "flex-start",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <View style={{ gap: space.xxs }}>
          <Text
            style={[
              t.caption,
              { color: colors.primary, textTransform: "uppercase" },
            ]}
          >
            {eyebrow}
          </Text>
          <Text style={[t.title1, { color: colors.foreground }]}>{title}</Text>
        </View>
        {children}
      </ScrollView>
    </View>
  );
}
