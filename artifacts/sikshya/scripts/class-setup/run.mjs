import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-simple-class-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({ entry: path.join(here, "entry.tsx"), outfile: bundle, alias: {
  "@/utils/api": path.join(here, "api.js"),
  "expo-router": path.join(here, "router.js"),
  "@react-navigation/native": path.join(here, "router.js"),
  "@/context/AuthContext": path.join(here, "router.js"),
  "expo-crypto": path.join(here, "router.js"),
  "react-native-safe-area-context": path.resolve(here, "../batch-planner/native.js"),
  "@react-native-community/datetimepicker": path.resolve(here, "../batch-planner/native.js"),
  "expo-font": path.resolve(here, "../batch-planner/font.js"),
  "@/hooks/useLeaveGuard": path.resolve(here, "../../hooks/useLeaveGuard.web.ts"),
} });
assert.ok(built.ok, built.error);
const html = '<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}body{font-family:system-ui}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript" : "text/html"); res.end(req.url === "/bundle.js" ? readFileSync(bundle) : html); });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
console.log("CLASS_SETUP_RUNNER", JSON.stringify({ node: process.version, platform: process.platform,
  browser: browser.version(), hostTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  fixtureTimeZone: process.env.CLASS_SETUP_TEST_TIMEZONE ?? "host-default" }));
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log(`PASS ${label}`); };
try {
  for (const [width, height, timezoneId] of [[360, 640, "Asia/Kathmandu"], [390, 844, "America/Chicago"], [1440, 900, "America/Chicago"]]) {
    const page = await browser.newPage({ viewport: { width, height }, timezoneId });
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${server.address().port}/create-class`);
    const button = (name) => page.getByRole("button", { name, exact: true });
    await button("Continue").click();
    check(await page.getByText("Class name needs a little more detail.", { exact: true }).isVisible(), `${width}: meaningful details required`);
    await page.getByLabel("Class name", { exact: true }).fill("SEE Maths evening tuition");
    await page.getByLabel("Tell students about your class", { exact: true }).fill("We solve school exercises together and make time for questions.");
    await button("Both").click();
    await page.getByLabel("How many lessons will students get?", { exact: true }).fill("8");
    await page.getByLabel("Price for these 30 days (NPR)", { exact: true }).fill("3000");
    check(await page.getByText(/approximately NPR 375.00 per lesson/).isVisible(), `${width}: teacher sees session price on the first page`);
    check(await button("Add a lesson outline (optional)").isVisible(), `${width}: lesson outline optional`);
    await page.screenshot({ path: path.join(work, `${width}-description.png`), fullPage: true });
    await button("Continue").click();
    await page.getByRole("button", { name: /^Date:/ }).click();
    await page.getByTestId("bs-next-month").click(); await page.getByTestId("bs-day-3").click(); await page.getByTestId("bs-confirm").click();
    await page.getByTestId("class-time-0").fill("16:15");
    check(await button("Prepare my timetable").isDisabled(), `${width}: recurrence requires an explicit teacher choice`);
    await button("Daily").click();
    await button("Prepare my timetable").click();
    await page.getByText(/lesson dates ready/).waitFor();
    check(await page.getByText(/lesson dates ready/).isVisible(), `${width}: actual calendar and time generate lessons`);
    await page.screenshot({ path: path.join(work, `${width}-schedule.png`), fullPage: true });
    await button("Continue").click();
    await page.getByLabel("Maximum students", { exact: true }).fill("6");
    check(await page.getByText(/approximately NPR .* per lesson/).isVisible(), `${width}: price shows lesson average`);
    check(await page.getByText("Your earnings per student", { exact: true }).isVisible(), `${width}: price step shows teacher earnings estimate`);
    check(await page.getByText("NPR 2,100", { exact: true }).isVisible(), `${width}: estimate names earnings per enrolled student`);
    const priceBreakdown = await page.getByText(/Includes \d+ live lessons/).innerText();
    const lessonCount = Number(priceBreakdown.match(/Includes (\d+) live lessons/)?.[1]);
    const expectedPerLesson = (2100 / lessonCount).toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    check(await page.getByText(`Estimated after Fadko fees · NPR ${expectedPerLesson} per completed lesson`, { exact: true }).isVisible(), `${width}: estimate uses the actual lesson count`);
    check(await page.getByText(/Live tax handling has not been configured/).isVisible(), `${width}: estimate labels preview tax honestly`);
    check(await page.getByTestId("class-earnings-breakdown").count() === 0, `${width}: fee details start collapsed, leaving earnings prominent`);
    await button("View price breakdown").click();
    check((await page.locator("body").innerText()).includes("Minus: Fadko fee") && !(await page.locator("body").innerText()).includes("30% commission"), `${width}: class pricing uses amounts without percentage copy`);
    await page.screenshot({ path: path.join(work, `${width}-price.png`), fullPage: true });
    await button("Review my class").click();
    check(await page.getByText("Choose when students may join this class.", { exact: true }).isVisible(), `${width}: joining decision cannot be skipped`);
    await button("Allow joining for remaining lessons").click();
    await button("Review my class").click();
    check(await page.getByText("NPR 3,000 per student for these 30 days", { exact: true }).isVisible(), `${width}: price has full scope`);
    check(await page.getByText("Your earnings per student", { exact: true }).count() === 1, `${width}: review repeats one clear earnings estimate`);
    await page.screenshot({ path: path.join(work, `${width}-review.png`), fullPage: true });
    check((await page.evaluate(() => window.classRequests)).length === 0, `${width}: review creates no hidden parents`);
    const footer = await button("Save draft").boundingBox();
    check(footer.y >= 0 && footer.y + footer.height <= height, `${width}: save remains visible`);
    await button("My classes").click();
    await page.getByTestId("batch-confirmation").waitFor();
    const modal = await page.getByTestId("batch-confirmation").boundingBox();
    check(modal.y >= 0 && modal.y + modal.height <= height, `${width}: leave confirmation fits viewport`);
    await page.getByTestId("warning-cancel").click();
    await page.evaluate(() => { window.failClassSave = true; });
    await button("Save draft").click();
    await page.getByText("Connection lost. Your entries are still here.", { exact: true }).waitFor();
    check(await button("Save draft").isEnabled(), `${width}: failed save keeps entries and allows retry`);
    await page.evaluate((lostReply) => { window.failClassSave = false; window.failCreateReply = lostReply; }, width === 360);
    await button("Save draft").click();
    if (width === 360) {
      await page.getByText("The connection ended before the draft was confirmed.", { exact: true }).waitFor();
      await button("Save draft").click();
    }
    await button("Publish class").waitFor();
    const writes = await page.evaluate(() => window.classRequests);
    check(writes.length === (width === 360 ? 3 : 2) && writes.every((write) => write.input.requestKey === writes[0].input.requestKey), `${width}: retries share creation key`);
    check(writes[1].url === "/teaching-classes" && writes[1].input.outline === "" && writes[1].input.lessons.every((l) => l.time === "16:15"), `${width}: single endpoint carries description and exact Nepal timetable`);
    check(writes[1].input.allowLateJoining === true, `${width}: explicit late joining choice is saved`);
    check((await page.evaluate(() => window.lastNavigation))?.params?.id === "1", `${width}: saved class receives stable URL`);
    await button("Publish class").click();
    check((await page.evaluate(() => window.classRequests)).length === writes.length, `${width}: opening confirmation is not a publish`);
    await page.screenshot({ path: path.join(work, `${width}-confirm.png`) });
    if (width === 390) await page.evaluate(() => { window.failPublishReply = true; });
    await page.getByTestId("warning-confirm").click();
    await button("Published — up to date").waitFor();
    check(await button("Published — up to date").isDisabled(), `${width}: unchanged republish disabled`);
    if (width === 390) check(await page.getByText("Class published. Your listing is up to date.", { exact: true }).isVisible(), "lost publish reply reconciles committed listing");
    check(await button("Delete unpublished class").count() === 0, `${width}: published class has no delete action`);
    await page.screenshot({ path: path.join(work, `${width}-published.png`) });
    await button("Edit details").click();
    await page.getByLabel("Class name", { exact: true }).fill("SEE Maths tuition revised");
    await button("My classes").click();
    await page.getByTestId("batch-confirmation").waitFor();
    check(await page.getByText("Leave without saving?", { exact: true }).isVisible(), `${width}: leave guard rearms after saved URL navigation`);
    await page.getByTestId("warning-cancel").click();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: no horizontal scroll`);
    check(errors.length === 0, `${width}: no browser exceptions ${errors.join("; ")}`);
    const savedClass = await page.evaluate(() => window.savedClassFixture);
    await page.close();
    const home = await browser.newPage({ viewport: { width, height }, timezoneId });
    // A 03:00 Nepal boundary would be the previous calendar date in Chicago if formatted directly.
    const start = "2026-09-14T21:15:00.000Z", end = "2026-10-14T21:15:00.000Z";
    savedClass.batch.tuitionPeriod = { groupId: 1, index: 0, startsAt: start, endsAt: end };
    const next = structuredClone(savedClass); next.batch.id = 2; next.batch.status = "draft"; next.batch.published = null;
    next.batch.tuitionPeriod = { groupId: 1, index: 1, startsAt: end, endsAt: "2026-11-13T21:15:00.000Z" };
    await home.addInitScript((fixtures) => { window.classHomeFixtures = fixtures; }, [next, savedClass]);
    await home.goto(`http://127.0.0.1:${server.address().port}/teaching-classes`);
    await home.getByText("SEE Maths evening tuition", { exact: true }).waitFor();
    check(await home.getByText("SEE Maths evening tuition", { exact: true }).count() === 1, `${width}: one class name for current and next dates`);
    check(await home.getByRole("button", { name: /^Class details for/ }).count() === 0, `${width}: older date sets stay compact until requested`);
    const compactCard = await home.getByTestId("teaching-class-2").boundingBox();
    if (width >= 1000) check(compactCard.height < 245, `${width}: a collapsed class is a compact laptop row, not a stretched phone card (${compactCard.height}px)`);
    check(await home.getByRole("button", { name: /^Continue setup for/ }).evaluate((node) => node.getBoundingClientRect().height >= 44), `${width}: compact class keeps a touch-sized action`);
    await home.getByRole("button", { name: "More date sets (1)", exact: true }).click();
    check(await home.getByRole("button", { name: /^Continue setup for/ }).count() === 1 && await home.getByRole("button", { name: /^Class details for/ }).count() === 1, `${width}: both date sets remain accessible`);
    check(await home.getByText(/Sep 15, 2026.*03:00 Nepal time until/).count() > 0, `${width}: class list pins early-morning boundaries to Nepal, not viewer timezone`);
    check(await home.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: grouped class list fits`);
    await home.screenshot({ path: path.join(work, `${width}-classes.png`) });
    await home.getByLabel("Search all your classes", { exact: true }).fill("No such class");
    await home.getByText("No matching classes", { exact: true }).waitFor();
    check(await home.getByText("SEE Maths evening tuition", { exact: true }).count() === 0, `${width}: search removes nonmatching classes`);
    await home.getByLabel("Search all your classes", { exact: true }).fill("");
    await home.getByText("SEE Maths evening tuition", { exact: true }).waitFor();
    await home.getByRole("button", { name: "Published", exact: true }).click();
    await home.getByRole("button", { name: /^Class details for/ }).waitFor();
    check(await home.getByRole("button", { name: /^Continue setup for/ }).count() === 0, `${width}: status filter removes drafts`);
    await home.close();
  }
  const single = await browser.newPage({ viewport: { width: 360, height: 640 } });
  await single.goto(`http://127.0.0.1:${server.address().port}/create-class`);
  const singleButton = (name) => single.getByRole("button", { name, exact: true });
  await single.getByLabel("Class name", { exact: true }).fill("SEE Maths evening tuition");
  await single.getByLabel("Tell students about your class", { exact: true }).fill("We solve school exercises together and make time for questions.");
  await singleButton("Other").click();
  await single.getByLabel("Other teaching language", { exact: true }).fill("Korean");
  await singleButton("Nepali").click();
  await single.getByLabel("How many lessons will students get?", { exact: true }).fill("1");
  await single.getByLabel("Price for these 30 days (NPR)", { exact: true }).fill("5000");
  await singleButton("Continue").click();
  await single.getByRole("button", { name: /^Date:/ }).click();
  await single.getByTestId("bs-next-month").click(); await single.getByTestId("bs-day-3").click(); await single.getByTestId("bs-confirm").click();
  await single.getByTestId("class-time-0").fill("16:15");
  await singleButton("Continue").click();
  await single.getByLabel("Maximum students", { exact: true }).fill("6");
  await singleButton("Close joining when the class starts").click();
  await singleButton("Review my class").click();
  check(await single.getByText("Only 1 lesson in these 30 days", { exact: true }).count() === 1, "single lesson warning rendered in review");
  await singleButton("Save draft").click(); await singleButton("Publish class").click();
  await single.getByTestId("batch-confirmation").waitFor();
  check(await single.getByText(/Only 1 lesson is scheduled/).isVisible(), "single lesson warning visible inside confirmation");
  check(await single.getByText(/1 lesson for NPR 5,000 per student/).isVisible(), "confirmation names exact count and amount");
  const singleModal = await single.getByTestId("batch-confirmation").boundingBox();
  check(singleModal.y >= 0 && singleModal.y + singleModal.height <= 640, "single lesson confirmation fits small phone");
  await single.screenshot({ path: path.join(work, "360-single-lesson-confirm.png") });
  await single.getByTestId("warning-cancel").click();
  const singleFixture = await single.evaluate(() => window.savedClassFixture);
  await single.evaluate((at) => { window.conflictFixtures = [
    { lessonIndex: 0, otherLessonIndex: null, startsAt: at, durationMinutes: 60, otherStartsAt: at, otherDurationMinutes: 60, otherTitle: "Paid Mathematics", source: { kind: "session", id: 99, title: "Paid Mathematics", locked: "paid" } },
    { lessonIndex: 0, otherLessonIndex: null, startsAt: at, durationMinutes: 60, otherStartsAt: at, otherDurationMinutes: 60, otherTitle: "Other tuition", source: { kind: "class", id: 88, title: "Other tuition", locked: null } },
  ]; }, singleFixture.batch.lessons[0].startsAt);
  await singleButton("Edit details").click();
  await single.getByLabel("Class name", { exact: true }).fill("Maths conflict review class");
  await singleButton("Continue").click(); await singleButton("Continue").click();
  const edits = single.getByRole("button", { name: "Edit lesson 1 time", exact: true });
  await edits.first().scrollIntoViewIfNeeded();
  check(await single.getByText("Students have paid for the other class. Change this lesson.", { exact: true }).count() === 1, "paid conflict explains why this lesson must move");
  check(await single.getByRole("button", { name: "Keep this time · edit other schedule", exact: true }).count() === 1, "only safe other class gets edit shortcut");
  await single.screenshot({ path: path.join(work, "360-conflict-review.png") });
  await edits.first().click();
  check(await single.getByText("Overlapping time · lesson 1", { exact: true }).isVisible(), "edit conflict jumps to highlighted lesson editor");
  check(await single.getByTestId("class-time-0").count() === 1, "exact affected time is editable");
  await singleButton("Back to overlapping lessons").click();
  await single.getByRole("button", { name: "Keep this time · edit other schedule", exact: true }).click();
  await single.getByTestId("warning-cancel").click();
  check(await single.getByTestId("class-time-0").isVisible(), "leaving for another schedule protects unsaved changes");
  await single.getByTestId("class-time-0").fill("19:15");
  await singleButton("Check timetable availability").click();
  check(await single.getByText("No overlapping lessons found", { exact: true }).isVisible(), "changed dates can be rechecked without saving or visiting publish");
  await singleButton("Continue").click();
  check(await single.getByLabel("Maximum students", { exact: true }).isVisible(), "only a clear timetable advances to pricing");
  await singleButton("Review my class").click();
  await singleButton("Delete unpublished class").click();
  check(await single.getByText("Delete this unpublished class?", { exact: true }).isVisible(), "draft deletion requires a clear confirmation");
  await single.getByTestId("warning-confirm").click();
  await single.waitForFunction(() => window.lastNavigation === "/(teacher)/teaching-classes");
  check((await single.evaluate(() => window.classRequests)).some((request) => request.method === "DELETE"), "confirmed draft deletion calls the delete endpoint");
  await single.close();

  const discarded = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await discarded.goto(`http://127.0.0.1:${server.address().port}/create-class`);
  await discarded.getByLabel("Class name", { exact: true }).fill("An unfinished class");
  await discarded.getByRole("button", { name: "My classes", exact: true }).click();
  await discarded.getByTestId("warning-confirm").click();
  await discarded.waitForFunction(() => window.lastNavigation === "/(teacher)/teaching-classes");
  check(await discarded.getByLabel("Class name", { exact: true }).inputValue() === "", "leave without saving clears an uncommitted new class");
  check((await discarded.evaluate(() => window.classRequests)).length === 0, "discarding a new class sends no write");
  await discarded.close();

  const unavailable = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await unavailable.goto(`http://127.0.0.1:${server.address().port}/create-class?billing=fail`);
  const unavailableButton = (name) => unavailable.getByRole("button", { name, exact: true });
  await unavailable.getByLabel("Class name", { exact: true }).fill("SEE Maths evening tuition");
  await unavailable.getByLabel("Tell students about your class", { exact: true }).fill("We solve school exercises together and make time for questions.");
  await unavailableButton("Both").click();
  await unavailable.getByLabel("How many lessons will students get?", { exact: true }).fill("1");
  await unavailable.getByLabel("Price for these 30 days (NPR)", { exact: true }).fill("3000");
  await unavailableButton("Continue").click();
  await unavailable.getByRole("button", { name: /^Date:/ }).click();
  await unavailable.getByTestId("bs-next-month").click(); await unavailable.getByTestId("bs-day-3").click(); await unavailable.getByTestId("bs-confirm").click();
  await unavailable.getByTestId("class-time-0").fill("16:15");
  await unavailableButton("Continue").click();
  await unavailable.getByText("Teaching terms unavailable", { exact: true }).waitFor();
  check(await unavailableButton("Reload teaching terms").isVisible(), "failed billing load offers a retry on the price step");
  await unavailable.getByLabel("Maximum students", { exact: true }).fill("6");
  await unavailableButton("Allow joining for remaining lessons").click();
  await unavailableButton("Review my class").click();
  check(await unavailable.getByText("Current teaching terms could not be confirmed. Reload them before reviewing your price.", { exact: true }).isVisible(), "unconfirmed commission blocks price review");
  check((await unavailable.evaluate(() => window.classRequests)).length === 0, "unconfirmed commission cannot create a listing");
  await unavailable.evaluate(() => { window.billingRecovered = true; });
  await unavailableButton("Reload teaching terms").click();
  await unavailable.getByText("Your earnings per student", { exact: true }).waitFor();
  await unavailableButton("Review my class").click();
  check(await unavailableButton("Save draft").isVisible(), "successful billing retry restores the normal review path");
  await unavailable.close();

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const countPage = await browser.newPage({ viewport: { width, height }, hasTouch: width < 600,
      ...(process.env.CLASS_SETUP_TEST_TIMEZONE ? { timezoneId: process.env.CLASS_SETUP_TEST_TIMEZONE } : {}) });
    await countPage.goto(`http://127.0.0.1:${server.address().port}/create-class`);
    await countPage.evaluate(() => {
      window.classSetupTapDiagnostics = [];
      window.classSetupEventDiagnostics = [];
      for (const type of ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchend", "touchcancel", "click"]) {
        document.addEventListener(type, event => {
          const target = event.target?.closest?.('[role="button"]') ?? event.target;
          const touch = event.touches?.[0] ?? event.changedTouches?.[0];
          const sample = { type, at: performance.now(), pointerType: event.pointerType,
            x: touch?.clientX ?? event.clientX, y: touch?.clientY ?? event.clientY,
            label: target?.getAttribute?.("aria-label") ?? target?.textContent?.slice(0, 180),
            defaultPrevented: event.defaultPrevented, trusted: event.isTrusted };
          window.classSetupEventDiagnostics.push(sample);
          window.classSetupEventDiagnostics = window.classSetupEventDiagnostics.slice(-80);
          setTimeout(() => { sample.defaultPrevented = event.defaultPrevented; }, 0);
        }, { capture: true, passive: true });
      }
    });
    const countButton = (name) => countPage.getByRole("button", { name, exact: true });
    const captureTouchState = () => countPage.evaluate(() => ({
      width: window.innerWidth, height: window.innerHeight, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      activeElement: { tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute("aria-label") },
      frequency: [...document.querySelectorAll('[role="button"]')]
        .filter(node => /Daily|Weekly|Twice weekly|Every two weeks|Alternate days|Choose weekdays|Pick my own dates|Create editable/.test(node.getAttribute("aria-label") ?? ""))
        .map(node => ({ label: node.getAttribute("aria-label"), disabled: node.getAttribute("aria-disabled"), box: node.getBoundingClientRect().toJSON() })),
      confirmation: document.querySelector('[data-testid="batch-confirmation"]')?.textContent ?? null,
      body: document.body.innerText.slice(0, 16000),
    }));
    const dumpTouchFailure = async (stage, error) => {
      console.error("CLASS_SETUP_TOUCH_FAILURE", JSON.stringify({ stage, error: String(error), state: await captureTouchState() }));
      const diagnostics = await countPage.evaluate(() => ({ actions: window.classSetupTapDiagnostics, events: window.classSetupEventDiagnostics }));
      for (const action of diagnostics.actions) console.error("CLASS_SETUP_TOUCH_ACTION", JSON.stringify(action));
      console.error("CLASS_SETUP_TOUCH_EVENTS", JSON.stringify(diagnostics.events));
      await countPage.screenshot({ path: path.join(work, `${width}-manual-timetable-failure.png`), fullPage: true });
    };
    const tap = async (locator, minimumSize = 44) => {
      try {
        await locator.scrollIntoViewIfNeeded();
        // Wait for the real target's enabled/stable/hit-tested actionability before
        // sampling touch coordinates. Trial performs no click or application action.
        await locator.click({ trial: true });
        const before = await captureTouchState();
        // Modal dismissal can restore focus/scroll after Playwright's trial. Read
        // final geometry across animation frames, then tap without another awaited
        // diagnostic read between sampling the target and the trusted input.
        const box = await locator.evaluate(async node => {
          const started = performance.now();
          let previous = null; let stableFrames = 0;
          while (performance.now() - started < 30000) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            if (!node.isConnected) throw new Error("tap target detached while settling");
            const rect = node.getBoundingClientRect();
            const current = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            const stable = previous && Object.keys(current).every(key => Math.abs(current[key] - previous[key]) < 0.1);
            stableFrames = stable ? stableFrames + 1 : 0;
            previous = current;
            const x = current.x + current.width / 2; const y = current.y + current.height / 2;
            if (stableFrames >= 3 && node.contains(document.elementFromPoint(x, y))) return current;
          }
          throw new Error("tap target geometry did not settle within the existing 30-second action timeout");
        });
        assert.ok(box && box.width >= minimumSize && box.height >= minimumSize, "real target has the expected tap dimensions");
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        assert.ok(point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height, "real target fits the viewport");
        const action = { target: locator.toString(), geometry: { box, point }, before };
        if (width < 600) await countPage.touchscreen.tap(point.x, point.y);
        else await countPage.mouse.click(point.x, point.y);
        await countPage.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        action.after = await captureTouchState();
        await countPage.evaluate(sample => {
          window.classSetupTapDiagnostics.push(sample);
          window.classSetupTapDiagnostics = window.classSetupTapDiagnostics.slice(-12);
        }, action);
      } catch (error) {
        await dumpTouchFailure(`tap ${locator.toString()}`, error);
        throw error;
      }
    };
    await countPage.getByLabel("Class name", { exact: true }).fill("Timetable count regression");
    await countPage.getByLabel("Tell students about your class", { exact: true }).fill("A course to practise and revise school exercises together.");
    await tap(countButton("Both"));
    const countInput = countPage.getByLabel("How many lessons will students get?", { exact: true });
    await countInput.fill("999999999");
    check(await countInput.inputValue() === "60" && await countInput.getAttribute("maxlength") === "2", `${width}: huge pasted lesson counts are bounded immediately`);
    await countInput.fill("50");
    await countPage.getByLabel("Price for these 30 days (NPR)", { exact: true }).fill("7000");
    await tap(countButton("Continue"));
    await tap(countPage.getByRole("button", { name: /^Date:/ }));
    await tap(countPage.getByTestId("bs-next-month"), 1);
    // Calendar days are deliberately compact; other controls retain the 44px minimum.
    await countPage.getByTestId("bs-day-3").click();
    await tap(countPage.getByTestId("bs-confirm"));
    // RNW's fade-out still owns focus/scroll until the picker is removed. Do not
    // tap the timetable behind it while its eventual dismissal can move that UI.
    await countPage.getByTestId("nepali-date-picker").waitFor({ state: "detached" });
    assert.equal(await countPage.getByTestId("nepali-date-picker").count(), 0, "date picker fully closes before trusted timetable taps");
    await countPage.getByTestId("class-time-0").fill("16:15");
    await tap(countButton("Daily"));
    check(await countButton("Prepare my timetable").isDisabled() && await countPage.getByText(/Only 30 daily lessons fit.*one lesson per day/).count() === 1, `${width}: fifty daily lessons explain the thirty-day boundary immediately`);
    await tap(countButton("Pick my own dates"));
    await tap(countButton("Create editable lesson dates"));
    try {
      await countPage.getByText(/50 lesson rows ready/).waitFor();
    } catch (error) {
      await dumpTouchFailure("waiting for fifty manual lesson rows", error);
      throw error;
    }
    check(await countPage.getByRole("button", { name: /^Edit lesson \d+ date and time$/ }).count() === 50, `${width}: fifty manual rows are available`);
    await countPage.getByTestId("class-time-0").fill("16:45");
    await tap(countButton("Continue"));
    await countPage.getByText("Lesson 36: choose a valid date and start time.", { exact: true }).waitFor();
    check(await countPage.getByText("Lesson 36: choose a valid date and start time.", { exact: true }).count() === 1, `${width}: incomplete fifty-row timetable reports actual missing dates`);
    await tap(countButton("Previous"));
    await countInput.fill("15");
    check(await countPage.getByText("Lesson 36: choose a valid date and start time.", { exact: true }).count() === 0, `${width}: changed count clears obsolete fifty-row errors`);
    await tap(countButton("Continue"));
    await countPage.getByText(/15 lessons now/).waitFor();
    check(await countPage.getByRole("button", { name: /^Edit lesson \d+ date and time$/ }).count() === 15, `${width}: reducing fifty to fifteen removes unused rows before the timetable opens`);
    check(await countPage.getByTestId("class-time-0").inputValue() === "16:45", `${width}: retained first lesson edits survive count reduction`);
    check(await countPage.getByTestId("batch-confirmation").count() === 0, `${width}: removing untouched empty rows needs no confusing regeneration dialog`);
    await tap(countButton("Previous"));
    await countInput.fill("50");
    await tap(countButton("Continue"));
    await tap(countPage.getByRole("button", { name: "Edit lesson 50 date and time", exact: true }));
    await countPage.getByTestId("class-time-49").fill("19:30");
    await tap(countButton("Previous"));
    await countInput.fill("15");
    await tap(countButton("Continue"));
    await countPage.getByText("Use 15 lessons instead?", { exact: true }).waitFor();
    check(await countPage.getByText("Use 15 lessons instead?", { exact: true }).isVisible(), `${width}: removing an individually edited tail row asks for consent`);
    await tap(countPage.getByTestId("warning-cancel"));
    await countInput.fill("50");
    await tap(countButton("Continue"));
    await tap(countPage.getByRole("button", { name: "Edit lesson 50 date and time", exact: true }));
    check(await countPage.getByTestId("class-time-49").inputValue() === "19:30", `${width}: cancelling removal preserves the edited tail row`);
    await tap(countButton("Previous"));
    await countInput.fill("15");
    await tap(countButton("Continue"));
    await tap(countPage.getByTestId("warning-confirm"));
    check(await countPage.getByRole("button", { name: /^Edit lesson \d+ date and time$/ }).count() === 15, `${width}: explicit removal leaves exactly fifteen rows`);
    await tap(countButton("Discard setup"));
    check(await countPage.getByText("Discard this setup?", { exact: true }).isVisible(), `${width}: an unsaved setup can be discarded from the timetable footer`);
    await tap(countPage.getByTestId("warning-confirm"));
    await countPage.waitForFunction(() => window.lastNavigation === "/(teacher)/teaching-classes");
    check((await countPage.evaluate(() => window.classRequests)).length === 0, `${width}: unsaved discard makes no backend deletion or creation`);
    check(await countPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: new setup controls keep the viewport width`);
    await countPage.close();

    const course = await browser.newPage({ viewport: { width, height } });
    await course.goto(`http://127.0.0.1:${server.address().port}/create-class`);
    const courseButton = (name) => course.getByRole("button", { name, exact: true });
    await courseButton("Short course · a set finish").click();
    await course.getByLabel("Class name", { exact: true }).fill("A fifty-lesson short course");
    await course.getByLabel("Tell students about your class", { exact: true }).fill("A planned course with a clear beginning and finish.");
    await courseButton("English").click();
    await course.getByLabel("How many lessons will students get?", { exact: true }).fill("50");
    await course.getByLabel("Price for the whole course (NPR)", { exact: true }).fill("7000");
    await courseButton("Continue").click();
    await course.getByRole("button", { name: /^Date:/ }).click();
    await course.getByTestId("bs-next-month").click(); await course.getByTestId("bs-day-3").click(); await course.getByTestId("bs-confirm").click();
    await course.getByTestId("class-time-0").fill("16:15");
    await courseButton("Daily").click();
    check(await courseButton("Prepare my timetable").isEnabled(), `${width}: short courses may schedule fifty daily lessons beyond one monthly period`);
    await courseButton("Prepare my timetable").click();
    await course.getByTestId("class-course-dates").getByText(/^Begins:/).waitFor();
    check(await course.getByTestId("class-course-dates").getByText(/^Begins:/).count() === 1 && await course.getByTestId("class-course-dates").getByText(/^Finishes:/).count() === 1, `${width}: short course shows exact beginning and finish from the timetable`);
    await courseButton("Continue").click();
    await course.getByLabel("Maximum students", { exact: true }).fill("6");
    await courseButton("Close joining when the class starts").click();
    await courseButton("Review my class").click();
    check(await course.getByTestId("class-course-review").getByText(/^Finishes:/).count() === 1, `${width}: publication review repeats the actual short-course finish`);
    await course.screenshot({ path: path.join(work, `${width}-course-boundaries.png`), fullPage: true });
    await courseButton("Save draft").click();
    await courseButton("Edit details").click();
    check(await courseButton("Delete unpublished class").isVisible(), `${width}: saved draft can be deleted without returning to the final step`);
    await courseButton("Delete unpublished class").click(); await course.getByTestId("warning-confirm").click();
    await course.waitForFunction(() => window.lastNavigation === "/(teacher)/teaching-classes");
    check((await course.evaluate(() => window.classRequests)).some((request) => request.method === "DELETE"), `${width}: wizard draft removal uses the protected backend endpoint`);
    await course.close();
  }
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
console.log(`${checks} checks passed. Screenshots: ${work}`);
