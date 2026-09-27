import React from "react";
import { createRoot } from "react-dom/client";

import StudentProfile from "../../app/(student)/profile";
import TeacherProfile from "../../app/(teacher)/profile";
import Onboarding from "../../app/onboarding";
import IdentityVerification from "../../app/identity-verification";
import IdentityReview from "../../app/(admin)/identity-review";
import IdentityHolds from "../../app/(admin)/identity-holds";
import AccountClosure from "../../app/account-closure";
import AccountClosures from "../../app/(admin)/account-closures";
import { AppShellHeader } from "../../components/navigation/AppShellHeader";
import HelpLibrary from "../../app/(admin)/help-library";

const screen = new URLSearchParams(window.location.search).get("screen");
const Component = screen === "closure" ? AccountClosure : screen === "closures" ? AccountClosures : screen === "holds" ? IdentityHolds : screen === "review" ? IdentityReview : screen === "identity" ? IdentityVerification : screen === "library" ? HelpLibrary : screen === "teacher" ? TeacherProfile : screen === "editor" ? Onboarding : StudentProfile;
const role = screen === "teacher" ? "teacher" : "student";
createRoot(document.getElementById("root")!).render(
  ["closure", "closures", "holds", "editor", "library", "identity", "review"].includes(screen ?? "") ? <Component /> : <><AppShellHeader role={role} routeName="profile" /><Component /></>,
);
