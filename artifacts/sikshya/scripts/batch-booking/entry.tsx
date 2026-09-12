import React from "react";
import { createRoot } from "react-dom/client";
import { BatchTestPanel } from "../../components/classes/BatchTestPanel";
createRoot(document.getElementById("root")!).render(<BatchTestPanel batchId={12} teacher={location.search.includes("teacher")} />);
