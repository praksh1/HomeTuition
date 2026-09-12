import React from "react";
import { createRoot } from "react-dom/client";
import { BatchTestPanel } from "../../components/classes/BatchTestPanel";
import { BatchTestLedger } from "../../components/classes/BatchTestLedger";
import { BatchTestMoneySummary } from "../../components/classes/BatchTestMoneySummary";
const moneyRole = location.search.includes("money-teacher") ? "teacher" : location.search.includes("money-student") ? "student" : null;
createRoot(document.getElementById("root")!).render(
  location.search.includes("operator")
    ? <BatchTestLedger />
    : moneyRole
      ? <BatchTestMoneySummary role={moneyRole} />
      : <BatchTestPanel batchId={12} teacher={location.search.includes("teacher")} />,
);
