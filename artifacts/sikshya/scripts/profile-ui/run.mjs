import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";
import { makePdf } from "../board-tests/pdf-fixture.mjs";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-profile-ui-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({
  entry: path.join(here, "entry.tsx"),
  outfile: bundle,
  alias: {
    "@/context/AuthContext": path.join(here, "auth.js"),
    "@/utils/api": path.join(here, "api.js"),
    "@react-navigation/native": path.join(here, "navigation.js"),
    "@/components/SocialSignIn": path.join(here, "social.js"),
    "@/utils/openAttachment": path.join(here, "attachment.js"),
    "@/utils/uploadFile": path.join(here, "upload.js"),
    "@/utils/identityVerification": path.join(here, "identity-upload.js"),
    "expo-router": path.join(here, "router.js"),
    "react-native-safe-area-context": path.join(here, "context.js"),
    "expo-document-picker": path.join(here, "document-picker.js"),
    "expo-haptics": path.join(here, "haptics.js"),
    "expo-font": path.resolve(here, "../batch-planner/font.js"),
  },
});
assert.ok(built.ok, built.error);

const server = createServer((req, res) => {
  if (req.url === "/synthetic-pages.pdf") { res.setHeader("Content-Type", "application/pdf"); res.end(Buffer.from(makePdf(4).split(",")[1], "base64")); return; }
  if (req.url === "/pdf.worker.min.js") { res.setHeader("Content-Type", "application/javascript; charset=utf-8"); res.end(readFileSync(createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs"))); return; }
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8");
  res.end(req.url === "/bundle.js" ? readFileSync(bundle) : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (value, message) => { assert.ok(value, message); passed += 1; console.log(`PASS ${message}`); };

try {
  for (const width of [390, 1440]) {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on("dialog", dialog => dialog.accept());
    page.on("pageerror", (error) => errors.push(String(error)));

    await page.goto(`${base}?screen=closure`);
    await page.getByRole('button',{name:'Request account closure',exact:true}).click();
    check(!await page.evaluate(()=>Boolean(window.closureRequested)),`${width}: closure requires explicit second confirmation`);
    await page.getByRole('button',{name:'Confirm closure request',exact:true}).click();
    await page.getByText('Your request is with Support',{exact:true}).waitFor();
    check(await page.evaluate(()=>window.closureRequested.confirmed===true),`${width}: deliberate request sent`);
    await page.getByRole('button',{name:'Keep my account — cancel request',exact:true}).click();
    check(await page.evaluate(()=>window.closureCancelled.version===0),`${width}: cancellation carries review version`);
    await page.screenshot({path:path.join(work,`closure-${width}.png`),fullPage:true});
    await page.goto(`${base}?screen=closures`);
    await page.getByRole('button',{name:'Review commitments',exact:true}).click();
    await page.getByText('Some payment history needs reconciliation. These counts are not an all-clear.',{exact:true}).waitFor();
    check((await page.locator('body').innerText()).includes('Final closure is not enabled yet'),`${width}: operator cannot mistake preflight for completion`);
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: closure review has no horizontal overflow`);
    await page.screenshot({path:path.join(work,`closure-review-${width}.png`),fullPage:true});
    await page.goto(`${base}?screen=closures&closure-ready=1`);
    await page.getByRole('button',{name:'Review commitments',exact:true}).click();
    await page.getByRole('button',{name:'Close reviewed account',exact:true}).click();
    check(!await page.evaluate(()=>Boolean(window.closureCompleted)),`${width}: operator must confirm permanent closure separately`);
    await page.getByRole('button',{name:'Confirm permanent closure',exact:true}).click();
    await page.getByText('Account sign-in is closed. Video disconnection is queued; verify it before considering access cleanup finished.',{exact:true}).waitFor();
    check(await page.evaluate(()=>window.closureCompleted.version===3&&window.closureCompleted.confirmed===true),`${width}: closure uses the reviewed version and states unfinished media work honestly`);

    await page.goto(`${base}?screen=review`);
    await page.getByTestId("identity-review-item-77").waitFor();
    check(!(await page.locator("body").innerText()).includes("Synthetic Parent Fixture"), `${width}: queue keeps legal identity details private`);
    await page.getByTestId("identity-review-item-77").click();
    await page.getByText("Synthetic Parent Fixture", { exact: true }).waitFor();
    check(await page.getByRole("button", { name: "Approve identity", exact: true }).isDisabled(), `${width}: cannot approve before document review`);
    check((await page.getByTestId("identity-review-details").innerText()).includes("not the student"), `${width}: parent identity is clearly distinguished from student`);
    await page.getByRole("button", { name: "Open private document", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="identity-review-confirm"]')?.getAttribute("aria-disabled") !== "true");
    await page.getByTestId("identity-review-confirm").click();
    await page.getByRole("button", { name: "Approve identity", exact: true }).click();
    check(!await page.evaluate(() => window.identityDecision), `${width}: approval requires a second deliberate confirmation`);
    await page.screenshot({ path: path.join(work, `${width}-private-review.png`), fullPage: true });
    check(await page.getByTestId("identity-review-details").evaluate(node => node.getBoundingClientRect().right <= innerWidth + 1), `${width}: private record fits viewport`);
    await page.getByRole("button", { name: "Save review decision", exact: true }).click();
    await page.getByText(/Review saved/).waitFor();
    check((await page.evaluate(() => window.identityDecision)).decision === "approved", `${width}: confirmed approval is submitted`);
    check(!await page.getByTestId("identity-review-details").count(), `${width}: private fields clear after decision`);

    await page.goto(`${base}?screen=review&pdf=1`);
    await page.getByTestId("identity-review-item-77").click();
    await page.getByRole("button", { name: "Open private document", exact: true }).click();
    await page.getByTestId("pdf-page-4").waitFor();
    await page.getByTestId("identity-review-confirm").click();
    for (let number = 1; number <= 4; number++) {
      await page.getByTestId(`pdf-page-${number}`).scrollIntoViewIfNeeded();
      await page.waitForFunction(n => { const canvas = document.querySelector(`[data-testid="pdf-page-${n}"] canvas`); return canvas && canvas.width > 1; }, number);
    }
    await page.getByRole("button", { name: "Approve identity", exact: true }).click();
    check(await page.getByTestId("identity-review-decision").isVisible(), `${width}: a real multipage PDF can be reviewed before approval`);
    check(!await page.evaluate(() => window.identityDecision), `${width}: merely reviewing PDF pages does not approve a document`);
    await page.getByRole("button", { name: "Close private record", exact: true }).click();
    check(!await page.getByTestId("identity-review-preview").count(), `${width}: closing review removes the PDF and private metadata`);

    await page.goto(`${base}?screen=review&broken=1`);
    await page.getByTestId("identity-review-item-77").click();
    await page.getByRole("button", { name: "Open private document", exact: true }).click();
    await page.getByText("This image could not be displayed.", { exact: true }).waitFor();
    await page.getByTestId("identity-review-confirm").click();
    check(await page.getByRole("button", { name: "Approve identity", exact: true }).isDisabled(), `${width}: an unreadable preview cannot be approved`);
    await page.getByRole("radio", { name: "Document is unreadable" }).click();
    await page.getByRole("button", { name: "Request a correction", exact: true }).click();
    await page.getByRole("button", { name: "Save review decision", exact: true }).click();
    await page.getByText(/Review saved/).waitFor();
    check((await page.evaluate(() => window.identityDecision)).rejectionCode === "unreadable", `${width}: an unreadable file can receive a specific correction request`);

    await page.goto(`${base}?screen=review&denied=1`);
    await page.getByText("You do not have identity-review access.", { exact: true }).waitFor();
    check(!await page.getByTestId("identity-review-item-77").count(), `${width}: denied operator sees no review records`);

    await page.goto(`${base}?screen=holds`);
    await page.getByTestId("identity-hold-number").fill("77");
    await page.getByRole("button", { name: "Load preservation status", exact: true }).click();
    await page.getByTestId("identity-hold-record").waitFor();
    check(!(await page.locator("body").innerText()).includes("Synthetic Parent Fixture"), `${width}: preservation workspace does not fetch or expose legal details`);
    await page.getByTestId("identity-hold-case").fill("3");
    await page.getByRole("button", { name: "Preserve for investigation", exact: true }).click();
    check(!await page.evaluate(() => window.identityHoldMutation), `${width}: a hold requires explicit confirmation`);
    await page.getByRole("button", { name: "Confirm preservation action", exact: true }).click();
    await page.getByText("Preservation active", { exact: true }).waitFor();
    check((await page.evaluate(() => window.identityHoldMutation)).caseId === 3, `${width}: preservation is linked to an explicit case`);
    await page.getByRole("button", { name: "Keep hold after review", exact: true }).click();
    await page.getByRole("button", { name: "Confirm preservation action", exact: true }).click();
    await page.waitForFunction(() => window.identityHoldMutation?.action === "review");
    check((await page.evaluate(() => window.identityHoldMutation)).version === 1, `${width}: periodic review uses current revision`);
    await page.getByRole("button", { name: "Release preservation hold", exact: true }).click();
    check((await page.getByTestId("identity-hold-confirmation").innerText()).includes("Already-due data may be deleted"), `${width}: releasing a hold warns about original retention deadlines`);
    await page.screenshot({ path: path.join(work, `${width}-identity-holds.png`), fullPage: true });
    check(await page.getByTestId("identity-hold-record").evaluate(node => node.getBoundingClientRect().right <= innerWidth + 1), `${width}: preservation controls fit viewport`);
    await page.getByRole("button", { name: "Confirm preservation action", exact: true }).click();
    await page.getByText("No active hold", { exact: true }).waitFor();
    check((await page.evaluate(() => window.identityHoldMutation)).action === "release", `${width}: release remains an operator action`);
    await page.goto(`${base}?screen=holds&stale=1`);
    await page.getByTestId("identity-hold-number").fill("77");
    await page.getByRole("button", { name: "Load preservation status", exact: true }).click();
    await page.getByTestId("identity-hold-case").fill("3");
    await page.getByRole("button", { name: "Preserve for investigation", exact: true }).click();
    await page.getByRole("button", { name: "Confirm preservation action", exact: true }).click();
    await page.getByText("This hold changed. Reload the record before deciding.", { exact: true }).waitFor();
    check(!await page.getByTestId("identity-hold-record").count(), `${width}: stale action requires a fresh record instead of silent retry`);

    await page.goto(`${base}?screen=library`);
    await page.getByTestId("help-starter-import").click();
    await page.getByText("Starter payment guide", { exact: true }).waitFor();
    check((await page.getByTestId("help-starter-notice").textContent()).includes("Review each answer"), `${width}: importing guides does not publish them`);
    await page.getByTestId("help-library-search").fill("no such guide");
    check(await page.getByText("No matching answers. Try another search.").isVisible(), `${width}: editorial search has an empty state`);
    await page.getByTestId("help-library-search").fill("payment");
    await page.getByText("Starter payment guide", { exact: true }).click();
    await page.getByTestId("help-starter-review").waitFor();
    // Capture the settled slide sheet, not an intermediate animation frame.
    await page.waitForTimeout(400);
    check(await page.getByTestId("help-starter-review").isVisible(), `${width}: source review checklist is visible before publishing`);
    check(await page.getByTestId("help-starter-review").evaluate((node) => node.getBoundingClientRect().right <= innerWidth + 1), `${width}: review checklist fits the viewport`);
    await page.screenshot({ path: path.join(work, `${width}-support-library.png`), fullPage: true });
    await page.getByTestId("help-article-publish").scrollIntoViewIfNeeded();
    check(await page.getByTestId("help-article-publish").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight + 1 && rect.height >= 44;
    }), `${width}: publication action is reachable inside the editor`);
    await page.getByRole("button", { name: "Close editor" }).click();
    await page.getByTestId("help-starter-import").click();
    await page.getByText("Starter drafts already exist. Your edits and publication choices were preserved.").waitFor();
    check(await page.getByText("Starter payment guide", { exact: true }).count() === 1, `${width}: repeated import has no duplicate card`);

    await page.goto(`${base}?screen=student`);
    await page.getByText("MY FADKO PROFILE", { exact: true }).waitFor();
    await page.getByTestId("student-account-details").waitFor();
    let body = await page.locator("body").innerText();
    check(body.includes("Account & payments"), `${width}: student account actions have a clear section`);
    check(body.includes("Charges, test payments and refunds"), `${width}: payments action explains its destination`);
    check(!body.includes("No saved payment method"), `${width}: empty payment-method explanation is gone`);
    check((await page.getByTestId("profile-overflow-trigger").boundingBox()).height >= 44, `${width}: profile overflow menu meets touch floor`);
    await page.getByTestId("profile-overflow-trigger").click();
    await page.getByTestId("profile-overflow-menu").waitFor();
    body = await page.locator("body").innerText();
    check(body.includes("Fadko Support") && body.includes("Ask Fadko") && body.includes("Quick answers"), `${width}: student profile menu offers working support and assistant`);
    check(await page.getByTestId("profile-overflow-menu").evaluate((node) => node.getBoundingClientRect().right <= innerWidth + 1), `${width}: student profile menu stays inside the viewport`);
    const studentMenuText = await page.getByTestId("profile-overflow-menu").textContent();
    check(studentMenuText.includes("Account") && studentMenuText.includes("Learning") && studentMenuText.includes("Money") && studentMenuText.includes("Help"), `${width}: student menu has a real information hierarchy`);
    await page.getByRole("button", { name: "Close menu" }).last().click();
    await page.getByTestId("support-assistant-launcher").click();
    await page.getByTestId("support-assistant-panel").waitFor();
    check(await page.getByTestId("support-assistant-panel").evaluate((node) => node.getBoundingClientRect().right <= innerWidth + 1), `${width}: support panel fits the screen`);
    check(await page.getByTestId("support-assistant-panel").evaluate((node) => node.getBoundingClientRect().top >= -1 && node.getBoundingClientRect().bottom <= innerHeight + 1), `${width}: support panel stays within viewport height`);
    check(await page.getByTestId("support-topic-classes").isVisible(), `${width}: quick topics are available before the first question`);
    check(await page.getByRole("button", { name: /Open previous conversation: Earlier class question/ }).isVisible(), `${width}: past chats are available without replacing a new topic`);
    await page.getByTestId("support-assistant-input").fill("How do I join my class?");
    await page.getByTestId("support-assistant-input").click();
    // Exercise the input's native keydown handler directly; RN Web blurs this field on Enter.
    await page.getByTestId("support-assistant-input").evaluate((node) => node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    await page.getByText("Open Sessions and choose your lesson.", { exact: true }).waitFor();
    check((await page.getByTestId("support-assistant-panel").innerText()).includes("How do I join my class?"), `${width}: Enter sends the question on web`);
    check((await page.getByTestId("support-assistant-panel").innerText()).includes("From Fadko Help: Joining a booked class"), `${width}: reviewed answer is attributed`);
    check(await page.getByTestId("support-topic-classes").count() === 0, `${width}: topic shortcuts give way to the conversation`);
    check(await page.getByTestId("support-change-topic").isVisible(), `${width}: switching topics has an explicit action in the chat`);
    await page.getByRole("button", { name: "Start a new support conversation" }).click();
    await page.getByTestId("support-topic-classes").click();
    await page.getByRole("button", { name: "Can't join a lesson" }).waitFor();
    check(await page.getByTestId("support-suggested-reply").count() === 2, `${width}: a broad question has concise next-step choices`);
    await page.getByRole("button", { name: "Can't join a lesson" }).click();
    await page.getByText("Open Sessions and choose your lesson.", { exact: true }).waitFor();
    check(await page.getByTestId("support-suggested-reply").count() === 0, `${width}: follow-up choices clear after a specific answer`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(work, `${width}-support-answer.png`) });
    await page.getByTestId("support-assistant-open-request").click();
    await page.getByText(/Sent to Fadko Support as FDK-17/).waitFor();
    check((await page.getByTestId("support-assistant-panel").innerText()).includes("Sent to a person"), `${width}: human handoff confirms the request`);
    await page.screenshot({ path: path.join(work, `${width}-support-handoff.png`) });
    await page.getByTestId("support-assistant-close").click();
    await page.getByTestId("support-assistant-launcher").click();
    check(await page.getByTestId("support-topic-classes").isVisible(), `${width}: reopening Support starts at a fresh topic`);
    await page.getByRole("button", { name: "Choose a class for support" }).click();
    await page.getByRole("textbox", { name: "Search your classes" }).fill("Lesson 50");
    await page.getByRole("button", { name: "Lesson 50 · #50", exact: true }).click();
    await page.getByTestId("support-assistant-input").fill("My PDF is not visible");
    await page.getByTestId("support-assistant-send").click();
    await page.getByText("Which device are you using?", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Show records checked for this case" }).click();
    await page.waitForTimeout(400);
    check(await page.getByRole("button", { name: "Show records checked for this case" }).evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    }), `${width}: expanding long payment records does not jump away from the card`);
    check((await page.getByTestId("support-assistant-panel").innerText()).includes("No real payment is established"), `${width}: selected lesson shows qualified account facts, not payment assumptions`);
    check(await page.getByTestId("support-assistant-panel").evaluate((node) => node.getBoundingClientRect().top >= -1 && node.getBoundingClientRect().right <= innerWidth + 1), `${width}: class investigation fits with records expanded`);
    await page.screenshot({ path: path.join(work, `${width}-support-investigation.png`) });
    await page.getByRole("button", { name: "Start a new support conversation" }).click();
    await page.getByRole("button", { name: /Open previous conversation: Earlier class question/ }).click();
    await page.getByText("Earlier answer", { exact: true }).waitFor();
    check((await page.getByTestId("support-assistant-panel").innerText()).includes("Earlier class question"), `${width}: past chat can be reopened deliberately`);
    await page.getByTestId("support-assistant-close").click();
    check((await page.getByTestId("student-edit-account-details").boundingBox()).height >= 44, `${width}: student edit action meets touch floor`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: student profile has no horizontal overflow`);
    await page.screenshot({ path: path.join(work, `${width}-student.png`), fullPage: true });

    await page.goto(`${base}?screen=teacher&role=teacher`);
    await page.getByText("MY TEACHING PROFILE", { exact: true }).waitFor();
    await page.getByTestId("teacher-account-details").waitFor();
    body = await page.locator("body").innerText();
    check(body.includes("Teaching tools"), `${width}: teacher tools are grouped`);
    await page.getByTestId("profile-overflow-trigger").click();
    await page.getByTestId("profile-overflow-menu").waitFor();
    body = await page.locator("body").innerText();
    check(body.includes("Teaching & earnings") && body.includes("Personal information"), `${width}: teacher profile menu exposes high-frequency actions`);
    check(await page.getByTestId("profile-overflow-menu").evaluate((node) => node.getBoundingClientRect().right <= innerWidth + 1), `${width}: teacher profile menu stays inside the viewport`);
    const teacherMenuText = await page.getByTestId("profile-overflow-menu").textContent();
    check(teacherMenuText.includes("Teaching") && teacherMenuText.includes("Money") && teacherMenuText.includes("Help"), `${width}: teacher menu is grouped for scanning`);
    await page.getByRole("button", { name: "Close menu" }).last().click();
    check(!body.includes("National ID / Citizenship"), `${width}: teacher document forms start collapsed`);
    check((await page.getByTestId("teacher-credentials-toggle").boundingBox()).height >= 44, `${width}: credentials disclosure meets touch floor`);
    await page.getByTestId("teacher-credentials-toggle").click();
    await page.getByText("Teaching License", { exact: true }).waitFor();
    check((await page.locator("body").innerText()).includes("0 approved · 0 submitted"), `${width}: citizenship is not counted as a teaching qualification`);
    check(!await page.getByText("National ID / Citizenship", { exact: true }).count(), `${width}: no citizenship upload shortcut in general qualifications`);
    check(await page.getByRole("button", { name: "Open private identity verification", exact: true }).isVisible(), `${width}: identity has a dedicated private route`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: teacher profile has no horizontal overflow`);
    await page.screenshot({ path: path.join(work, `${width}-teacher.png`), fullPage: true });

    await page.goto(`${base}?screen=editor&role=teacher`);
    await page.getByText("Contact", { exact: true }).waitFor();
    body = await page.locator("body").innerText();
    check(body.includes("Location") && body.includes("Teaching affiliation"), `${width}: account editor is divided into three plain-language sections`);
    check(body.includes("Your phone stays private"), `${width}: editor explains phone privacy where it is entered`);
    await page.getByTestId("account-province").click();
    await page.getByPlaceholder("Search provinces").fill("Koshi");
    check(await page.getByText("Koshi Province", { exact: true }).isVisible(), `${width}: province picker is searchable`);
    await page.getByText("Koshi Province", { exact: true }).click();
    await page.getByTestId("account-district").click();
    check(await page.getByText("Morang", { exact: true }).isVisible(), `${width}: district choices follow the province`);
    await page.getByText("Morang", { exact: true }).click();
    check((await page.getByTestId("account-local-level").getAttribute("aria-disabled")) !== "true", `${width}: municipality unlocks after district selection`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: account editor has no horizontal overflow`);
    check(errors.length === 0, `${width}: profile flows have no browser exceptions`);
    await page.screenshot({ path: path.join(work, `${width}-editor.png`), fullPage: true });

    await page.goto(`${base}?screen=editor&profile=load-error`);
    await page.getByTestId("account-load-error").waitFor();
    check(await page.getByTestId("account-save").count() === 0, `${width}: load failure cannot expose a blank save form`);
    check(await page.getByTestId("account-phone").count() === 0, `${width}: load failure cannot overwrite saved phone details`);
    check((await page.getByTestId("account-load-retry").boundingBox()).height >= 44, `${width}: retry meets touch target floor`);
    await page.screenshot({ path: path.join(work, `${width}-editor-retry.png`), fullPage: true });
    await page.evaluate(() => { window.retryAccountLoad = true; });
    await page.getByTestId("account-load-retry").click();
    await page.getByTestId("account-phone").waitFor();
    check(await page.getByTestId("account-phone").inputValue() === "+977 9800000000", `${width}: retry restores saved account data`);
    check(await page.getByTestId("account-load-error").count() === 0, `${width}: successful retry clears error state`);
    check(!await page.evaluate(() => !!window.lastSavedAccount), `${width}: retry does not write account data`);

    await page.goto(`${base}?screen=editor&profile=incomplete`);
    await page.getByText("Contact", { exact: true }).waitFor();
    check((await page.getByTestId("account-phone").inputValue()) === "", `${width}: an incomplete legacy account does not invent a phone`);
    check((await page.getByTestId("account-province").innerText()).includes("Choose province"), `${width}: an incomplete legacy account does not preselect a province`);
    check((await page.getByTestId("account-district").innerText()).includes("Choose province first"), `${width}: district waits for the person's province`);
    await page.getByTestId("account-province").click();
    await page.getByText("Koshi Province", { exact: true }).click();
    check((await page.getByTestId("account-province").innerText()).includes("Koshi Province"), `${width}: Province can be chosen before Phone`);
    check((await page.getByTestId("account-district").getAttribute("aria-disabled")) !== "true", `${width}: choosing Province unlocks District even while Phone is empty`);
    await page.getByTestId("account-phone").fill("98023445677");
    await page.getByTestId("account-save").click();
    check(await page.getByTestId("account-phone-error").isVisible(), `${width}: an eleven-digit local phone is rejected beside Phone`);
    check((await page.getByTestId("account-province").innerText()).includes("Koshi Province"), `${width}: invalid Phone does not erase the selected Province`);
    await page.getByTestId("account-phone").fill("");
    await page.getByTestId("account-save").click();
    check(await page.getByTestId("account-phone-error").isVisible(), `${width}: Save points to the missing phone beside the field`);
    check((await page.getByTestId("account-province-error").count()) === 0, `${width}: Save does not blame a valid-looking location for a missing phone`);
    await page.getByTestId("account-phone").fill("+977 9800000000");
    check((await page.getByTestId("account-phone-error").count()) === 0, `${width}: correcting the phone clears its error immediately`);
    await page.getByTestId("account-save").click();
    check(await page.getByTestId("account-district-error").isVisible(), `${width}: validation advances to District after preserving the chosen Province`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: validation does not create horizontal overflow`);
    await page.screenshot({ path: path.join(work, `${width}-editor-errors.png`), fullPage: true });

    await page.goto(`${base}?screen=editor&profile=fixture`);
    await page.getByText("Please confirm your details", { exact: true }).waitFor();
    check((await page.getByTestId("account-phone").inputValue()) === "", `${width}: adding a phone does not legitimise synthetic fixture details`);
    check((await page.getByTestId("account-province").innerText()).includes("Choose province"), `${width}: known test defaults are never presented as a chosen province`);
    check((await page.getByTestId("account-district").innerText()).includes("Choose province first"), `${width}: known test defaults do not cascade into a district`);
    check((await page.getByTestId("account-details-confirmation").innerText()).includes("instead of guessing them"), `${width}: the person is told why the fields are unselected`);
    check((await page.getByTestId("account-institution").count()) === 0, `${width}: institution input waits for an affiliation choice`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: confirmation guidance does not create horizontal overflow`);
    await page.screenshot({ path: path.join(work, `${width}-editor-fixture.png`), fullPage: true });
    for (const role of ["teacher", "student"]) {
      await page.goto(`${base}?screen=editor&role=${role}`);
      await page.getByTestId("account-save").click();
      check(await page.getByText("Select and upload a profile photo before saving.", { exact: true }).isVisible(), `${width}: ${role} must upload a photo even in edit mode`);
      check(!await page.evaluate(() => !!window.lastSavedAccount), `${width}: ${role} missing photo does not submit details`);
      await page.evaluate(() => window.testPhotoSelected = true);
      await page.getByText("Select photo", { exact: true }).click();
      await page.getByText("Upload selected photo", { exact: true }).click();
      await page.getByText("Photo uploaded — choose a replacement", { exact: true }).waitFor();
      check(await page.evaluate(() => window.photoUploaded === "fixture"), `${width}: ${role} upload uses the profile-photo endpoint`);
      await page.getByTestId("account-save").click();
      check(await page.evaluate(() => window.lastSavedAccount?.path === "/onboarding/me"), `${width}: ${role} valid account can save after photo upload`);
    }
    await page.goto(`${base}?screen=identity&identity=new&role=student`);
    await page.getByText("No citizenship document needed", { exact: true }).waitFor();
    check(await page.getByTestId("identity-submit").count() === 0, `${width}: student identity upload is not offered`);
    check(await page.evaluate(() => !window.identityStatusReads && !window.identityPrepared), `${width}: student route does not request or prepare identity records`);
    await page.goto(`${base}?screen=identity&identity=disabled&role=teacher`);
    await page.getByText("Identity upload is not open yet", { exact: true }).waitFor();
    check(await page.getByTestId("identity-submit").count() === 0, `${width}: disabled identity collection has no upload form`);
    await page.goto(`${base}?screen=identity&identity=failure&role=teacher`);
    await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
    check(await page.getByTestId("identity-submit").count() === 0, `${width}: status failure never masquerades as missing identity`);
    await page.goto(`${base}?screen=identity&identity=rejected&role=teacher`);
    await page.getByText("Needs a correction", { exact: true }).waitFor();
    check((await page.locator("body").innerText()).includes("sharper photo"), `${width}: rejected document has an actionable correction`);
    await page.goto(`${base}?screen=identity&identity=new&role=teacher`);
    check(await page.getByTestId("identity-holder-parent").count() === 0, `${width}: teacher can submit only their own citizenship`);
    await page.getByTestId("identity-submit").click();
    check(await page.getByTestId("identity-legalName-error").isVisible(), `${width}: missing identity field has an inline error and is brought into view`);
    check(!await page.evaluate(() => window.identityPrepared), `${width}: invalid form never starts an upload`);
    check(await page.getByTestId("identity-dateOfBirth-bs").getAttribute("aria-checked") === "true", `${width}: private DOB defaults to Nepali BS`);
    await page.getByTestId("identity-dateOfBirth").fill("2000-01-01");
    check((await page.getByTestId("identity-dateOfBirth-equivalent").innerText()).includes("1943-04-14"), `${width}: private DOB shows the exact equivalent`);
    await page.getByTestId("identity-dateOfBirth-ad").click();
    check(await page.getByTestId("identity-dateOfBirth").inputValue() === "1943-04-14", `${width}: private DOB calendar switch preserves the birthday`);
    for (const [key, value] of Object.entries({ legalName: "Synthetic Teacher", documentNumber: "NOT-A-REAL-ID", dateOfBirth: "1980-01-01", issuingDistrict: "Kathmandu", issuingMunicipality: "Kathmandu" })) await page.getByTestId(`identity-${key}`).fill(value);
    await page.evaluate(() => { window.testIdentitySelected = true; window.failIdentityUpload = true; });
    await page.getByTestId("identity-file").click();
    await page.getByTestId("identity-consent").click();
    await page.getByTestId("identity-submit").click();
    await page.getByText("Your form has been saved privately. Retry the upload without re-entering the details.", { exact: true }).waitFor();
    check(await page.getByTestId("identity-legalName").inputValue() === "Synthetic Teacher", `${width}: failed upload preserves form details`);
    check(await page.evaluate(() => window.identityPrepared.holder === "self" && window.identityPrepared.consent), `${width}: teacher holder and consent are sent explicitly`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: private identity form has no horizontal overflow`);
    await page.screenshot({ path: path.join(work, `${width}-identity-form.png`), fullPage: true });
    await page.evaluate(() => { window.failIdentityUpload = false; });
    await page.getByTestId("identity-submit").click();
    await page.getByTestId("identity-status").waitFor();
    check(await page.evaluate(() => window.identityPreparationCount === 1 && window.identityUploadAttempts === 2), `${width}: upload retry reuses the prepared request`);
    check((await page.getByTestId("identity-status").innerText()).includes("prepare your classes"), `${width}: pending teacher review does not block class preparation`);
    check(await page.getByTestId("identity-legalName").count() === 0, `${width}: submitted legal details are cleared from the rendered form`);
    await page.goto(`${base}?screen=identity&identity=submitted&role=teacher`);
    await page.getByTestId("identity-status").waitFor();
    check((await page.getByTestId("identity-status").innerText()).includes("prepare your classes"), `${width}: pending teachers get clear preparation versus booking guidance`);
    await page.goto(`${base}?screen=identity&identity=approved&role=teacher`);
    await page.getByTestId("identity-status").waitFor();
    check((await page.getByTestId("identity-status").innerText()).includes("teacher account must also be approved"), `${width}: identity approval does not promise teacher account approval`);
    await page.screenshot({ path: path.join(work, `${width}-identity-approved.png`), fullPage: true });
    check(errors.length === 0, `${width}: private identity flows have no browser exceptions`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`${passed} checks passed. Screenshots: ${work}`);
