# Practice quizzes: release and owner test guide

## What is built

Open **Classes → your class → Homework → Practice quizzes**. Teachers create private drafts, import a text-based PDF or text file (or paste/write questions), review each question and answer, preview the student experience, then explicitly publish. Changing a question clears its review. Published questions cannot change underneath a student's attempt.

Students see only published quizzes for classes they can access. They answer one question at a time, review the complete answer set, and submit once. The server calculates the score; duplicate submissions recover the same saved result. The answer key remains private until the teacher closes submissions (or a configured deadline expires). This is practice, not an accredited exam or an assessment of a person's eligibility.

Teacher results show 20 students at a time with expandable answers and further pages. Publication creates a durable notification for enrolled students, respecting the existing Homework updates preference. No message contains answer keys.

## Import scope and cost

- No AI provider calls or inference fees. PDF extraction happens on the teacher's browser, including phone web browsers. The original document is not uploaded by this importer; saved questions and keys go only to Fadko's authenticated API.
- Up to 8 MB, 25 PDF pages, 60,000 extracted characters and 50 questions per quiz. Questions need numbered headings and one choice/answer per line. Use `quiz-import-example.txt` as a small test.
- All pages are read. The teacher sees the extracted text before converting, then must confirm every question. An unknown answer key stays blank rather than being guessed.
- Supported grading: multiple choice and one exact short answer, ignoring case, Unicode presentation differences and extra spaces. No essays, partial credit, alternative-answer lists or AI judgment in this release.
- Image-only/scanned PDFs, handwriting and diagrams need manual entry. Export Word documents to text-based PDF first. Native installed apps support text/paste; PDF conversion currently requires the web browser.
- Drafts are saved explicitly. Student answers are not saved until final submission; the screen says to keep the page open. This is a known follow-up, not an autosave claim.
- There is no deadline editor in this first UI. The teacher closes submissions manually; backend deadline enforcement is already covered by tests.

## Owner acceptance

1. As the teacher, choose an existing class and open Homework → Practice quizzes → Create a quiz.
2. Give it a title, choose Import questions and import the example text file. Both questions must say Needs review. Publish must remain disabled.
3. Confirm each answer and points, save the draft, then preview as a student. Edit a question: its review must clear. Confirm again, save, and publish through the confirmation dialog.
4. As an enrolled student on another device, open the quiz notification or the same class's Homework. No answer key should be visible. An unrelated account must not access it.
5. Answer both questions, review, and submit. Correct example answers are **4** and **Kathmandu**. Revisit: the score and original answers remain; there is no second attempt.
6. As teacher, open Student results, expand the student's answers, then close submissions. As student, reopen the quiz: the answer key is now visible. A student who has not submitted cannot submit after closure.
7. Refresh Messages, Classes/Sessions and Profile directly as each role. The URL and intended screen should remain, while signed-out/unverified/incomplete accounts still go through their existing gates.

## Deployment and rollback

The API lazily applies only additive quiz tables/indexes under an awaited database advisory lock. Failure returns a quiz-specific unavailable response; auth and payment tables are untouched. Do not run a broad production schema push for this feature. Existing classroom, payment and LiveKit configuration are unchanged.

To withdraw the feature, revert the UI entry point/routes while retaining quiz/attempt rows. Never delete students' submissions as a rollback shortcut. Deployment evidence belongs in `.agents/worklog/2026-09-24-codex-queued-learning-release.md`.
