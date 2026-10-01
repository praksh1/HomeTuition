import React from "react";
import AdminLayout from "../../app/(admin)/_layout";
import { useOperatorAccess } from "@/context/OperatorAccessContext";

export default function OperatorDeskLayout() {
  return useOperatorAccess() ? <AdminLayout /> : null;
}
