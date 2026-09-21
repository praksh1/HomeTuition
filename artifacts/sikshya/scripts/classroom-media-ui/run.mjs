/** Render the student's media preparation flow with fresh and settled browser permissions. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromium } from "../board-tests/harness.mjs";
import { bundleForBrowser } from "../bundle-for-browser.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const work = mkdtempSync(path.join(tmpdir(), "classroom-media-ui-"));
const entry = path.join(work, "entry.jsx");
writeFileSync(entry, `
import React from "react";
import { createRoot } from "react-dom/client";
import { ClassroomMediaPreparation } from ${JSON.stringify(path.join(appRoot, "components", "classes", "ClassroomMediaPreparation.tsx"))};
function Harness() {
  const [result, setResult] = React.useState(null);
  window.__result = result;
  return React.createElement(ClassroomMediaPreparation, { visible: !result, onComplete: setResult });
}
createRoot(document.getElementById("root")).render(React.createElement(Harness));
`);
const fontStub = path.join(work, "expo-font-stub.js");
writeFileSync(fontStub, `export async function loadAsync(){} export function isLoaded(){return true}
export function isLoading(){return false} export function useFonts(){return [true,null]}
export function processFontFamily(name){return name} export function getLoadedFonts(){return []}
export default {loadAsync,isLoaded,isLoading,useFonts,processFontFamily,getLoadedFonts};`);
const bundle = path.join(work, "bundle.js");
const built = await bundleForBrowser({ entry, outfile: bundle, alias: { "expo-font": fontStub } });
if (!built.ok) throw new Error(built.error);
const pagePath = path.join(work, "index.html");
writeFileSync(pagePath, `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id="root"></div><script src="bundle.js"></script></body></html>`);

const browser = await (await getChromium()).launch({ args: ["--no-sandbox"] });
let checks = 0;
try {
  for (const scenario of ["new", "returning", "denied", "skip"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.addInitScript((state) => {
      window.__requests = [];
      window.__stopped = 0;
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: {
          query: async () => {
            if (state === "skip") throw new Error("Permission query unavailable");
            return { state: state === "new" ? "prompt" : state === "denied" ? "denied" : "granted" };
          },
        },
      });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async (constraints) => {
            window.__requests.push(constraints.audio ? "microphone" : "camera");
            return { getTracks: () => [{ stop: () => { window.__stopped += 1; } }] };
          },
        },
      });
    }, scenario);
    await page.goto(`file://${pagePath}`);

    if (scenario === "new") {
      await page.getByTestId("classroom-media-preparation").waitFor();
      await page.getByTestId("classroom-media-continue").click();
    } else if (scenario === "skip") {
      await page.getByTestId("classroom-media-preparation").waitFor();
      await page.getByTestId("classroom-media-skip").click();
    }
    await page.waitForFunction(() => !!window.__result);
    const observed = await page.evaluate(() => ({ result: window.__result, requests: window.__requests, stopped: window.__stopped }));
    const expected = scenario === "new"
      ? { result: { microphone: "granted", camera: "granted" }, requests: ["microphone", "camera"], stopped: 2 }
      : scenario === "returning"
        ? { result: { microphone: "granted", camera: "granted" }, requests: [], stopped: 0 }
        : scenario === "denied"
          ? { result: { microphone: "denied", camera: "denied" }, requests: [], stopped: 0 }
          : { result: { microphone: "unavailable", camera: "unavailable" }, requests: [], stopped: 0 };
    if (JSON.stringify(observed) !== JSON.stringify(expected) || errors.length) {
      throw new Error(`${scenario}: ${JSON.stringify({ observed, expected, errors })}`);
    }
    checks += 1;
    console.log(`  ok   ${scenario}: ${scenario === "new" ? "prompt both, release tracks" : scenario === "skip" ? "join without media" : "reuse browser decisions"}`);
    await context.close();
  }
  console.log(`${checks} scenarios passed`);
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
