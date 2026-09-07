import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  mergeMonthlyChatCatchUp,
  monthlyChatCatchUpPath,
  studentMonthlyEmptyCopy,
  submissionsLoadReducer,
} from "./monthlyJourneyState.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..", "app");
const monthly = readFileSync(path.join(app, "(student)", "monthly.tsx"), "utf8");
const homework = readFileSync(path.join(app, "monthly-homework.tsx"), "utf8");
const chat = readFileSync(path.join(app, "monthly-chat.tsx"), "utf8");

test("a missing monthly quote is unavailable and can never become an NPR 0 join", () => {
  assert.doesNotMatch(monthly, /quote\?\.amount\s*\?\?\s*0/);
  assert.match(monthly, /The price is unavailable right now\. Refresh before trying to join\./);
  assert.match(monthly, /joining\?\.quote \? <PaymentSheet[\s\S]*amount=\{joining\.quote\.amount\}/);
});

test("monthly class mutations keep their established endpoint and payment payload", () => {
  assert.match(monthly, /apiPost\(`\/monthly\/classes\/\$\{klass\.id\}\/join`, \{ paymentMethod: method \}\)/);
  assert.match(monthly, /router\.push\(`\/session\/\$\{klass\.today!\.sessionId\}`\)/);
  assert.match(monthly, /pathname: "\/monthly-chat", params: \{ id: String\(klass\.id\) \}/);
  assert.match(monthly, /pathname: "\/monthly-homework", params: \{ id: String\(klass\.id\) \}/);
});

test("homework keeps every upload policy and mutation contract", () => {
  assert.equal((homework.match(/type: \["image\/\*", "application\/pdf"\]/g) ?? []).length, 1);
  assert.match(homework, /apiPost\(`\/monthly\/classes\/\$\{classId\}\/homework`, \{[\s\S]*title: title\.trim\(\),[\s\S]*instructions: instructions\.trim\(\) \|\| undefined,[\s\S]*fileKey,[\s\S]*fileType,/);
  assert.match(homework, /apiPost\(`\/monthly\/homework\/\$\{homework\.id\}\/submit`, \{ fileKey, fileType: file\.mimeType \}\)/);
  assert.match(homework, /apiPost\(`\/monthly\/submissions\/\$\{submission\.id\}\/return`, \{[\s\S]*feedback: feedback\.trim\(\) \|\| undefined,[\s\S]*annotatedKey,[\s\S]*annotatedType,/);
});

test("homework does not turn a failed first load into an empty list", () => {
  assert.match(homework, /\{view && view\.homework\.length === 0 && !setting && \(/);
  assert.match(homework, /!view && <TouchableOpacity[\s\S]*Try again/);
  assert.doesNotMatch(homework, /\(view\?\.homework\.length \?\? 0\) === 0/);
});

test("an empty chat polls the latest page and merges the first incoming message", () => {
  assert.equal(monthlyChatCatchUpPath(41), "/monthly/classes/41/messages");
  assert.equal(monthlyChatCatchUpPath(41, 72), "/monthly/classes/41/messages?after=72");
  const empty = { messages: [] as { id: number; body: string }[], pinned: [], readOnly: false };
  const afterFirstPoll = mergeMonthlyChatCatchUp(empty, {
    messages: [{ id: 73, body: "Class starts now" }],
    pinned: [],
  });
  assert.deepEqual(afterFirstPoll.messages, [{ id: 73, body: "Class starts now" }]);

  const localMessage = { id: 74, body: "I am here" };
  const requestOverlappedLocalSend = mergeMonthlyChatCatchUp(
    { ...afterFirstPoll, messages: [{ id: 72, body: "Earlier" }, localMessage] },
    {
      messages: [
        { id: 73, body: "Class starts now" },
        { id: 74, body: "server-decorated duplicate" },
      ],
      pinned: [],
    },
  );
  assert.deepEqual(requestOverlappedLocalSend.messages.map((message) => message.id), [72, 73, 74]);
  assert.strictEqual(requestOverlappedLocalSend.messages[2], localMessage, "the local stable-id object is preserved");

  const duplicateOnly = mergeMonthlyChatCatchUp(requestOverlappedLocalSend, {
    messages: [{ id: 74, body: "duplicate" }],
    pinned: [],
  });
  assert.strictEqual(duplicateOnly, requestOverlappedLocalSend, "a duplicate-only poll is a no-op");
  assert.match(chat, /monthlyChatCatchUpPath\(classId, newest\)/);
  assert.match(chat, /mergeMonthlyChatCatchUp\(prev, update\)/);
});

test("same-count pinned replacements and content changes are reflected", () => {
  const previous = {
    messages: [] as { id: number; body: string }[],
    pinned: [{ id: 8, body: "Old room" }],
    readOnly: false,
  };
  const swapped = mergeMonthlyChatCatchUp(previous, {
    messages: [],
    pinned: [{ id: 9, body: "New room" }],
  });
  assert.deepEqual(swapped.pinned, [{ id: 9, body: "New room" }]);

  const edited = mergeMonthlyChatCatchUp(swapped, {
    messages: [],
    pinned: [{ id: 9, body: "New room, second floor" }],
  });
  assert.deepEqual(edited.pinned, [{ id: 9, body: "New room, second floor" }]);
});

test("a successful submissions retry exits the previous error state", () => {
  const failed = submissionsLoadReducer<{ id: number }>(
    { rows: null, problem: null },
    { type: "failed", problem: "Connection lost" },
  );
  const recovered = submissionsLoadReducer(failed, { type: "loaded", rows: [{ id: 9 }] });
  assert.deepEqual(recovered, { rows: [{ id: 9 }], problem: null });
  assert.match(homework, /dispatch\(\{ type: "loaded", rows: found\.submissions \?\? \[\] \}\)/);
});

test("the student monthly empty copy reflects whether their own class is already visible", () => {
  assert.equal(studentMonthlyEmptyCopy(true), "No other monthly classes are available right now.");
  assert.equal(studentMonthlyEmptyCopy(false), "No monthly classes are available to join right now.");
  assert.match(monthly, /studentMonthlyEmptyCopy\(mine\.length > 0\)/);
});

test("chat preserves cleanup, optimistic reconciliation and failed-send restoration", () => {
  assert.match(chat, /return \(\) => clearInterval\(timer\)/);
  assert.match(chat, /reactions: applyReaction\(m\.reactions \?\? \[\], emoji\)/);
  assert.match(chat, /setDraft\(body\);\s*setPending\(outgoing\);/);
  assert.match(chat, /apiPost<ChatMessage>\(`\/monthly\/classes\/\$\{classId\}\/messages`, \{[\s\S]*body,[\s\S]*fileKey, fileType: outgoing!\.mimeType, fileName: outgoing!\.name/);
});

test("single-line homework and chat inputs have the shared minimum touch height", () => {
  assert.match(homework, /input: \{[\s\S]*minHeight: HIT_SLOP_MIN/);
  assert.match(chat, /input: \{[\s\S]*minHeight: HIT_SLOP_MIN/);
});

test("the three upgraded screens contain no raw design colors or font sizes", () => {
  for (const [name, source] of [["monthly", monthly], ["homework", homework], ["chat", chat]] as const) {
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/i, `${name} contains a raw hex color`);
    assert.doesNotMatch(source, /fontSize\s*:/, `${name} contains a raw font size`);
  }
});
