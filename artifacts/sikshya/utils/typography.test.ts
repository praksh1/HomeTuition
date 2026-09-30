import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";
import { interfaceFontFamily, interfaceFonts } from "../constants/fontFamilies.ts";

test("each interface weight uses its separately bundled Inter face on native", () => {
  for (const platform of ["ios", "android"]) {
    for (const weight of Object.keys(interfaceFonts) as Array<keyof typeof interfaceFonts>) {
      const family = interfaceFontFamily(weight, platform);
      assert.equal(family, interfaceFonts[weight]);
      assert.ok(!family.includes(","), "native cannot resolve a CSS font stack");
    }
  }
  assert.equal(new Set(Object.values(interfaceFonts)).size, 4);
});

test("web prioritizes the bundled face and local Nepali-capable platform fallbacks", () => {
  for (const weight of Object.keys(interfaceFonts) as Array<keyof typeof interfaceFonts>) {
    const family = interfaceFontFamily(weight, "web");
    assert.equal(family.split(",")[0], interfaceFonts[weight]);
    for (const fallback of ["Noto Sans Devanagari", "Kohinoor Devanagari", "Nirmala UI", "Mangal"]) {
      assert.ok(family.includes(`"${fallback}"`), `${fallback} should remain available for Nepali glyphs`);
    }
    assert.ok(family.endsWith("system-ui, sans-serif"));
    assert.doesNotMatch(family, /https?:|url\(/, "fallbacks must not add remote requests");
  }
});

test("all declared interface faces are actually registered by the app root", () => {
  const root = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
  const registration = /useFonts\(\{([^}]+)\}\)/.exec(root)?.[1];
  assert.ok(registration, "the app should keep an explicit bundled-font registration");
  for (const face of Object.values(interfaceFonts)) assert.ok(registration.includes(face), `${face} is not loaded`);
});

test("shared navigation chooses real weights and keeps notification digits tabular", () => {
  const tabs = readFileSync(new URL("../components/navigation/FloatingTabBar.tsx", import.meta.url), "utf8");
  const header = readFileSync(new URL("../components/navigation/AppShellHeader.tsx", import.meta.url), "utf8");
  assert.match(tabs, /fontFamily:\s*family\(focused\s*\?\s*"bold"\s*:\s*"medium"\)/);
  assert.match(tabs, /t\.caption,\s*numeric,\s*styles\.badgeText/);
  assert.doesNotMatch(tabs, /fontWeight:/, "do not synthesize bold on a medium Inter face");
  assert.match(header, /fontFamily:\s*family\("bold"\)/);
});
