import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { t, gutter, space, radius } = useLayout();

  return (
    <LinearGradient
      colors={[colors.secondary, colors.brand]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.6, y: 1 }}
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
    >
      <View style={[styles.header, { paddingTop: space.xxl, paddingBottom: space.md, paddingHorizontal: gutter }]}>
        <Image
          source={require("../assets/images/icon.png")}
          style={[styles.logo, { borderRadius: radius.lg, marginBottom: space.sm }]}
          contentFit="contain"
        />
        <Text style={[t.display, { color: colors.onInverse }]}>Sikshya</Text>
        <Text style={[t.body, styles.centerText, { color: colors.onInverse }]}>Live teaching, built around a shared whiteboard</Text>
        <Text style={[t.caption, { color: colors.onInverseMuted, marginTop: space.xxs }]}>शिक्षा • ज्ञान • समृद्धि</Text>
      </View>

      <View style={[styles.heroContainer, { marginHorizontal: gutter, borderRadius: radius.lg }]}>
        <Image
          source={require("../assets/images/hero_classroom.png")}
          style={styles.heroImage}
          contentFit="cover"
        />
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.scrim }]} />
        <View style={[styles.heroMessage, { left: space.md, right: space.md, bottom: space.md, gap: space.xxs }]}>
          <Text style={[t.title2, { color: colors.onInverse }]}>Teach live. Learn together.</Text>
          <Text style={[t.callout, { color: colors.onInverse }]}>Video, class chat and an interactive whiteboard in one classroom.</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: gutter, paddingTop: space.lg, paddingBottom: space.md, gap: space.sm }}>
        <Text style={[t.callout, styles.centerText, { color: colors.onInverseMuted, marginBottom: space.xxs }]}>Choose your role to get started</Text>

        <TouchableOpacity
          style={[styles.roleButton, { gap: space.sm, backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.sm, padding: space.md }]}
          onPress={() => router.push("/(auth)/login?role=teacher")}
          activeOpacity={0.85}
        >
          <View style={[styles.btnIcon, { borderRadius: radius.sm, backgroundColor: colors.actionSoft }]}>
            <Feather name="book-open" size={20} color={colors.primary} />
          </View>
          <View style={styles.btnTextBlock}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>I am a Teacher</Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>Share your knowledge and run live classes</Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.primary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.roleButton, { gap: space.sm, backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.sm, padding: space.md }]}
          onPress={() => router.push("/(auth)/login?role=student")}
          activeOpacity={0.85}
        >
          <View style={[styles.btnIcon, { borderRadius: radius.sm, backgroundColor: colors.actionSoft }]}>
            <Feather name="users" size={20} color={colors.primary} />
          </View>
          <View style={styles.btnTextBlock}>
            <Text style={[t.bodyStrong, { color: colors.foreground }]}>I am a Student</Text>
            <Text style={[t.caption, { color: colors.mutedForeground }]}>Find a teacher and learn on the shared board</Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: "center" },
  centerText: { textAlign: "center" },
  logo: { width: 80, height: 80 },
  heroContainer: { flex: 1, overflow: "hidden" },
  heroImage: { width: "100%", height: "100%" },
  heroMessage: { position: "absolute" },
  roleButton: { flexDirection: "row", alignItems: "center", borderWidth: 1 },
  btnIcon: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  btnTextBlock: { flex: 1 },
});
