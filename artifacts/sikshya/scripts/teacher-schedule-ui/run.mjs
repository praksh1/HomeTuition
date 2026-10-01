import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-teacher-schedule-ui-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({ entry: path.join(here, "entry.tsx"), outfile: bundle, alias: {
  "@/context/AuthContext": path.join(here, "auth.js"),
  "@/context/DatePreferenceContext": path.resolve(here, "../sessions-ui/context.js"),
  "@/utils/api": path.join(here, "api.js"),
  "@react-navigation/native": path.join(here, "navigation.js"),
  "expo-router": path.resolve(here, "../sessions-ui/router.js"),
  "expo-font": path.resolve(here, "../batch-planner/font.js"),
  "react-native-safe-area-context": path.resolve(here, "../sessions-ui/context.js"),
} });
assert.ok(built.ok, built.error);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "application/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? readFileSync(bundle)
    : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (value, message) => { assert.ok(value, message); passed++; console.log(`PASS ${message}`); };
const click = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  // FlatList may replace its off-screen spacers after scrolling; wait for that layout
  // before measuring the actual finger target, not a stale footer coordinate.
  await locator.page().waitForTimeout(120);
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert.ok(box && box.height >= 44 && box.width >= 44, "Action has a visible 44px target");
  assert.ok(box.y >= 0 && box.y + box.height <= locator.page().viewportSize().height, "Action is within the viewport");
  await locator.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
const expectCount = (page, text) => page.getByTestId("teacher-schedule-count").filter({ hasText: text }).waitFor();

