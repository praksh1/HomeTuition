import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bundleForBrowser } from "../bundle-for-browser.mjs";
import { getChromium } from "../board-tests/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), "fadko-profile-ui-"));
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({
  entry: path.join(here, "entry.tsx"),
  outfile: bundle,
  alias: {
    "@/context/AuthContext": path.join(here, "auth.js"),
    "@/utils/api": path.join(here, "api.js"),
    "@/components/SocialSignIn": path.join(here, "social.js"),
    "@/utils/openAttachment": path.join(here, "attachment.js"),
    "@/utils/uploadFile": path.join(here, "upload.js"),
    "expo-router": path.join(here, "router.js"),
    "react-native-safe-area-context": path.join(here, "context.js"),
    "expo-document-picker": path.join(here, "document-picker.js"),
    "expo-haptics": path.join(here, "haptics.js"),
    "expo-font": path.resolve(here, "../batch-planner/font.js"),
  },
});
assert.ok(built.ok, built.error);

const server = createServer((req, res) => {
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
    page.on("pageerror", (error) => errors.push(String(error)));

    await page.goto(`${base}?screen=student`);
    await page.getByText("MY FADKO PROFILE", { exact: true }).waitFor();
    await page.getByTestId("student-account-details").waitFor();
    let body = await page.locator("body").innerText();
    check(body.includes("Account & payments"), `${width}: student account actions have a clear section`);
    check(body.includes("Charges, test payments and refunds"), `${width}: payments action explains its destination`);
    check(!body.includes("No saved payment method"), `${width}: empty payment-method explanation is gone`);
    check((await page.getByTestId("student-edit-account-details").boundingBox()).height >= 44, `${width}: student edit action meets touch floor`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: student profile has no horizontal overflow`);
    await page.screenshot({ path: path.join(work, `${width}-student.png`), fullPage: true });

    await page.goto(`${base}?screen=teacher&role=teacher`);
    await page.getByText("MY TEACHING PROFILE", { exact: true }).waitFor();
    await page.getByTestId("teacher-account-details").waitFor();
    body = await page.locator("body").innerText();
    check(body.includes("Teaching tools"), `${width}: teacher tools are grouped`);
    check(!body.includes("National ID / Citizenship"), `${width}: teacher document forms start collapsed`);
    check((await page.getByTestId("teacher-credentials-toggle").boundingBox()).height >= 44, `${width}: credentials disclosure meets touch floor`);
    await page.getByTestId("teacher-credentials-toggle").click();
    await page.getByText("National ID / Citizenship", { exact: true }).waitFor();
    check((await page.locator("body").innerText()).includes("1 approved · 1 submitted"), `${width}: credential summary stays visible`);
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

    await page.goto(`${base}?screen=editor&profile=incomplete`);
    await page.getByText("Contact", { exact: true }).waitFor();
    check((await page.getByTestId("account-phone").inputValue()) === "", `${width}: an incomplete legacy account does not invent a phone`);
    check((await page.getByTestId("account-province").innerText()).includes("Choose province"), `${width}: an incomplete legacy account does not preselect a province`);
    check((await page.getByTestId("account-district").innerText()).includes("Choose province first"), `${width}: district waits for the person's province`);
    await page.getByTestId("account-save").click();
    check(await page.getByTestId("account-phone-error").isVisible(), `${width}: Save points to the missing phone beside the field`);
    check((await page.getByTestId("account-province-error").count()) === 0, `${width}: Save does not blame a valid-looking location for a missing phone`);
    await page.getByTestId("account-phone").fill("+977 9800000000");
    check((await page.getByTestId("account-phone-error").count()) === 0, `${width}: correcting the phone clears its error immediately`);
    await page.getByTestId("account-save").click();
    check(await page.getByTestId("account-province-error").isVisible(), `${width}: validation advances to the next missing choice`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: validation does not create horizontal overflow`);
    await page.screenshot({ path: path.join(work, `${width}-editor-errors.png`), fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`${passed} checks passed. Screenshots: ${work}`);
