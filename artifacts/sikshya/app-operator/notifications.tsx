import React from "react";
import Notifications from "../app/notifications";
import { useOperatorAccess } from "@/context/OperatorAccessContext";

export default function OperatorNotifications() {
  return useOperatorAccess() ? <Notifications /> : null;
}