try {
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [], escaped = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.route("**/*", async (route) => {
      if (new URL(route.request().url()).hostname !== "127.0.0.1") {
        escaped.push(route.request().url()); await route.abort();
      } else await route.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expectCount(page, "100 of 251 lessons");
    check((await page.evaluate(() => window.__scheduleFixture.requests)).length === 1, `${width}: initial schedule fetches only one page`);
    check((await page.locator('[data-testid^="teacher-session-"]').first().getAttribute("data-testid")) === "teacher-session-1", `${width}: Upcoming starts with the nearest lesson`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal overflow`);
    for (const mode of ["upcoming", "live", "history"]) {
      const box = await page.getByTestId(`teacher-group-${mode}`).boundingBox();
      check(box?.height >= 44, `${width}: ${mode} filter meets touch floor`);
    }
    await page.screenshot({ path: path.join(work, `${width}-upcoming.png`), fullPage: false });
    await click(page.getByTestId("teacher-load-more-lessons"));
    await expectCount(page, "200 of 251 lessons");
    check((await page.evaluate(() => window.__scheduleFixture.requests)).length === 2, `${width}: Load more reads only the requested next page`);
    await page.evaluate(() => window.__scheduleFixture.fail = "81:upcoming:3");
    await click(page.getByTestId("teacher-load-more-lessons"));
    await page.getByTestId("teacher-schedule-page-error").waitFor().catch(async (error) => {
      console.log(await page.evaluate(() => ({ requests: window.__scheduleFixture.requests, body: document.body.innerText.slice(-700) })));
      await page.screenshot({ path: path.join(work, `${width}-failed.png`) });
      throw error;
    });
    check((await page.getByTestId("teacher-schedule-count").innerText()) === "200 of 251 lessons", `${width}: failed later page preserves loaded lessons and count`);
    check((await page.getByTestId("teacher-schedule-page-error").innerText()).includes("still here"), `${width}: later-page error does not pretend schedule is empty`);
    await click(page.getByTestId("teacher-load-more-lessons"));
    await expectCount(page, "251 of 251 lessons");
    check(await page.getByTestId("teacher-load-more-lessons").count() === 0, `${width}: retry completes pagination and removes Load more`);
    await page.evaluate(() => { window.__scheduleFixture.requests = []; window.__scheduleTick(); });
    await page.waitForFunction(() => window.__scheduleFixture.requests.length === 3);
    await expectCount(page, "251 of 251 lessons");
    check((await page.evaluate(() => window.__scheduleFixture.requests)).join(",") === "81:upcoming:1,81:upcoming:2,81:upcoming:3", `${width}: refresh retains all requested pages without fetching unseen dates`);
    await page.evaluate(() => { window.__scheduleFixture.fail = "81:upcoming:2"; window.__scheduleTick(); });
    await page.getByTestId("teacher-schedule-page-error").waitFor();
    check((await page.getByTestId("teacher-schedule-count").innerText()) === "251 of 251 lessons", `${width}: failed refresh preserves previous complete loaded depth`);
    await click(page.getByTestId("teacher-load-more-lessons"));
    await page.getByTestId("teacher-schedule-page-error").waitFor({ state: "hidden" });

    await click(page.getByTestId("teacher-group-live"));
    await expectCount(page, "100 of 131 lessons");
    await click(page.getByTestId("teacher-load-more-lessons"));
    await expectCount(page, "131 of 131 lessons");
    check(await page.getByTestId("teacher-load-more-lessons").count() === 0, `${width}: Live UI also honors paginated response contract`);
    await click(page.getByTestId("teacher-group-history"));
    await expectCount(page, "100 of 455 lessons");
    check((await page.locator('[data-testid^="teacher-session-"]').first().getAttribute("data-testid")) === "teacher-session-1001", `${width}: History begins newest first without exposing older stream gaps`);
    await click(page.getByTestId("teacher-load-more-lessons"));
    await expectCount(page, "200 of 455 lessons");
    await click(page.getByTestId("teacher-load-more-lessons"));
    await expectCount(page, "455 of 455 lessons");
    check(await page.getByTestId("teacher-load-more-lessons").count() === 0, `${width}: completed, cancelled and missed status pages exhaust together`);
    await page.screenshot({ path: path.join(work, `${width}-history.png`), fullPage: false });

    await click(page.getByTestId("teacher-group-upcoming"));
    await expectCount(page, "100 of 251 lessons");
    await page.evaluate(() => window.__scheduleFixture.hold = "81:upcoming:2");
    await click(page.getByTestId("teacher-load-more-lessons"));
    await page.waitForFunction(() => window.__scheduleFixture.pending.length === 1);
    await click(page.getByTestId("teacher-group-live"));
    await expectCount(page, "100 of 131 lessons");
    await page.evaluate(() => window.__scheduleFixture.release());
    await page.waitForTimeout(100);
    check((await page.getByTestId("teacher-schedule-count").innerText()) === "100 of 131 lessons", `${width}: late Upcoming page never replaces selected Live`);

    await page.evaluate(() => { window.__scheduleFixture.requests = []; window.__scheduleFixture.hold = "81:live:1"; window.__scheduleTick(); window.__scheduleTick(); window.__scheduleTick(); });
    await page.waitForFunction(() => window.__scheduleFixture.pending.length === 1);
    check((await page.evaluate(() => window.__scheduleFixture.requests)).length === 1, `${width}: repeated polling coalesces into one read`);
    await page.evaluate(() => { window.__scheduleFocused = false; window.dispatchEvent(new Event("schedule-focus")); });
    await page.waitForTimeout(30);
    await page.evaluate(() => { window.__scheduleTick(); window.__scheduleFixture.release(); });
    await page.waitForTimeout(100);
    check((await page.evaluate(() => window.__scheduleFixture.requests)).length === 1, `${width}: hidden Schedule does not poll`);
    await page.evaluate(() => { window.__scheduleFixture.hold = "81:live:1"; window.__scheduleFocused = true; window.dispatchEvent(new Event("schedule-focus")); });
    await page.waitForFunction(() => window.__scheduleFixture.pending.length === 1);
    await page.evaluate(() => { window.__scheduleTeacherId = 82; window.dispatchEvent(new Event("schedule-account")); });
    await expectCount(page, "100 of 131 lessons");
    await page.getByText("Other teacher lesson 501", { exact: true }).waitFor();
    await page.evaluate(() => window.__scheduleFixture.release());
    await page.waitForTimeout(100);
    check(await page.getByText("Teacher lesson 501", { exact: true }).count() === 0, `${width}: prior-account response cannot repaint the new teacher's schedule`);

    await page.evaluate(() => { window.__scheduleFixture.requests = []; window.__scheduleFixture.hold = "82:live:1"; window.__scheduleTick(); });
    await page.waitForFunction(() => window.__scheduleFixture.pending.length === 1);
    await click(page.getByTestId("teacher-load-more-lessons"));
    check((await page.getByTestId("teacher-load-more-lessons").innerText()).includes("Loading lessons"), `${width}: next-page tap during slow refresh has immediate busy feedback`);
    await click(page.getByTestId("teacher-load-more-lessons"));
    await click(page.getByTestId("teacher-load-more-lessons"));
    await page.evaluate(() => window.__scheduleFixture.release());
    await expectCount(page, "131 of 131 lessons");
    check((await page.evaluate(() => window.__scheduleFixture.requests)).join(",") === "82:live:1,82:live:2", `${width}: repeated next-page taps queue only one intent behind refreshed offsets`);

    await click(page.getByTestId("teacher-group-upcoming"));
    await expectCount(page, "100 of 251 lessons");
    await page.evaluate(() => { window.__scheduleFixture.requests = []; window.__scheduleFixture.fail = "82:upcoming:1"; window.__scheduleFixture.hold = "82:upcoming:1"; window.__scheduleTick(); });
    await page.waitForFunction(() => window.__scheduleFixture.pending.length === 1);
    await click(page.getByTestId("teacher-load-more-lessons"));
    await page.evaluate(() => window.__scheduleFixture.release());
    await page.getByTestId("teacher-schedule-page-error").waitFor();
    check((await page.evaluate(() => window.__scheduleFixture.requests)).join(",") === "82:upcoming:1", `${width}: failed refresh does not request a queued next offset`);
    check((await page.getByTestId("teacher-schedule-count").innerText()) === "100 of 251 lessons", `${width}: failed queued refresh preserves existing rows`);
    await click(page.getByTestId("teacher-load-more-lessons"));
    await page.getByTestId("teacher-schedule-page-error").waitFor({ state: "hidden" });

    await click(page.getByTestId("teacher-load-more-lessons"));
    await expectCount(page, "200 of 251 lessons");
    await page.evaluate(() => { window.__scheduleFixture.requests = []; window.__scheduleFixture.hold = "82:upcoming:2"; window.__scheduleFixture.changed = "82:upcoming:2"; window.__scheduleTick(); });
    await page.waitForFunction(() => window.__scheduleFixture.pending.length === 1);
    await click(page.getByTestId("teacher-load-more-lessons"));
    await page.evaluate(() => window.__scheduleFixture.release());
    await page.getByTestId("teacher-schedule-page-error").waitFor();
    check(!(await page.evaluate(() => window.__scheduleFixture.requests)).includes("82:upcoming:3"), `${width}: changed refresh cancels a queued next offset`);
    check((await page.getByTestId("teacher-schedule-count").innerText()) === "200 of 251 lessons", `${width}: changed queued refresh preserves prior rows and totals`);
    await click(page.getByTestId("teacher-load-more-lessons"));
    await page.getByTestId("teacher-schedule-page-error").waitFor({ state: "hidden" });

    await page.evaluate(() => { window.__scheduleFixture.requests = []; window.__scheduleFixture.hold = "82:upcoming:1"; window.__scheduleTick(); });
    await page.waitForFunction(() => window.__scheduleFixture.pending.length === 1);
    await click(page.getByTestId("teacher-load-more-lessons"));
    await click(page.getByTestId("teacher-group-live"));
    await expectCount(page, "100 of 131 lessons");
    await page.evaluate(() => window.__scheduleFixture.release());
    await page.waitForTimeout(100);
    check(!(await page.evaluate(() => window.__scheduleFixture.requests)).includes("82:upcoming:2"), `${width}: filter change discards an old queued next-page intent`);

    await page.evaluate(() => { window.__scheduleFixture.requests = []; window.__scheduleFixture.hold = "82:live:1"; window.__scheduleTick(); });
    await page.waitForFunction(() => window.__scheduleFixture.pending.length === 1);
    await click(page.getByTestId("teacher-load-more-lessons"));
    await page.evaluate(() => { window.__scheduleFocused = false; window.dispatchEvent(new Event("schedule-focus")); });
    await page.waitForTimeout(30);
    await page.evaluate(() => window.__scheduleFixture.release());
    await page.waitForTimeout(100);
    check(!(await page.evaluate(() => window.__scheduleFixture.requests)).includes("82:live:2"), `${width}: losing focus discards a queued next-page intent`);
    await page.evaluate(() => { window.__scheduleFocused = true; window.dispatchEvent(new Event("schedule-focus")); });
    await page.waitForTimeout(100);

    await page.evaluate(() => { window.__scheduleFixture.requests = []; window.__scheduleFixture.hold = "82:live:1"; window.__scheduleTick(); });
    await page.waitForFunction(() => window.__scheduleFixture.pending.length === 1);
    await click(page.getByTestId("teacher-load-more-lessons"));
    await page.evaluate(() => { window.__scheduleTeacherId = 81; window.dispatchEvent(new Event("schedule-account")); });
    await page.getByText("Teacher lesson 501", { exact: true }).waitFor();
    await page.evaluate(() => window.__scheduleFixture.release());
    await page.waitForTimeout(100);
    check(!(await page.evaluate(() => window.__scheduleFixture.requests)).includes("82:live:2"), `${width}: account change discards the previous teacher's queued intent`);
    check(errors.length === 0, `${width}: no browser exceptions`);
    check(escaped.length === 0, `${width}: no service or real-record request escaped the fixture`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`${passed} teacher Schedule checks passed. Screenshots: ${work}`);
