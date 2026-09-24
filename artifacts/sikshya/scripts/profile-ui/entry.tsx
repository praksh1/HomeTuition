import React from "react";
import { createRoot } from "react-dom/client";

import StudentProfile from "../../app/(student)/profile";
import TeacherProfile from "../../app/(teacher)/profile";
import Onboarding from "../../app/onboarding";
import { AppShellHeader } from "../../components/navigation/AppShellHeader";
import HelpLibrary from "../../app/(admin)/help-library";

const screen = new URLSearchParams(window.location.search).get("screen");
const Component = screen === "library" ? HelpLibrary : screen === "teacher" ? TeacherProfile : screen === "editor" ? Onboarding : StudentProfile;
const role = screen === "teacher" ? "teacher" : "student";
createRoot(document.getElementById("root")!).render(
  screen === "editor" || screen === "library" ? <Component /> : <><AppShellHeader role={role} routeName="profile" /><Component /></>,
);
