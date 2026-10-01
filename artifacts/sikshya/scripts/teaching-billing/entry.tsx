import React from "react";
import { createRoot } from "react-dom/client";
import TeachingEarnings from "../../components/commerce/TeachingEarnings";
import TeacherDashboard from "../../app/(teacher)/index";
createRoot(document.getElementById("root")!).render(
  location.search.includes("home") ? <TeacherDashboard /> : <TeachingEarnings />,
);
