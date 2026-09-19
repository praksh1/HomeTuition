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

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const classConversations = [
  {
    batchId: 11,
    title: "IELTS evening class",
    lastMessage: "Bring the practice sheet to class.",
    lastMessageAt: "2026-09-14T19:00:00.000Z",
    lastSenderName: "Staging Review Teacher",
    unreadCount: 2,
    lastMessageFromMe: true,
  },
  {
    batchId: 12,
    title: "SEE Maths evening tuition",
    lastMessage: "",
    lastMessageAt: null,
    lastSenderName: null,
    unreadCount: 0,
    lastMessageFromMe: false,
  },
];

function twoPagePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 420] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 420] >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return `data:application/pdf;base64,${btoa(pdf)}`;
}

export async function apiGet(path) {
  if (location.search.includes("failure")) throw new Error("offline");
  if (path.startsWith("/storage/file")) {
    if (path.includes("study-guide")) return { url: twoPagePdf() };
    return { url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" };
  }
  if (path === "/message-inbox") return { direct: conversations, classes: classConversations };
  if (path.startsWith("/class-groups/")) {
    return {
      title: "IELTS evening class",
      isTeacher: true,
      messages: [
        ...Array.from({ length: 7 }, (_, index) => ({
          id: 180 + index,
          senderId: index % 2 ? 11 : 7,
          senderName: index % 2 ? "Anisha Rai" : "Staging Review Teacher",
          senderRole: index % 2 ? "student" : "teacher",
          body: `Earlier class message ${index + 1}`,
          createdAt: new Date(Date.now() - (20 - index) * 300_000).toISOString(),
        })),
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
      ...Array.from({ length: 7 }, (_, index) => ({
        id: 80 + index,
        senderId: index % 2 ? 11 : 7,
        receiverId: index % 2 ? 7 : 11,
        body: `Earlier direct message ${index + 1}`,
        read: true,
        createdAt: new Date(Date.now() - (20 - index) * 300_000).toISOString(),
        reactions: [],
      })),
      { id: 101, senderId: 11, receiverId: 7, body: "Can we review question four tomorrow?", read: true, createdAt: new Date(Date.now() - 3_600_000).toISOString(), reactions: [{ emoji: "👍", count: 1, mine: false }] },
      { id: 102, senderId: 7, receiverId: 11, body: "Yes, I added it to our lesson plan.", read: true, createdAt: new Date(Date.now() - 1_800_000).toISOString(), attachments: [
        { fileKey: "message-photo", fileType: "image/png", fileName: "worked-example.png" },
        { fileKey: "study-guide", fileType: "application/pdf", fileName: "study-guide.pdf" },
        { fileKey: "lesson-plan", fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName: "lesson-plan.docx" },
        { fileKey: "marks-sheet", fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName: "marks-sheet.xlsx" },
      ] },
      { id: 104, senderId: 11, receiverId: 7, body: "This is the newest direct message.", read: true, createdAt: new Date(Date.now() - 60_000).toISOString(), reactions: [] },
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
