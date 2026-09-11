import React from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import Planner from "../../app/(teacher)/program-batches/[id]";

createRoot(document.getElementById("root")!).render(<View style={{ height: "100%" }}><Planner /></View>);
