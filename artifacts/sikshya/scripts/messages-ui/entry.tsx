import React from "react";
import { createRoot } from "react-dom/client";
import ConversationList from "../../components/ConversationList";
import NewMessageScreen from "../../app/new-message";
import ConversationScreen from "../../app/conversation/[id]";
import ClassChatScreen from "../../app/class-chat";
import { ExpiredClassRedirect } from "../../components/classes/ExpiredClassRedirect";
import { ClassmateDirectory } from "../../components/classes/ClassmateDirectory";

const picker = location.search.includes("picker");
const conversation = location.search.includes("conversation");
const classChat = location.search.includes("class-chat");
const expired = location.search.includes("expired-class");
createRoot(document.getElementById("root")!).render(
  location.search.includes("classmates") ? <ClassmateDirectory open onClose={() => { (window as unknown as { lastNavigation?: string }).lastNavigation = "close-directory"; }} userId={7}
    classmates={Array.from({ length: 50 }, (_, i) => ({ userId: i + 7, name: `Classmate ${String(i + 1).padStart(2, "0")}` }))} /> : expired
    ? <ExpiredClassRedirect
        message="This lesson has already ended."
        onDashboard={() => { (window as unknown as { lastNavigation?: string }).lastNavigation = "/student"; }}
      />
    : classChat ? <ClassChatScreen /> : conversation ? <ConversationScreen /> : picker ? <NewMessageScreen /> : <ConversationList title="Messages" />,
);
