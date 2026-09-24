/** Run only against a disposable test database: creates synthetic accounts, a lesson and a help article. */
import { execFileSync } from "node:child_process";

const API = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL;
if (!PGURL || !/127\.0\.0\.1|localhost/.test(PGURL)) throw new Error("Use a local disposable test database");
const sql = (statement) => execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-tAc", statement], { encoding: "utf8" }).trim();
let passed = 0;
function check(name, condition, detail = "") {
  if (!condition) throw new Error(`${name}${detail ? ` — ${detail}` : ""}`);
  passed += 1;
  console.log(`  ok   ${name}`);
}
async function api(path, { token, method = "GET", body } = {}) {
  const result = await fetch(`${API}/api${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: result.status, body: await result.json().catch(() => ({})) };
}
let seq = 0;
async function register(name) {
  const email = `support_${Date.now()}_${++seq}@example.com`;
  const result = await api("/auth/register", { method: "POST", body: {
    name, email, password: "password123", role: "student", grade: "10", dateOfBirth: "2000-01-01",
  } });
  if (result.status > 201) throw new Error(`register ${result.status}: ${JSON.stringify(result.body)}`);
  return { ...result.body, email };
}

const owner = await register("Support Test Owner");
const outsider = await register("Support Test Outsider");
const operator = await register("Support Test Operator");
sql(`UPDATE users SET role = 'admin' WHERE id = ${Number(operator.user.id)}`);
const adminLogin = await api("/auth/login", { method: "POST", body: { email: operator.email, password: "password123" } });
const adminToken = adminLogin.body.token;
const slug = `joining-a-class-${Date.now()}`;
const article = { slug, title: "Joining a booked class", intent: "class_access", locale: "en",
  keywords: ["join class", "lesson", "join"], answer: "Open Sessions, choose your lesson, and use Join during the class window." };

console.log("\nReviewed article boundary");
check("an unsigned user cannot use the assistant", (await api("/support/assistant/conversations")).status === 401);
check("a student cannot edit the library", (await api("/admin/support/articles", { token: owner.token })).status === 403);
const created = await api("/admin/support/articles", { token: adminToken, method: "POST", body: article });
check("operator can create a private draft", created.status === 201 && created.body.article?.status === "draft", JSON.stringify(created.body));
const draftSearch = await api("/support/assistant/articles?q=join%20class", { token: owner.token });
check("draft is invisible to students", draftSearch.body.articles?.length === 0, JSON.stringify(draftSearch.body));
const published = await api(`/admin/support/articles/${created.body.article.id}`, { token: adminToken, method: "PUT", body: { ...article, status: "published" } });
check("operator publication records review", published.status === 200 && published.body.article?.reviewedBy === Number(operator.user.id), JSON.stringify(published.body));
const search = await api("/support/assistant/articles?q=join%20class", { token: owner.token });
check("reviewed answer is now searchable", search.body.articles?.some((item) => item.title === article.title));

console.log("\nConversation and human handoff");
const guided = await api("/support/assistant/messages", { token: owner.token, method: "POST", body: { message: "I need help with my account or profile." } });
check("broad account question offers narrow choices", guided.status === 201 && guided.body.suggestedReplies?.some((choice) => choice.label === "Can't sign in"));
const guidedHistory = await api(`/support/assistant/conversations/${guided.body.conversationId}`, { token: owner.token });
check("follow-up choices survive reopening the conversation", guidedHistory.body.suggestedReplies?.length === guided.body.suggestedReplies.length);
const answered = await api("/support/assistant/messages", { token: owner.token, method: "POST", body: { message: "How do I join class?" } });
check("answer uses reviewed words", answered.status === 201 && answered.body.source === "faq" && answered.body.reply?.body === article.answer, JSON.stringify(answered.body));
const conversationId = answered.body.conversationId;
const messageId = answered.body.reply.id;
check("another user cannot read the conversation", (await api(`/support/assistant/conversations/${conversationId}`, { token: outsider.token })).status === 404);
check("another user cannot continue the conversation", (await api("/support/assistant/messages", { token: outsider.token, method: "POST", body: { message: "hello", conversationId } })).status === 404);
check("another user cannot rate the answer", (await api(`/support/assistant/messages/${messageId}/feedback`, { token: outsider.token, method: "POST", body: { helpful: false } })).status === 404);
check("owner can rate the answer", (await api(`/support/assistant/messages/${messageId}/feedback`, { token: owner.token, method: "POST", body: { helpful: true } })).status === 200);
check("another user cannot hand it to an operator", (await api(`/support/assistant/conversations/${conversationId}/request`, { token: outsider.token, method: "POST", body: {} })).status === 404);
const first = await api(`/support/assistant/conversations/${conversationId}/request`, { token: owner.token, method: "POST", body: {} });
check("owner can hand off without repeating the question", first.status === 201 && Number.isInteger(first.body.ticketId));
const again = await api(`/support/assistant/conversations/${conversationId}/request`, { token: owner.token, method: "POST", body: {} });
check("retry returns the same ticket", again.status === 200 && again.body.ticketId === first.body.ticketId);
check("handoff did not create a duplicate ticket", Number(sql(`SELECT count(*) FROM disputes WHERE user_id = ${Number(owner.user.id)} AND id = ${first.body.ticketId}`)) === 1);
const unknown = await api("/support/assistant/messages", { token: outsider.token, method: "POST", body: { message: "Tell me about a policy that Fadko has not published." } });
check("unanswered question becomes an investigation rather than an invented policy", unknown.status === 201 && /trying to do/.test(unknown.body.reply.body));
let lastStatus = 0;
for (let index = 0; index < 12; index += 1) {
  const next = await api("/support/assistant/messages", { token: outsider.token, method: "POST", body: {
    message: `Question ${index + 1} about a not-yet-published policy`, conversationId: unknown.body.conversationId,
  } });
  lastStatus = next.status;
  if (index < 11) check(`ordinary question ${index + 1} stays within the minute limit`, next.status === 201);
}
check("the thirteenth question is rate-limited without another transcript write", lastStatus === 429);

const guide = await api("/support/assistant/messages", { token: owner.token, method: "POST", body: { message: "Where can I see the dates for my class?" } });
check("class dates have a concrete in-app guide without a help article", guide.status === 201 && guide.body.source === "local" && /Schedule/.test(guide.body.reply.body));
const abusive = await api("/support/assistant/messages", { token: owner.token, method: "POST", body: { message: "You are a muji" } });
check("romanised Nepali abuse receives a respectful human route", abusive.status === 201 && /respectful/.test(abusive.body.reply.body));
check("support abuse creates a moderation case for human review", Number(sql(`SELECT count(*) FROM moderation_flags WHERE user_id = ${Number(owner.user.id)} AND surface = 'support_chat_abuse'`)) >= 1);
const reported = await api("/support/assistant/messages", { token: owner.token, method: "POST", body: { message: "My teacher called me a muji" } });
check("a student reporting abuse is not admonished", reported.status === 201 && /sorry you experienced/.test(reported.body.reply.body));
check("a report is labeled separately from abuse by the reporter", Number(sql(`SELECT count(*) FROM moderation_flags WHERE user_id = ${Number(owner.user.id)} AND surface = 'support_safety_report'`)) >= 1);
const bullying = await api("/support/assistant/messages", { token: owner.token, method: "POST", body: { message: "My teacher bullied me" } });
check("bullying without a quoted curse goes to human review", bullying.status === 201 && /Ask a person/.test(bullying.body.reply.body) && Number(sql(`SELECT count(*) FROM moderation_flags WHERE user_id = ${Number(owner.user.id)} AND surface = 'support_safety_report'`)) >= 2);
console.log("\nAccount-scoped lesson investigation");
const investigator = await register("Support Lesson Investigator");
const lessonId = Number(sql(`INSERT INTO sessions (teacher_id, teacher_name, subject, topic, date, duration, price, status) VALUES (${Number(operator.user.id)}, 'Support fixture teacher', 'Maths', 'Private lesson fixture', now(), 60, 500, 'upcoming') RETURNING id`).split("\n")[0]);
sql(`INSERT INTO session_enrollments (session_id, student_id, payment_status) VALUES (${lessonId}, ${Number(investigator.user.id)}, 'test')`);
const ownLessons = await api("/support/assistant/lessons", { token: investigator.token });
check("own test enrollment is available for investigation", ownLessons.body.lessons?.some((item) => item.id === lessonId));
const otherLessons = await api("/support/assistant/lessons", { token: owner.token });
check("another student's lesson is not listed", !otherLessons.body.lessons?.some((item) => item.id === lessonId));
const deniedLesson = await api("/support/assistant/messages", { token: owner.token, method: "POST", body: { message: "Investigate this class", sessionId: lessonId } });
check("forged lesson id is rejected server-side", deniedLesson.status === 404);
const investigate = await api("/support/assistant/messages", { token: investigator.token, method: "POST", body: { message: "My whiteboard is broken", sessionId: lessonId } });
check("selected lesson facts identify test enrollment without inventing payment", investigate.status === 201 && investigate.body.caseContext?.facts?.some((fact) => /no real payment/i.test(fact)), JSON.stringify(investigate.body));
const follow = await api("/support/assistant/messages", { token: investigator.token, method: "POST", body: { message: "Still not working", conversationId: investigate.body.conversationId } });
check("follow-up retains linked lesson", follow.body.caseContext?.sessionId === lessonId);
check("follow-up advances instead of repeating", follow.body.reply.body !== investigate.body.reply.body);
const reloaded = await api(`/support/assistant/conversations/${investigate.body.conversationId}`, { token: investigator.token });
check("case context survives reopening", reloaded.body.caseContext?.sessionId === lessonId);
const sent = await api(`/support/assistant/conversations/${investigate.body.conversationId}/request`, { token: investigator.token, method: "POST", body: {} });
check("human handoff links the session evidence and technical category", sent.status === 201 && sql(`SELECT session_id || ':' || reason FROM disputes WHERE id = ${Number(sent.body.ticketId)}`) === `${lessonId}:Technical Failure`);
check("brief distinguishes user reports from verified records", /User reports \(not independently verified\)/.test(sql(`SELECT description FROM disputes WHERE id = ${Number(sent.body.ticketId)}`)));
const afterHandoff = await api("/support/assistant/messages", { token: investigator.token, method: "POST", body: { message: "more", conversationId: investigate.body.conversationId } });
check("a submitted conversation cannot silently diverge from its ticket", afterHandoff.status === 409);
const racing = await api("/support/assistant/messages", { token: investigator.token, method: "POST", body: { message: "My microphone is not working", sessionId: lessonId } });
check("race fixture conversation created", racing.status === 201);
const racePath = `/support/assistant/conversations/${racing.body.conversationId}/request`;
const [racingMessage, racingHandoff] = await Promise.all([
  api("/support/assistant/messages", { token: investigator.token, method: "POST", body: { message: "Safari on my second phone also fails", conversationId: racing.body.conversationId } }),
  api(racePath, { token: investigator.token, method: "POST", body: {} }),
]);
check("parallel handoff succeeds", racingHandoff.status === 201);
check("parallel message is either saved or explicitly rejected", [201, 409].includes(racingMessage.status));
const raceBrief = sql(`SELECT description FROM disputes WHERE id = ${Number(racingHandoff.body.ticketId)}`);
check("no acknowledged message is lost from the handoff", racingMessage.status !== 201 || raceBrief.includes("Safari on my second phone also fails"));
console.log("\nPayment evidence ownership and meaning");
sql(`UPDATE session_enrollments SET payment_status = 'paid', payment_method = 'khalti', payment_reference = 'SIM-private-fixture-reference' WHERE session_id = ${lessonId} AND student_id = ${Number(investigator.user.id)}`);
sql(`INSERT INTO refunds (session_id, student_id, price_paid, amount, reason, status, note) VALUES (${lessonId}, ${Number(investigator.user.id)}, 500, 250, 'agent_discretion', 'owed', 'private operator note'), (${lessonId}, ${Number(owner.user.id)}, 987654, 987654, 'agent_discretion', 'paid', 'outsider note')`);
const paymentContext = await api(`/support/assistant/conversations/${investigate.body.conversationId}`, { token: investigator.token });
const paymentText = JSON.stringify(paymentContext.body.caseContext);
check("legacy paid simulation is labeled as no real-money charge", /not a real-money charge/.test(paymentText));
check("own refund amount is visible with simulation qualification", /NPR 250/.test(paymentText) && /not proof of real money returned/.test(paymentText));
check("other student's refund and confidential fields never leak", !/987,654|987654|private-fixture-reference|private operator note|outsider note/.test(paymentText));
check("support reads do not alter refund status", sql(`SELECT status FROM refunds WHERE session_id = ${lessonId} AND student_id = ${Number(investigator.user.id)}`) === "owed");
console.log("\nStarter knowledge library");
check("student cannot import editorial drafts", (await api("/admin/support/articles/starter-drafts", { token: owner.token, method: "POST", body: {} })).status === 403);
const imported = await api("/admin/support/articles/starter-drafts", { token: adminToken, method: "POST", body: {} });
check("operator imports ten drafts", imported.status === 200 && imported.body.created === 10, JSON.stringify(imported.body));
const library = await api("/admin/support/articles", { token: adminToken });
const starter = library.body.articles.find((item) => item.slug === "fadko-test-payment");
check("starter has a source-linked review checklist but no publication", starter?.status === "draft" && starter.reviewedBy === null && starter.starterReview?.sources?.length > 0);
const hidden = await api("/support/assistant/articles?q=simulated%20payment", { token: investigator.token });
check("starter drafts stay out of student answers", !hidden.body.articles.some((item) => item.id === String(starter.id)));
await api(`/admin/support/articles/${starter.id}`, { token: adminToken, method: "PUT", body: { ...starter, answer: "Operator edited this draft", status: "archived" } });
const repeatedImport = await api("/admin/support/articles/starter-drafts", { token: adminToken, method: "POST", body: {} });
check("reimport is idempotent", repeatedImport.body.created === 0);
const edited = (await api("/admin/support/articles", { token: adminToken })).body.articles.find((item) => item.id === starter.id);
check("reimport preserves operator edits and archive choice", edited.answer === "Operator edited this draft" && edited.status === "archived" && edited.starterReview === null);
console.log(`\n${passed} support assistant checks passed`);
