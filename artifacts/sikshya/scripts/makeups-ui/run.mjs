import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-makeups-ui-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({
  entry: path.join(here, "entry.tsx"),
  outfile: bundle,
  alias: {
    "@/utils/api": path.join(here, "api.js"),
    "expo-router": path.join(here, "router.js"),
    "expo-crypto": path.join(here, "crypto.js"),
    "react-native-safe-area-context": path.resolve(
      here,
      "../class-home-journey/context.js",
    ),
    "@/context/NotificationContext": path.resolve(
      here,
      "../class-home-journey/context.js",
    ),
    "expo-font": path.resolve(here, "../batch-planner/font.js"),
    "@react-native-community/datetimepicker": path.resolve(
      here,
      "../batch-planner/native.js",
    ),
  },
});
assert.ok(built.ok, built.error);
const server = createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/bundle.js" ? "application/javascript" : "text/html",
  );
  res.end(
    req.url === "/bundle.js"
      ? readFileSync(bundle)
      : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}body{font-family:Inter,system-ui,sans-serif}</style><div id="root"></div><script src="/bundle.js"></script>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await (await getChromium()).launch({ headless: true });
const base = `http://127.0.0.1:${server.address().port}`;
let passed = 0;
const check = (value, label) => {
  assert.ok(value, label);
  passed++;
  console.log(`PASS ${label}`);
};
try {
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      timezoneId: width === 390 ? "Asia/Kathmandu" : "America/Chicago",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(base);
    await page.getByText("No requests to arrange", { exact: true }).waitFor();
    check(!(await page.getByRole("button", { name: "Request make-up", exact: true }).count()), `${width}: request inbox is not every purchased lesson`);
    await page.getByRole("button", { name: /^Choose a lesson/ }).click();
    await page
      .getByRole("button", { name: "Request make-up", exact: true })
      .waitFor();
    check(
      (await page.locator("body").innerText()).includes(
        "2 of 2 courtesy make-ups available",
      ),
      `${width}: server quota displayed`,
    );
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${width}: no horizontal overflow`,
    );
    check(
      (await page.locator("body").innerText()).includes("09:00 Nepal time"),
      `${width}: Nepal lesson time does not use device timezone`,
    );
    await page
      .getByRole("button", { name: "Request make-up", exact: true })
      .click();
    check(!(await page.getByRole("button", { name: "The teacher did not teach this lesson", exact: true }).count()), `${width}: future lesson cannot be reported as teacher non-delivery`);
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    check(
      await page.getByText(/Add a little detail/).isVisible(),
      `${width}: request requires useful context`,
    );
    check(
      (
        await page.evaluate(() =>
          window.requests.filter((item) => item.method === "POST"),
        )
      ).length === 0,
      `${width}: empty request not sent`,
    );
    await page
      .getByRole("textbox", { name: "Make-up request details" })
      .fill("I have a school activity and need another date.");
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await page.getByText("Requested", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Close", exact: true })
      .waitFor({ state: "hidden" });
    const request = await page.evaluate(() =>
      window.requests.find((item) => item.method === "POST"),
    );
    check(
      request.path === "/sessions/105/makeup-request" &&
        request.body.reason === "student_missed",
      `${width}: correct original lesson request`,
    );
    check(
      /^[\w-]{8,100}$/.test(request.body.requestKey),
      `${width}: durable request key supplied`,
    );
    check(
      (await page.locator("body").innerText()).includes(
        "1 of 2 courtesy make-ups available",
      ),
      `${width}: pending request reserves quota`,
    );
    await page.screenshot({
      path: path.join(work, `${width}-requested.png`),
      fullPage: true,
    });
    await page.goto(`${base}?past`);
    await page.getByRole("button", { name: /^Choose a lesson/ }).click();
    await page.getByRole("button", { name: "Request make-up", exact: true }).click();
    await page.getByRole("button", { name: "The teacher did not teach this lesson", exact: true }).click();
    await page.getByRole("textbox", { name: "Make-up request details" }).fill("The scheduled lesson ended without the teacher teaching it.");
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await page.getByText("Requested", { exact: true }).waitFor();
    const reported = await page.evaluate(() => window.requests.find(item => item.method === "POST"));
    check(reported.path === "/sessions/105/makeup-request" && reported.body.reason === "teacher_missed", `${width}: completed-window report is distinct from a courtesy absence`);
    await page.goto(`${base}?offered&original`);
    await page
      .getByRole("button", { name: "Accept date", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open make-up lesson", exact: true })
      .waitFor();
    check(
      (await page.locator("body").innerText()).includes("Make-up assigned"),
      `${width}: accepted replacement is distinct`,
    );
    await page
      .getByRole("button", { name: "Open make-up lesson", exact: true })
      .click();
    check(
      await page.evaluate(() => window.lastNavigation?.params?.id === "200"),
      `${width}: assigned session opens not original/new checkout`,
    );
    await page.goto(`${base}?full-quota`);
    await page.getByRole("button", { name: /^Choose a lesson/ }).click();
    await page
      .getByText("0 of 2 courtesy make-ups available", { exact: true })
      .waitFor();
    check(
      !(await page
        .getByRole("button", { name: "Request make-up", exact: true })
        .count()),
      `${width}: full quota cannot request courtesy`,
    );
    check(
      await page
        .getByRole("button", { name: "Refund review / help", exact: true })
        .count(),
      `${width}: refund review preserved`,
    );
    await page.goto(`${base}?teacher&teacher-missed`);
    await page
      .getByRole("button", { name: "Offer a date", exact: true })
      .click();
    check(
      (await page.locator("body").innerText()).includes("I have a school activity and need another date."),
      `${width}: teacher can read request context without private operator notes`,
    );
    await page
      .getByRole("textbox", { name: "Replacement Nepal start time" })
      .fill("09:00");
    check(await page.getByText(/Choosing Replace undelivered lesson confirms/).isVisible(), `${width}: specific replacement action discloses acknowledgement and quota effect`);
    check(!(await page.getByRole("button", { name: /Confirm I did not deliver/ }).count()), `${width}: no separate confession toggle`);
    check(await page.getByRole("button", { name: "I taught this lesson — review request", exact: true }).count(), `${width}: disputed delivery has a separate review path`);
    await page
      .getByRole("button", { name: "Replace undelivered lesson", exact: true })
      .click();
    await page.getByText("Date offered", { exact: true }).waitFor();
    const offered = await page.evaluate(() =>
      window.requests.find((item) => item.method === "POST"),
    );
    check(
      offered.body.startsAt === "2026-10-01T03:15:00.000Z" &&
        offered.body.confirmTeacherNonDelivery === true,
      `${width}: Nepal date and confirmation transmitted`,
    );
    await page.goto(`${base}?teacher&future-original`);
    await page.getByRole("button", { name: "Offer a date", exact: true }).click();
    check(await page.getByRole("textbox", { name: "Replacement Nepal start time" }).inputValue() === "10:01", `${width}: future original defaults after its own finish, not tomorrow`);
    await page.getByRole("textbox", { name: "Replacement Nepal start time" }).fill("10:00");
    await page.getByRole("button", { name: "Offer this date", exact: true }).click();
    check(await page.getByText(/Choose a time after the original lesson ends/).isVisible(), `${width}: invalid date rejected beside form before sending`);
    check(await page.evaluate(() => !window.requests.some(row => row.method === "POST")), `${width}: invalid offer makes no mutation`);
    await page.getByRole("textbox", { name: "Replacement Nepal start time" }).fill("10:01");
    await page.getByRole("button", { name: "Offer this date", exact: true }).click();
    await page.getByText("Date offered", { exact: true }).waitFor();
    check((await page.evaluate(() => window.requests.find(row => row.method === "POST"))).body.startsAt === "2026-10-10T04:16:00.000Z", `${width}: correct original-specific suggested offer transmitted`);
    await page.goto(`${base}?teacher&closed-window`);
    await page.getByRole("button", { name: "Offer a date", exact: true }).click();
    check(await page.getByText("No replacement time available", { exact: true }).isVisible(), `${width}: closed time window clearly explained`);
    check(!(await page.getByRole("button", { name: "Offer this date", exact: true }).isEnabled()), `${width}: unavailable window cannot submit a fabricated date`);
    for (const role of ["teacher", "operator"]) {
      await page.goto(`${base}?${role}&untouched`);
      await page.getByRole("button", { name: "All cases", exact: true }).click();
      check(!(await page.getByText("Untouched upcoming lesson", { exact: true }).count()), `${width}: ${role} all cases excludes untouched scheduled lessons`);
    }
    await page.goto(`${base}?operator&accepted`);
    await page.getByRole("button", { name: /^Scheduled/ }).click();
    await page
      .getByRole("button", { name: "Review & decide", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Confirm replacement delivered",
        exact: true,
      })
      .click();
    await page
      .getByRole("textbox", { name: "Private review evidence" })
      .fill("Synthetic delivery reviewed against actual lesson evidence.");
    await page
      .getByRole("button", { name: "Record decision", exact: true })
      .click();
    check(
      await page.getByText(/Review the evidence and confirm/).isVisible(),
      `${width}: operator cannot infer delivery from connection`,
    );
    await page
      .getByRole("button", {
        name: "Confirm I reviewed delivery evidence",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Record decision", exact: true })
      .click();
    await page
      .getByText("Delivered — review window", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Close", exact: true })
      .waitFor({ state: "hidden" });
    check(
      (
        await page.evaluate(() =>
          window.requests.find((item) => item.method === "POST"),
        )
      ).body.confirmed === true,
      `${width}: explicit operator confirmation sent`,
    );
    await page.screenshot({
      path: path.join(work, `${width}-operator.png`),
      fullPage: true,
    });
    await page.goto(`${base}?disabled`);
    await page
      .getByText("Make-ups are not available on this server yet", {
        exact: true,
      })
      .waitFor();
    check(
      !(await page
        .getByRole("button", { name: "Request make-up", exact: true })
        .count()),
      `${width}: inactive feature not working-looking`,
    );
    await page.goto(`${base}?disabled&accepted`);
    await page.getByRole("button", { name: /^Scheduled/ }).click();
    await page
      .getByText("New make-up actions are paused", { exact: true })
      .waitFor();
    check(
      await page
        .getByRole("button", { name: "Open make-up lesson", exact: true })
        .count(),
      `${width}: paused feature preserves assigned lesson history`,
    );
    await page.goto(`${base}?load-failed`);
    await page
      .getByText("Synthetic temporary load failure", { exact: true })
      .waitFor();
    check(
      !(await page
        .getByText("Nothing here right now", { exact: true })
        .count()),
      `${width}: failed load not an empty state`,
    );
    await page.goto(`${base}?retry`);
    await page.getByRole("button", { name: /^Choose a lesson/ }).click();
    await page
      .getByRole("button", { name: "Request make-up", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Make-up request details" })
      .fill("Please help arrange a different date for this lesson.");
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await page
      .getByText("Synthetic request timed out. Please retry.", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await page.getByText("Requested", { exact: true }).waitFor();
    const posts = await page.evaluate(() =>
      window.requests.filter((item) => item.method === "POST"),
    );
    check(
      posts.length === 2 &&
        posts[0].body.requestKey === posts[1].body.requestKey,
      `${width}: ambiguous retry keeps same idempotency key`,
    );
    check(errors.length === 0, `${width}: no browser exception`);
    await page.close();
  }
  console.log(
    `PASS ${passed} make-up UI assertions. Synthetic fixtures only. Screenshots: ${work}`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
