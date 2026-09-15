import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationPreview,
  conversationTimeLabel,
  filterInboxThreads,
  filterConversations,
  inboxPreview,
  inboxThreads,
  type ConversationSummary,
} from "./conversationList.ts";

const base: ConversationSummary = {
  otherUserId: 1,
  otherUserName: "Anisha Rai",
  otherUserRole: "student",
  lastMessage: "Please check question four",
  lastMessageAt: "2026-09-14T13:00:00.000Z",
  unreadCount: 2,
  lastMessageFromMe: false,
};

test("draft and outgoing previews explain their state in ordinary words", () => {
  assert.deepEqual(conversationPreview(base, "My unfinished reply"), { label: "Draft:", text: "My unfinished reply", draft: true });
  assert.deepEqual(conversationPreview({ ...base, lastMessageFromMe: true }), { label: "You:", text: base.lastMessage, draft: false });
  assert.deepEqual(conversationPreview({ ...base, lastMessage: "" }), { label: "", text: "Attachment", draft: false });
});

test("inbox search and unread filter stay independent and newest-first", () => {
  const older = { ...base, otherUserId: 2, otherUserName: "Bikash Thapa", unreadCount: 0, lastMessageAt: "2026-09-13T13:00:00Z" };
  assert.deepEqual(filterConversations([older, base], "", "all").map((item) => item.otherUserId), [1, 2]);
  assert.deepEqual(filterConversations([older, base], "question", "unread").map((item) => item.otherUserId), [1]);
  assert.deepEqual(filterConversations([older, base], "bik ash", "all").map((item) => item.otherUserId), [2]);
});

test("direct and class discussions share one newest-first inbox", () => {
  const threads = inboxThreads([base], [
    {
      batchId: 9,
      title: "SEE Maths evening tuition",
      lastMessage: "Bring exercise book tomorrow",
      lastMessageAt: "2026-09-14T14:00:00.000Z",
      lastSenderName: "Prakash Teacher",
      unreadCount: 1,
      lastMessageFromMe: false,
    },
    {
      batchId: 10,
      title: "IELTS speaking practice",
      lastMessage: "",
      lastMessageAt: null,
      lastSenderName: null,
      unreadCount: 0,
      lastMessageFromMe: false,
    },
  ]);

  assert.deepEqual(
    filterInboxThreads(threads, "", "all").map((thread) => thread.kind),
    ["class", "direct", "class"],
  );
  assert.deepEqual(
    filterInboxThreads(threads, "maths prakash", "all").map((thread) => thread.kind === "class" ? thread.batchId : thread.otherUserId),
    [9],
  );
  assert.deepEqual(
    filterInboxThreads(threads, "", "classes").map((thread) => thread.kind === "class" ? thread.batchId : thread.otherUserId),
    [9, 10],
  );
  assert.equal(inboxPreview(threads[1]!, undefined).text, "Bring exercise book tomorrow");
  assert.equal(inboxPreview(threads[2]!, undefined).text, "Start the class conversation");
});

test("message-list times follow Nepal's day even when the device is elsewhere", () => {
  const now = Date.parse("2026-09-14T19:00:00.000Z"); // 15 Sep, 00:45 in Nepal
  assert.equal(conversationTimeLabel("2026-09-14T18:30:00.000Z", now, () => "date"), "12:15 AM");
  assert.equal(conversationTimeLabel("2026-09-13T18:30:00.000Z", now, () => "date"), "Yesterday");
  assert.equal(conversationTimeLabel("2026-09-10T10:00:00.000Z", now, () => "date"), "Thu");
  assert.equal(conversationTimeLabel("2026-08-01T10:00:00.000Z", now, () => "28 Shrawan"), "28 Shrawan");
  assert.equal(conversationTimeLabel("not-a-date", now, () => "date"), "");
});
