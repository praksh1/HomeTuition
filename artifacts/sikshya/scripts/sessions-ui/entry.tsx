import React from "react";
import { createRoot } from "react-dom/client";

import StudentSessions from "../../app/(student)/sessions";
import TeacherSessions from "../../app/(teacher)/sessions";

const role = new URLSearchParams(location.search).get("role");

createRoot(document.getElementById("root")!).render(
  role === "teacher" ? <TeacherSessions /> : <StudentSessions />,
);
