import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-support-case-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({ entry: path.join(here, "entry.tsx"), outfile: bundle, alias: {
  "@/utils/api": path.join(here, "api.js"),
  "expo-router": path.join(here, "router.js"),
  "@react-navigation/native": path.resolve(here, "../profile-ui/navigation.js"),
  "react-native-safe-area-context": path.resolve(here, "../profile-ui/context.js"),
  "@/utils/openAttachment": path.resolve(here, "../profile-ui/attachment.js"),
  "expo-font": path.resolve(here, "../batch-planner/font.js"),
} });
assert.ok(built.ok, built.error);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? readFileSync(bundle) : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (condition, message) => { assert.ok(condition, message); console.log(`PASS ${message}`); passed++; };
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base);
    await page.getByTestId("admin-case-gaps").waitFor();
    check(await page.getByText("REPORTER'S ACCOUNT · NOT A VERIFIED FINDING", { exact: true }).isVisible(), `${width}: report is distinct from evidence`);
    check(await page.getByText("Audio quality was not measured.", { exact: false }).isVisible(), `${width}: missing evidence is surfaced before deciding`);
    check(await page.getByTestId("admin-resolution").count() === 0, `${width}: decision form does not crowd overview`);
    await page.getByTestId("admin-case-records").click();
    check(await page.getByTestId("admin-session-case-summary").isVisible(), `${width}: class records are reachable`);
    check((await page.locator("body").innerText()).includes("This alone does not prove that nobody attended"), `${width}: empty attendance is not a verdict`);
    check(!(await page.locator("body").innerText()).includes("I could not hear my teacher."), `${width}: report does not repeat in evidence`);
    await page.getByTestId("admin-case-timeline").click();
    check(await page.getByTestId("admin-session-timeline").isVisible(), `${width}: timeline has its own section`);
    check(await page.getByText("Investigating connection.", { exact: true }).isVisible(), `${width}: ticket history remains available`);
    await page.getByTestId("admin-case-decision").click();
    await page.getByTestId("admin-resolution").fill("Please provide the time the sound stopped.");
    await page.getByTestId("admin-case-records").click();
    await page.getByTestId("admin-case-decision").click();
    check(await page.getByTestId("admin-resolution").inputValue() === "Please provide the time the sound stopped.", `${width}: draft survives section changes`);
    for (const id of ["admin-note", "admin-move-processing", "admin-move-resolved", "admin-move-denied"]) {
      const button = page.getByTestId(id);
      await button.scrollIntoViewIfNeeded();
      check(await button.evaluate(node => { const r = node.getBoundingClientRect(); return r.height >= 44 && r.left >= 0 && r.right <= innerWidth + 1; }), `${width}: ${id} fits and is tappable`);
    }
    await page.screenshot({ path: path.join(work, `${width}-decision.png`), fullPage: true });
    await page.goto(`${base}?mode=unknown`);
    check(await page.getByText("Attendance could not be read. Do not interpret this as an absence.", { exact: true }).isVisible(), `${width}: failed attendance has a specific explanation`);
    await page.goto(`${base}?mode=unlinked`);
    await page.getByTestId("admin-case-records").click();
    check(await page.getByText("No lesson is linked to this request. No class records are available here.", { exact: true }).isVisible(), `${width}: unlinked ticket has an honest empty state`);
    await page.goto(`${base}?mode=retry`);
    await page.getByTestId("admin-ticket-retry").click();
    await page.getByTestId("admin-case-gaps").waitFor();
    check(await page.getByTestId("admin-case-overview").isVisible(), `${width}: failed load recovers with retry`);
    check(errors.length === 0, `${width}: no runtime errors: ${errors.join(", ")}`);
    await page.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
console.log(`${passed} checks passed. Screenshots: ${work}`);
