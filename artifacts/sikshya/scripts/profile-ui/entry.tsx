import React from "react";
import { createRoot } from "react-dom/client";

import StudentProfile from "../../app/(student)/profile";
import TeacherProfile from "../../app/(teacher)/profile";
import Onboarding from "../../app/onboarding";

const screen = new URLSearchParams(window.location.search).get("screen");
const Component = screen === "teacher" ? TeacherProfile : screen === "editor" ? Onboarding : StudentProfile;
createRoot(document.getElementById("root")!).render(<Component />);
