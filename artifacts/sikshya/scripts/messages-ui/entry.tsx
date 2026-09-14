import React from "react";
import { createRoot } from "react-dom/client";
import ConversationList from "../../components/ConversationList";
import NewMessageScreen from "../../app/new-message";
import ConversationScreen from "../../app/conversation/[id]";

const picker = location.search.includes("picker");
const conversation = location.search.includes("conversation");
createRoot(document.getElementById("root")!).render(
  conversation ? <ConversationScreen /> : picker ? <NewMessageScreen /> : <ConversationList title="Messages" />,
);
