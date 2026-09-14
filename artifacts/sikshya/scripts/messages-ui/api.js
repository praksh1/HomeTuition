const conversations = [
  {
    otherUserId: 11,
    otherUserName: "Anisha Rai",
    otherUserRole: "student",
    lastMessage: "Can we review question four tomorrow?",
    lastMessageAt: "2026-09-14T18:30:00.000Z",
    unreadCount: 3,
    lastMessageFromMe: false,
  },
  {
    otherUserId: 12,
    otherUserName: "Bikash Thapa",
    otherUserRole: "student",
    lastMessage: "The class notes are attached.",
    lastMessageAt: "2026-09-13T15:00:00.000Z",
    unreadCount: 0,
    lastMessageFromMe: true,
  },
  {
    otherUserId: 13,
    otherUserName: "Sita Gurung",
    otherUserRole: "student",
    lastMessage: "Thank you, teacher.",
    lastMessageAt: "2026-09-12T12:00:00.000Z",
    unreadCount: 0,
    lastMessageFromMe: false,
  },
];

const recipients = [
  { userId: 11, name: "Anisha Rai", role: "student", note: "In IELTS - English" },
  { userId: 14, name: "Prabin Shrestha", role: "student", note: "Follows you" },
];

export async function apiGet(path) {
  if (location.search.includes("failure")) throw new Error("offline");
  return path === "/message-recipients" ? recipients : conversations;
}
