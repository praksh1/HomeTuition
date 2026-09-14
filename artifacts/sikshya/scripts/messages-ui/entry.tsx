import React from "react";
import { createRoot } from "react-dom/client";
import ConversationList from "../../components/ConversationList";
import NewMessageScreen from "../../app/new-message";

const picker = location.search.includes("picker");
createRoot(document.getElementById("root")!).render(
  picker ? <NewMessageScreen /> : <ConversationList title="Messages" />,
);
