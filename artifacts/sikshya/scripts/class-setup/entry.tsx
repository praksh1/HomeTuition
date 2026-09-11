import React from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import ClassSetup from "../../components/classes/ClassSetup";
import Classes from "../../app/(teacher)/teaching-classes";
createRoot(document.getElementById("root")!).render(<View style={{ height: "100%" }}>{location.pathname === "/teaching-classes" ? <Classes /> : <ClassSetup />}</View>);
