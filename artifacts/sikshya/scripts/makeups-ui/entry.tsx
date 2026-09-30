import React from "react";
import { createRoot } from "react-dom/client";
import MakeupsWorkspace from "../../components/classes/MakeupsWorkspace";
createRoot(document.getElementById("root")!).render(
  <MakeupsWorkspace
    operator={new URLSearchParams(location.search).has("operator")}
  />,
);
