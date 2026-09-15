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
  if (path.startsWith("/class-groups/")) {
    return {
      title: "IELTS evening class",
      isTeacher: true,
      messages: [
        { id: 201, senderId: 7, senderName: "Staging Review Teacher", senderRole: "teacher", body: "Welcome. I pinned tomorrow's reading below.", createdAt: new Date(Date.now() - 5_400_000).toISOString() },
        { id: 202, senderId: 11, senderName: "Anisha Rai", senderRole: "student", body: "Can we review question four tomorrow?", createdAt: new Date(Date.now() - 3_600_000).toISOString() },
      ],
      pinned: [
        { id: 199, senderId: 7, senderName: "Staging Review Teacher", senderRole: "teacher", body: "Bring the practice sheet to class.", createdAt: new Date(Date.now() - 7_200_000).toISOString() },
      ],
      hasEarlier: true,
      beforeCursor: 201,
    };
  }
  if (path.startsWith("/messages/")) {
    return [
      { id: 101, senderId: 11, receiverId: 7, body: "Can we review question four tomorrow?", read: true, createdAt: new Date(Date.now() - 3_600_000).toISOString(), reactions: [{ emoji: "👍", count: 1, mine: false }] },
      { id: 102, senderId: 7, receiverId: 11, body: "Yes, I added it to our lesson plan.", read: true, createdAt: new Date(Date.now() - 1_800_000).toISOString() },
    ];
  }
  return path === "/message-recipients" ? recipients : conversations;
}

export async function apiPost(path, body) {
  if (path.includes("reaction")) return {};
  if (path.startsWith("/class-groups/")) {
    if (path.endsWith("/read")) return {};
    return { id: 203, senderId: 7, senderName: "Staging Review Teacher", senderRole: "teacher", body: body.body, createdAt: new Date().toISOString() };
  }
  return { id: 103, senderId: 7, receiverId: 11, body: body.body, read: false, createdAt: new Date().toISOString() };
}
