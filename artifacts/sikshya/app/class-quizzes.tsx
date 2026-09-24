import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ClassGroupShell } from "@/components/classes/ClassGroupShell";
import { ProgramButton, ProgramChip, ProgramNotice } from "@/components/programs/ProgramPieces";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { useDates } from "@/context/DatePreferenceContext";
import { numeric } from "@/constants/typography";
import { apiGet, apiPost, apiPut, apiDelete } from "@/utils/api";
import { parseQuizText, QUIZ_EXAMPLE, type QuizQuestion } from "@/utils/quizDraft";
import { readQuizDocument } from "@/utils/quizDocument";

interface Quiz { id: number; requestKey?: string; title: string; status: string; revision: number; dueAt: string | null; questionCount?: number; questions: QuizQuestion[]; closed?: boolean }
interface Attempt { score: number; possible: number; submittedAt: string; answers: Record<string, string> }
interface Result extends Attempt { id: number; studentName: string }
const blankQuestion = (): QuizQuestion => ({ id: `q${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, prompt: "", kind: "choice", options: ["", "", ""], answer: "", points: 1, confirmed: false });

export default function ClassQuizzesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors(); const { t, space, radius, isWide } = useLayout(); const dates = useDates();
  const [items, setItems] = useState<Quiz[]>([]), [classTitle, setClassTitle] = useState("Your class"), [teacher, setTeacher] = useState(false);
  const [next, setNext] = useState<number | null>(null), [loaded, setLoaded] = useState(false);
  const [quiz, setQuiz] = useState<Quiz | null>(null), [index, setIndex] = useState(0), [dirty, setDirty] = useState(false);
  const [source, setSource] = useState(""), [importing, setImporting] = useState(false), [preview, setPreview] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({}), [attempt, setAttempt] = useState<Attempt | null>(null);
  const [results, setResults] = useState<Result[]>([]), [resultNext, setResultNext] = useState<number | null>(null), [showResults, setShowResults] = useState(false);
  const [expandedResult, setExpandedResult] = useState<number | null>(null);
  const [problem, setProblem] = useState(""), [busy, setBusy] = useState(false), [confirmation, setConfirmation] = useState<"publish" | "submit" | "close" | "discard" | "delete" | null>(null);
  const inFlight = useRef(false);
  const base = `/class-groups/${id}/quizzes`;
  const card = { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.md } as const;
  const input = { borderColor: colors.lineStrong, borderWidth: 1, borderRadius: radius.md, color: colors.foreground, backgroundColor: colors.card, minHeight: 48, padding: space.sm } as const;

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setProblem("");
    try { await action(); } catch (e) { setProblem(e instanceof Error ? e.message : "We could not complete that. Please try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function load(more = false) {
    const data = await apiGet<{ title: string; isTeacher: boolean; items: Quiz[]; nextCursor: number | null }>(`${base}${more && next ? `?before=${next}` : ""}`);
    setClassTitle(data.title); setTeacher(data.isTeacher); setItems(old => more ? [...old, ...data.items] : data.items); setNext(data.nextCursor); setLoaded(true);
  }
  useEffect(() => { void run(() => load()); }, [id]);
  useEffect(() => {
    if (!dirty || Platform.OS !== "web") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function open(quizId: number) {
    const data = await apiGet<{ quiz: Quiz; isTeacher: boolean; attempt: Attempt | null }>(`${base}/${quizId}`);
    setQuiz(data.quiz); setTeacher(data.isTeacher); setAttempt(data.attempt); setAnswers(data.attempt?.answers ?? {}); setIndex(0); setDirty(false); setPreview(false); setShowResults(false); setImporting(false);
  }
  async function listResults(more = false) {
    if (!quiz?.id) return;
    const data = await apiGet<{ items: Result[]; nextCursor: number | null }>(`${base}/${quiz.id}/results${more && resultNext ? `?before=${resultNext}` : ""}`);
    setResults(old => more ? [...old, ...data.items] : data.items); setResultNext(data.nextCursor); setShowResults(true);
  }
  function updateQuestion(changes: Partial<QuizQuestion>) {
    if (inFlight.current) return;
    setQuiz(old => old ? { ...old, questions: old.questions.map((q, i) => i === index ? { ...q, ...changes, confirmed: changes.confirmed === true } : q) } : old); setDirty(true);
  }
  async function save() {
    if (!quiz) return;
    const data = quiz.id ? await apiPut<{ quiz: Quiz }>(`${base}/${quiz.id}`, quiz) : await apiPost<{ quiz: Quiz }>(base, quiz);
    setQuiz(data.quiz); setDirty(false);
  }
  function newDraft() { setQuiz({ id: 0, requestKey: Crypto.randomUUID(), title: "", status: "draft", revision: 1, dueAt: null, questions: [blankQuestion()] }); setIndex(0); setDirty(true); setSource(""); setImporting(false); setPreview(false); setShowResults(false); setAttempt(null); setAnswers({}); setProblem(""); }
  function leaveDraft() { if (inFlight.current) return; if (dirty) setConfirmation("discard"); else { setQuiz(null); void run(() => load()); } }
  function convert(text: string) {
    const questions = parseQuizText(text);
    setQuiz(old => old ? { ...old, questions } : old); setIndex(0); setDirty(true); setImporting(false);
  }
  async function pick() {
    const selected = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "text/plain"], copyToCacheDirectory: true });
    if (selected.canceled || !selected.assets?.[0]) return;
    const text = await readQuizDocument(selected.assets[0]);
    setSource(text); // Always let the teacher inspect/repair extracted text before conversion.
  }
  async function confirm() {
    const action = confirmation; setConfirmation(null);
    if (action === "discard") { setQuiz(null); setDirty(false); await load(); return; }
    if (!quiz) return;
    if (action === "publish") { await apiPost(`${base}/${quiz.id}/publish`, { revision: quiz.revision }); await open(quiz.id); }
    if (action === "close") { await apiPost(`${base}/${quiz.id}/close`, {}); await open(quiz.id); }
    if (action === "delete") { await apiDelete(`${base}/${quiz.id}`); setQuiz(null); await load(); }
    if (action === "submit") { const data = await apiPost<{ attempt: Attempt }>(`${base}/${quiz.id}/submit`, { answers }); setAttempt(data.attempt); }
  }
  const q = quiz?.questions[index];
  const editing = teacher && quiz?.status === "draft" && !preview;
  const answered = quiz?.questions.filter(row => Boolean(answers[row.id]?.trim())).length ?? 0;
  const reviewed = quiz?.questions.filter(row => row.confirmed && row.answer.trim()).length ?? 0;
  const frozen = Boolean(attempt || quiz?.closed || teacher);
  const selected = q ? answers[q.id] : "";
  // Student responses deliberately omit the answer key. Never inspect teacher-only fields
  // while rendering an open student quiz.
  const canConfirm = editing && q && q.prompt.trim() && q.answer.trim() && Number.isInteger(q.points) && q.points > 0 && q.points <= 100 && (q.kind === "short" || (q.options.every(o => o.trim()) && q.options.includes(q.answer)));

  return <ClassGroupShell title={quiz ? quiz.title || "Prepare a quiz" : "Practice quizzes"} eyebrow={classTitle} onBack={quiz ? leaveDraft : undefined}>
    {!quiz ? <>
      <View style={{ gap: space.sm }}>
        <Text style={[t.body, { color: colors.mutedForeground }]}>{teacher ? "Turn your questions into guided practice. You review every answer before students see it." : "Practice at your pace. Your results are private to you and your teacher."}</Text>
        {teacher ? <ProgramButton label="Create a quiz" icon="plus" emphasis="primary" onPress={newDraft} disabled={busy} testID="quiz-create" /> : null}
      </View>
      {!loaded && !problem ? <ActivityIndicator color={colors.primary} /> : null}
      {loaded && !items.length ? <View style={card}><Feather name="check-square" size={28} color={colors.primary} /><Text style={[t.title3, { color: colors.foreground }]}>Space to practise</Text><Text style={[t.body, { color: colors.mutedForeground }]}>{teacher ? "Import a text-based PDF or write a few questions to get started. No AI credits are needed." : "Your teacher’s published quizzes will appear here."}</Text></View> : null}
      {items.map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => void run(() => open(item.id))} testID={`quiz-row-${item.id}`} style={({ pressed }) => [card, { backgroundColor: pressed ? colors.actionSoft : colors.card }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}><ProgramChip label={item.status === "draft" ? "Draft · only you" : item.status === "closed" || (item.dueAt && Date.parse(item.dueAt) <= Date.now()) ? "Closed" : "Open for practice"} /><Feather name="arrow-up-right" size={20} color={colors.primary} /></View>
        <Text style={[t.title3, { color: colors.foreground }]}>{item.title}</Text><Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>{item.questionCount} questions · {item.dueAt ? `Due ${dates.formatBoth(new Date(item.dueAt))}` : "No deadline"}</Text>
      </Pressable>)}
      {next ? <ProgramButton label="Load more quizzes" disabled={busy} onPress={() => void run(() => load(true))} /> : null}
    </> : <>
      <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap", alignItems: "center" }}>
        <ProgramButton label="All quizzes" icon="arrow-left" onPress={leaveDraft} disabled={busy} />
        <ProgramChip label={quiz.status === "draft" ? dirty ? "Unsaved draft" : "Draft saved" : quiz.closed ? "Closed · answers available" : "Published · one attempt"} tone={dirty ? "waiting" : "neutral"} />
      </View>
      {teacher && quiz.status === "draft" ? <View style={card}>
        <Text style={[t.overline, { color: colors.primary }]}>PREPARE · REVIEW · RELEASE</Text>
        <TextInput accessibilityLabel="Quiz title" placeholder="Give this practice a clear title" placeholderTextColor={colors.mutedForeground} value={quiz.title} maxLength={160} onChangeText={title => { setQuiz({ ...quiz, title }); setDirty(true); }} style={[t.title3, input]} editable={!busy} />
        <Text style={[t.callout, { color: colors.mutedForeground }]}>No time limit by default. Close submissions when the class is ready; this reveals the answer key. Short answers match your key exactly, ignoring case and extra spaces.</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          <ProgramButton label={preview ? "Back to editing" : "Preview as student"} icon={preview ? "edit-3" : "eye"} onPress={() => setPreview(!preview)} disabled={busy} />
          <ProgramButton label="Import questions" icon="upload" onPress={() => setImporting(!importing)} disabled={busy} />
        </View>
        {importing ? <View style={{ gap: space.sm }}>
          <Text style={[t.bodyStrong, { color: colors.foreground }]}>Import into this draft</Text>
          <Text style={[t.caption, { color: colors.mutedForeground }]}>This replaces the draft’s questions after conversion. Up to 50 questions; PDF/text up to 8 MB and 25 PDF pages. Word documents: export as a text-based PDF first. Scans and handwriting need manual entry.</Text>
          <ProgramButton label={busy ? "Reading document…" : "Choose PDF or text file"} icon="file-text" disabled={busy} onPress={() => void run(pick)} />
          <TextInput accessibilityLabel="Questions to import" multiline value={source} onChangeText={setSource} editable={!busy} maxLength={60_000} placeholder={QUIZ_EXAMPLE} placeholderTextColor={colors.mutedForeground} style={[t.body, input, { minHeight: 200, textAlignVertical: "top" }]} />
          <ProgramButton label="Convert to reviewable questions" disabled={busy || !source.trim()} onPress={() => void run(async () => convert(source))} />
          <Text style={[t.caption, { color: colors.inkFaint }]}>Read on your device. No document or answer key is sent to an AI provider.</Text>
        </View> : null}
      </View> : null}
      {attempt ? <View style={[card, { backgroundColor: colors.successSoft }]} testID="quiz-result">
        <Text style={[t.overline, { color: colors.success }]}>PRACTICE COMPLETE</Text><Text style={[t.display, numeric, { color: colors.success }]}>{attempt.score} / {attempt.possible}</Text>
        <Text style={[t.body, { color: colors.foreground }]}>Your answers are saved. {quiz.closed ? "Explore the answers below." : "The answer key appears when your teacher closes this quiz."}</Text>
      </View> : null}
      {teacher && quiz.status !== "draft" ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        <ProgramButton label={showResults ? "Back to questions" : "Student results"} icon="bar-chart-2" onPress={() => showResults ? setShowResults(false) : void run(() => listResults())} />
        {!quiz.closed ? <ProgramButton label="Close and release answers" onPress={() => setConfirmation("close")} disabled={busy} /> : null}
      </View> : null}
      {showResults ? <View style={{ gap: space.sm }}>
        <Text style={[t.title2, { color: colors.foreground }]}>Student results</Text>
        {!results.length ? <Text style={[t.body, { color: colors.mutedForeground }]}>No submissions yet. Results appear here after a student submits.</Text> : null}
        {results.map(row => <View style={card} key={row.id}><Pressable accessibilityRole="button" accessibilityLabel={`View ${row.studentName}'s answers`} onPress={() => setExpandedResult(expandedResult === row.id ? null : row.id)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: space.sm }}><Text style={[t.bodyStrong, { color: colors.foreground, flex: 1 }]}>{row.studentName}</Text><Text style={[t.title3, numeric, { color: colors.primary }]}>{row.score} / {row.possible}</Text><Feather name={expandedResult === row.id ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} /></Pressable>
          {expandedResult === row.id ? quiz.questions.map(question => <View key={question.id} style={{ gap: space.xs }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>{question.prompt}</Text><Text style={[t.body, { color: colors.mutedForeground }]}>{row.answers[question.id]}</Text></View>) : null}
        </View>)}
        {resultNext ? <ProgramButton label="Load more results" onPress={() => void run(() => listResults(true))} disabled={busy} /> : null}
      </View> : q ? <View style={card} testID="quiz-question-card">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm }}>
          <Text style={[t.overline, numeric, { color: colors.primary }]}>QUESTION {index + 1} OF {quiz.questions.length}</Text><ProgramChip label={editing ? q.confirmed ? "Reviewed" : "Needs review" : `${q.points} ${q.points === 1 ? "point" : "points"}`} tone={editing && q.confirmed ? "live" : "neutral"} />
        </View>
        {editing ? <>
          <TextInput accessibilityLabel="Question text" value={q.prompt} onChangeText={prompt => updateQuestion({ prompt })} editable={!busy} maxLength={2000} multiline style={[t.title3, input, { minHeight: 96, textAlignVertical: "top" }]} placeholder="What would you like your students to practise?" placeholderTextColor={colors.mutedForeground} />
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>{(["choice", "short"] as const).map(kind => <ProgramButton key={kind} label={kind === "choice" ? "Multiple choice" : "Short answer"} disabled={busy} icon={q.kind === kind ? "check" : undefined} onPress={() => updateQuestion({ kind, answer: "", options: kind === "choice" ? ["", "", ""] : [] })} />)}</View>
          {q.kind === "choice" ? q.options.map((option, i) => <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Pressable accessibilityRole="radio" disabled={busy} accessibilityState={{ checked: Boolean(option) && q.answer === option, disabled: busy }} aria-checked={Boolean(option) && q.answer === option} accessibilityLabel={`Correct answer ${String.fromCharCode(65 + i)}`} onPress={() => updateQuestion({ answer: option })} style={{ minHeight: 48, minWidth: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: option && q.answer === option ? colors.actionSoft : colors.muted }}><Text style={[t.bodyStrong, { color: colors.primary }]}>{String.fromCharCode(65 + i)} {option && q.answer === option ? "✓" : ""}</Text></Pressable>
            <TextInput accessibilityLabel={`Choice ${String.fromCharCode(65 + i)}`} value={option} editable={!busy} maxLength={500} onChangeText={value => updateQuestion({ options: q.options.map((o, j) => j === i ? value : o), answer: q.answer === option ? value : q.answer })} style={[t.body, input, { flex: 1, minWidth: 0 }]} />
          </View>) : <TextInput accessibilityLabel="Correct short answer" value={q.answer} onChangeText={answer => updateQuestion({ answer })} editable={!busy} maxLength={1000} placeholder="Exact accepted answer" placeholderTextColor={colors.mutedForeground} style={[t.body, input]} />}
          {q.kind === "choice" ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}><ProgramButton label="Add choice" disabled={busy || q.options.length >= 6} onPress={() => updateQuestion({ options: [...q.options, ""] })} /><ProgramButton label="Remove last choice" disabled={busy || q.options.length <= 2} onPress={() => updateQuestion({ options: q.options.slice(0, -1), answer: q.answer === q.options.at(-1) ? "" : q.answer })} /></View> : null}
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>Points</Text><TextInput accessibilityLabel="Question points" keyboardType="number-pad" value={String(q.points)} onChangeText={value => updateQuestion({ points: Number(value) })} editable={!busy} maxLength={3} style={[t.body, numeric, input, { width: 96 }]} /></View>
          <ProgramButton label={q.confirmed ? "Question and answer confirmed" : "Confirm question, answer and points"} icon={q.confirmed ? "check-circle" : "check"} disabled={busy || !canConfirm || q.confirmed} onPress={() => updateQuestion({ confirmed: true })} testID="quiz-confirm-question" />
          <Text style={[t.caption, { color: colors.mutedForeground }]}>Editing this question clears its confirmation. Select the correct choice using its letter.</Text>
        </> : <>
          <Text style={[t.title2, { color: colors.foreground }]}>{q.prompt}</Text>
          {q.kind === "choice" ? q.options.map((option, i) => <Pressable key={i} accessibilityRole="radio" accessibilityLabel={option} accessibilityState={{ checked: selected === option, disabled: busy || (frozen && !preview) }} aria-checked={selected === option} aria-disabled={busy || (frozen && !preview)} disabled={busy || (frozen && !preview)} onPress={() => setAnswers(old => ({ ...old, [q.id]: option }))} style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: space.sm, borderWidth: 1, borderRadius: radius.md, padding: space.md, borderColor: selected === option ? colors.primary : colors.border, backgroundColor: selected === option ? colors.actionSoft : colors.card }}><Text style={[t.caption, { color: colors.primary }]}>{String.fromCharCode(65 + i)}</Text><Text style={[t.body, { color: colors.foreground, flex: 1 }]}>{option}</Text>{selected === option ? <Feather name="check-circle" size={20} color={colors.primary} /> : null}</Pressable>) : <TextInput accessibilityLabel="Your answer" value={selected ?? ""} onChangeText={value => setAnswers(old => ({ ...old, [q.id]: value }))} editable={!busy && (!frozen || preview)} maxLength={1000} style={[t.body, input]} placeholder="Write your answer" placeholderTextColor={colors.mutedForeground} />}
          {quiz.closed && q.answer ? <Text style={[t.bodyStrong, { color: colors.success }]}>Answer: {q.answer}</Text> : null}
        </>}
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}><ProgramButton label="Previous" icon="chevron-left" disabled={busy || index === 0} onPress={() => setIndex(index - 1)} /><ProgramButton label="Next" icon="chevron-right" disabled={busy || index >= quiz.questions.length - 1} onPress={() => setIndex(index + 1)} /></View>
      </View> : null}
      {teacher && quiz.status === "draft" ? <View style={{ gap: space.md }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          <ProgramButton label="Add question" icon="plus" disabled={quiz.questions.length >= 50 || busy} onPress={() => { setQuiz({ ...quiz, questions: [...quiz.questions, blankQuestion()] }); setIndex(quiz.questions.length); setDirty(true); setPreview(false); }} />
          <ProgramButton label="Remove this question" disabled={quiz.questions.length <= 1 || busy} onPress={() => { setQuiz({ ...quiz, questions: quiz.questions.filter((_, i) => i !== index) }); setIndex(Math.max(0, index - 1)); setDirty(true); }} />
        </View>
        <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>{reviewed} of {quiz.questions.length} questions reviewed · {dirty ? "Save your draft before publishing" : "Ready to continue when every question is confirmed"}</Text>
        <View style={{ flexDirection: isWide ? "row" : "column", gap: space.sm }}><ProgramButton label="Save draft" icon="save" emphasis={dirty ? "primary" : "secondary"} busy={busy} disabled={!dirty} onPress={() => void run(save)} testID="quiz-save" /><ProgramButton label="Publish quiz" icon="send" emphasis={dirty ? "secondary" : "primary"} disabled={busy || dirty || !quiz.id || reviewed !== quiz.questions.length} onPress={() => setConfirmation("publish")} testID="quiz-publish" /></View>
        {quiz.id ? <ProgramButton label="Delete draft" emphasis="danger" onPress={() => setConfirmation("delete")} disabled={busy} /> : null}
      </View> : !teacher && !attempt && !quiz.closed ? <View style={{ gap: space.sm }}>
        <Text style={[t.caption, numeric, { color: colors.mutedForeground }]}>{answered} of {quiz.questions.length} answered · one final attempt</Text>
        <ProgramButton label="Review and submit" emphasis="primary" disabled={busy || answered !== quiz.questions.length} onPress={() => setConfirmation("submit")} testID="quiz-submit" />
        <Text style={[t.caption, { color: colors.inkFaint }]}>Keep this page open until you submit. Answers are not saved between visits.</Text>
      </View> : null}
    </>}
    {problem ? <ProgramNotice title="Please check" body={problem} tone="stopped" /> : null}
    {!quiz && problem ? <ProgramButton label="Try again" onPress={() => void run(() => load())} disabled={busy} /> : null}
    <Modal visible={confirmation !== null} transparent animationType="fade" onRequestClose={() => setConfirmation(null)}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: space.md, backgroundColor: colors.scrim }}>
        <View style={[card, { width: "100%", maxWidth: 640, maxHeight: "90%" }]} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={{ gap: space.md }}>
            <Text style={[t.title2, { color: colors.foreground }]}>{confirmation === "publish" ? "Ready for your students?" : confirmation === "submit" ? "Your final answers" : confirmation === "close" ? "Close submissions and reveal answers?" : confirmation === "delete" ? "Delete this unpublished draft?" : "Leave without saving?"}</Text>
            <Text style={[t.body, { color: colors.mutedForeground }]}>{confirmation === "publish" ? "These are the exact questions and answers used for grading. Once published, they cannot be edited. Students get one attempt. Answers stay hidden until you close the quiz." : confirmation === "submit" ? "Check your answers below. Once submitted, your answers cannot be changed." : confirmation === "close" ? "Students can no longer submit. Everyone enrolled can see the answer key. Existing results remain saved." : confirmation === "delete" ? "The draft will be removed. Published quizzes and student results cannot be deleted here." : "Your latest changes have not been saved. The last saved version, if any, will remain."}</Text>
            {confirmation === "submit" ? quiz?.questions.map(row => <View key={row.id} style={{ gap: space.xs }}><Text style={[t.bodyStrong, { color: colors.foreground }]}>{row.prompt}</Text><Text style={[t.body, { color: colors.mutedForeground }]}>{answers[row.id]}</Text></View>) : null}
          </ScrollView>
          <ProgramButton label={confirmation === "submit" ? "Submit my answers" : confirmation === "publish" ? "Publish to this class" : "Confirm"} emphasis="primary" onPress={() => void run(confirm)} testID="quiz-confirm-action" />
          <ProgramButton label="Go back" onPress={() => setConfirmation(null)} />
        </View>
      </View>
    </Modal>
  </ClassGroupShell>;
}
