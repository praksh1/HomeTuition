import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Text, View } from "react-native";
import { FloatingTabBar } from "../../components/navigation/FloatingTabBar";
import { interfaceFonts } from "../../constants/fontFamilies";
import { desktopSceneInset, space } from "../../constants/layout";
import { numeric } from "../../constants/typography";
import { useLayout } from "../../hooks/useLayout";

const sources = {
  regular: require("@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf"),
  medium: require("@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf"),
  semibold: require("@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf"),
  bold: require("@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf"),
};

function Fixture() {
  const { t, isExpanded } = useLayout();
  const [index, setIndex] = useState(0);
  const routes = ["index", "sessions", "messages", "profile"].map(name => ({ name, key: name }));
  const labels = ["Discover", "Classes", "Messages", "Profile"];
  const descriptors = Object.fromEntries(routes.map((route, i) => [route.key, { options: {
    title: labels[i],
    tabBarBadge: route.name === "messages" ? 11 : undefined,
    tabBarIcon: () => <Text style={t.caption}>{labels[i][0]}</Text>,
  } }]));
  return <>
    <View style={{ padding: space.xl, paddingLeft: isExpanded ? desktopSceneInset + space.xl : space.xl, gap: space.xs }}>
      <Text testID="typography-heading" style={t.title1}>Your next lesson</Text>
      <Text testID="typography-nepali" style={t.body}>नेपाली भाषा · Ready to learn</Text>
      <Text testID="typography-numeric" style={[t.bodyStrong, numeric]}>NPR 1,700 · 09:11</Text>
    </View>
    <FloatingTabBar state={{ index, routes }} descriptors={descriptors} navigation={{
      emit: () => ({}),
      navigate: (name) => setIndex(routes.findIndex(route => route.name === name)),
    }} />
  </>;
}

Promise.all(Object.entries(sources).map(async ([weight, source]) => {
  const face = new FontFace(interfaceFonts[weight as keyof typeof interfaceFonts], `url(${source})`);
  await face.load();
  // React Native's DOM declarations omit this browser FontFaceSet method.
  (document.fonts as FontFaceSet & { add(font: FontFace): FontFaceSet }).add(face);
})).then(() => createRoot(document.getElementById("root")!).render(<Fixture />));
