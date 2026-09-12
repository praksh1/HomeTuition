import React from "react";
import { createRoot } from "react-dom/client";
import { BatchTestPanel } from "../../components/classes/BatchTestPanel";
import { BatchTestLedger } from "../../components/classes/BatchTestLedger";
createRoot(document.getElementById("root")!).render(location.search.includes("operator") ? <BatchTestLedger /> : <BatchTestPanel batchId={12} teacher={location.search.includes("teacher")} />);
