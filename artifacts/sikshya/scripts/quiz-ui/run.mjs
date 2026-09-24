import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-quiz-ui-"));
const bundle = path.join(work, "bundle.js");
execFileSync(process.execPath, [path.resolve(here, "../copy-pdf-worker.js")]);
const built = await bundleForBrowser({ entry: path.join(here, "entry.tsx"), outfile: bundle, alias: {
  "@/utils/api": path.join(here, "api.js"), "expo-router": path.resolve(here, "../messages-ui/router.js"),
  "@/context/DatePreferenceContext": path.resolve(here, "../messages-ui/context.js"),
  "react-native-safe-area-context": path.resolve(here, "../messages-ui/context.js"),
  "expo-font": path.resolve(here, "../batch-planner/font.js"), "expo-document-picker": path.join(here, "picker.js"),
} });
assert.ok(built.ok, built.error);
const server = createServer((req, res) => {
  if (req.url === "/bundle.js" || req.url === "/pdf.worker.min.js") { res.setHeader("Content-Type", "application/javascript"); res.end(readFileSync(req.url === "/bundle.js" ? bundle : path.resolve(here, "../../public/pdf.worker.min.js"))); return; }
  res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex}body{overflow:hidden}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (name, condition) => { assert.ok(condition, name); passed++; console.log(`PASS ${name}`); };
// Synthetic, selectable-text two-page PDF. No real school material leaves the machine.
function pdf() {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>"];
  for (let i = 0; i < 2; i++) {
    const lines = i ? ["2. Capital of Nepal?", "Answer: Kathmandu"] : ["1. What is 2 + 2?", "A) 3", "B) 4", "C) 5", "Answer: B"];
    const content = `BT /F1 12 Tf 50 740 Td ${lines.map((line, n) => `${n ? "0 -20 Td " : ""}(${line.replace(/[()\\]/g, "\\$&")}) Tj`).join("\n")} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 7 0 R >> >> /Contents ${4 + 2 * i} 0 R >>`, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n", offsets = [0];
  objects.forEach((obj, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const start = out.length; out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return out;
}
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); const errors = [];
    page.on("pageerror", e => { errors.push(String(e)); console.error(e); });
    await page.goto(base);
    await page.getByTestId("quiz-create").click();
    await page.getByLabel("Quiz title", { exact: true }).fill("Algebra practice");
    await page.getByRole("button", { name: "Import questions", exact: true }).click();
    await page.evaluate(bytes => {
      const blob = new Blob([bytes], { type: "application/pdf" });
      window.nextQuizFile = { uri: URL.createObjectURL(blob), name: "two-page-quiz.pdf", size: blob.size, mimeType: "application/pdf" };
    }, pdf());
    await page.getByRole("button", { name: "Choose PDF or text file", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Questions to import"]')?.value.includes("Kathmandu"));
    check(`${width}: both PDF pages are extracted locally`, (await page.getByLabel("Questions to import").inputValue()).includes("What is 2 + 2?"));
    await page.getByRole("button", { name: "Convert to reviewable questions", exact: true }).click();
    check(`${width}: imported questions are unconfirmed`, await page.getByText("Needs review", { exact: true }).isVisible());
    check(`${width}: publish blocked before review`, await page.getByTestId("quiz-publish").getAttribute("aria-disabled") === "true");
    await page.getByTestId("quiz-confirm-question").click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    check(`${width}: second page question is editable`, await page.getByLabel("Question text").inputValue() === "Capital of Nepal?");
    await page.getByTestId("quiz-confirm-question").click();
    await page.evaluate(() => { window.holdQuizRequest = true; });
    await page.getByTestId("quiz-save").click();
    await page.waitForFunction(() => typeof window.releaseQuizRequest === "function");
    check(`${width}: saving locks question and answer edits`, !(await page.getByLabel("Question text").isEditable()) && !(await page.getByLabel("Correct short answer").isEditable()));
    check(`${width}: saving locks question navigation`, await page.getByRole("button", { name: "Previous", exact: true }).getAttribute("aria-disabled") === "true");
    await page.evaluate(() => { window.releaseQuizRequest(); delete window.releaseQuizRequest; });
    await page.getByText("Draft saved", { exact: true }).waitFor();
    check(`${width}: draft persists all confirmed questions`, await page.evaluate(() => window.savedQuiz.questions.every(q => q.confirmed)));
    await page.getByLabel("Correct short answer").fill("Kathmandu City");
    check(`${width}: editing invalidates confirmation`, await page.getByText("Needs review", { exact: true }).isVisible());
    await page.getByLabel("Correct short answer").fill("Kathmandu");
    await page.getByTestId("quiz-confirm-question").click(); await page.getByTestId("quiz-save").click();
    await page.getByText("Draft saved", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Preview as student", exact: true }).click();
    check(`${width}: teacher can preview student experience`, await page.getByLabel("Your answer").isVisible());
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(work, `${width}-teacher-preview.png`), fullPage: true });
    await page.getByTestId("quiz-publish").click();
    check(`${width}: publication requires explicit confirmation`, await page.getByText("Ready for your students?", { exact: true }).isVisible());
    await page.evaluate(() => { window.holdQuizRequest = true; });
    await page.getByTestId("quiz-confirm-action").click();
    await page.waitForFunction(() => typeof window.releaseQuizRequest === "function");
    await page.evaluate(() => { window.releaseQuizRequest(); delete window.releaseQuizRequest; });
    await page.getByRole("button", { name: "Student results", exact: true }).waitFor();
    check(`${width}: publish saved and editor locked`, (await page.getByLabel("Question text").count()) === 0);
    await page.getByRole("button", { name: "Student results", exact: true }).click();
    await page.getByText("Student 20", { exact: true }).scrollIntoViewIfNeeded();
    check(`${width}: results scroll without horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.goto(`${base}?student`);
    await page.getByTestId("quiz-row-9").click();
    await page.getByRole("radio", { name: "4", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByLabel("Your answer").fill("Kathmandu");
    await page.getByTestId("quiz-submit").click();
    check(`${width}: student reviews full answer set before final submission`, await page.getByText("Your final answers", { exact: true }).isVisible());
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(work, `${width}-student-submit.png`), fullPage: true });
    await page.evaluate(() => { window.holdQuizRequest = true; });
    await page.getByTestId("quiz-confirm-action").click();
    await page.waitForFunction(() => typeof window.releaseQuizRequest === "function");
    check(`${width}: submitted answers cannot change during the request`, !(await page.getByLabel("Your answer").isEditable()));
    await page.evaluate(() => { window.releaseQuizRequest(); delete window.releaseQuizRequest; });
    await page.getByTestId("quiz-result").waitFor();
    check(`${width}: graded submission is locked`, (await page.getByTestId("quiz-submit").count()) === 0);
    check(`${width}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check(`${width}: no browser exceptions`, errors.length === 0);
    await page.screenshot({ path: path.join(work, `${width}-student-result.png`), fullPage: true });
    await page.close();
  }
  console.log(`${passed} quiz browser checks passed. Screenshots: ${work}`);
} finally { await browser.close(); await new Promise(r => server.close(r)); }
