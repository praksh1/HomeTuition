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
    await page
      .getByRole("button", { name: "Offer this date", exact: true })
      .click();
    check(
      await page.getByText(/Confirm the missed teaching below/).isVisible(),
      `${width}: teacher non-delivery confirmation required`,
    );
    await page
      .getByRole("button", {
        name: "Confirm I did not deliver the original lesson",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Offer this date", exact: true })
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
    await page.goto(`${base}?operator&accepted`);
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
