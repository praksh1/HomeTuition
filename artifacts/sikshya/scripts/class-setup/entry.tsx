import React from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import ClassSetup from "../../components/classes/ClassSetup";
createRoot(document.getElementById("root")!).render(<View style={{ height: "100%" }}><ClassSetup /></View>);
