import React from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import TeachingClasses from "../../app/(teacher)/teaching-classes";

createRoot(document.getElementById("root")!).render(
  <View style={{ height: "100%" }}><TeachingClasses /></View>,
);
