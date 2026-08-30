/**
 * Stops the design system leaking.
 *
 * `constants/colors.ts` existed long before this check and was bypassed more than a hundred
 * times by hex literals written straight into screens. That is how a token file quietly stops
 * being one: nothing forbids the shortcut, the shortcut is faster, and a year later changing a
 * colour means editing forty files and missing three.
 *
 * ## Why this ratchets instead of just failing
 *
 * A check that goes red on a hundred pre-existing violations is a check somebody deletes on the
 * afternoon they need to ship. So this one is a **baseline that can only go down**: every file's
 * current count is recorded, and the run fails when a file gets *worse* or a new file arrives
 * dirty. Fixing a screen lowers its number; the number can never rise again.
 *
 * The end state is a baseline of zero, reached one screen at a time. Until then this catches the
 * thing that actually matters — new code adding to the pile.
 *
 * Usage:
 *   node scripts/design-lint/run.mjs             check, exit 1 on regression
 *   node scripts/design-lint/run.mjs --update    re-record the baseline after fixing screens
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");
const BASELINE = path.join(here, "baseline.json");

/** Where a design decision is allowed to be written as a literal. */
const ALLOWED_DIRS = ["constants"];
/** Where screens live — everything under these is held to the rule. */
const SCANNED = ["app", "components", "hooks"];

const SKIP_FILE = /\.(test|spec)\.[tj]sx?$/;

/**
 * A hex colour. Three, six or eight digits, so `#fff`, `#FFFFFF` and `#FFFFFF80` all count.
 *
 * Word-boundary anchored at the front so a fragment identifier inside a URL string does not
 * match, and length-anchored at the back so `#1234567890` (not a colour) does not either.
 */
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

/** A font size written as a number rather than taken from the scale. */
const RAW_FONT_SIZE = /\bfontSize:\s*[0-9]+(?:\.[0-9]+)?/g;

/**
 * An escape hatch, used sparingly and visibly.
 *
 * Some literals are genuinely not design decisions — a colour baked into a third-party embed's
 * config, or a value being passed to something outside our control. Putting the marker on the
 * line says "I know, and here is why", which is the difference between an exception and a leak.
 */
const ESCAPE = "design-lint-ignore";

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      out.push(...(await walk(full)));
    } else if (/\.(tsx|ts)$/.test(e.name) && !SKIP_FILE.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function violationsIn(text) {
  const hex = [];
  const size = [];
  text.split("\n").forEach((line, i) => {
    if (line.includes(ESCAPE)) return;
    for (const m of line.matchAll(HEX)) hex.push({ line: i + 1, found: m[0] });
    for (const m of line.matchAll(RAW_FONT_SIZE)) size.push({ line: i + 1, found: m[0].trim() });
  });
  return { hex, size };
}

async function main() {
  const update = process.argv.includes("--update");

  const files = [];
  for (const dir of SCANNED) files.push(...(await walk(path.join(appRoot, dir))));

  const current = {};
  const detail = {};
  for (const file of files) {
    const rel = path.relative(appRoot, file).split(path.sep).join("/");
    if (ALLOWED_DIRS.some((d) => rel.startsWith(`${d}/`))) continue;
    const v = violationsIn(readFileSync(file, "utf8"));
    if (v.hex.length || v.size.length) {
      current[rel] = { hex: v.hex.length, size: v.size.length };
      detail[rel] = v;
    }
  }

  const totals = Object.values(current).reduce(
    (a, c) => ({ hex: a.hex + c.hex, size: a.size + c.size }),
    { hex: 0, size: 0 },
  );

  if (update) {
    writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
    console.log(
      `Baseline written: ${Object.keys(current).length} files, ` +
        `${totals.hex} hex literals, ${totals.size} raw font sizes.`,
    );
    return;
  }

  if (!existsSync(BASELINE)) {
    console.error(
      "No baseline. Run `node scripts/design-lint/run.mjs --update` once to record where we are starting from.",
    );
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));

  const regressions = [];
  const improvements = [];

  for (const [file, counts] of Object.entries(current)) {
    const was = baseline[file];
    if (!was) {
      regressions.push({ file, kind: "new", counts, was: { hex: 0, size: 0 } });
      continue;
    }
    if (counts.hex > was.hex || counts.size > was.size) {
      regressions.push({ file, kind: "worse", counts, was });
    } else if (counts.hex < was.hex || counts.size < was.size) {
      improvements.push({ file, counts, was });
    }
  }
  for (const file of Object.keys(baseline)) {
    if (!current[file]) improvements.push({ file, counts: { hex: 0, size: 0 }, was: baseline[file] });
  }

  const baseTotals = Object.values(baseline).reduce(
    (a, c) => ({ hex: a.hex + c.hex, size: a.size + c.size }),
    { hex: 0, size: 0 },
  );

  console.log(
    `Design tokens — ${totals.hex} hex literals and ${totals.size} raw font sizes ` +
      `across ${Object.keys(current).length} files.`,
  );
  console.log(
    `Baseline: ${baseTotals.hex} hex, ${baseTotals.size} sizes. ` +
      `The baseline may go down. It may never go up.\n`,
  );

  if (improvements.length) {
    console.log(`${improvements.length} file(s) improved:`);
    for (const i of improvements) {
      console.log(
        `  ${i.file}  hex ${i.was.hex}→${i.counts.hex}  sizes ${i.was.size}→${i.counts.size}`,
      );
    }
    console.log("\n  Lock it in: node scripts/design-lint/run.mjs --update\n");
  }

  if (!regressions.length) {
    console.log("No new leaks. ✓");
    return;
  }

  console.log(`${regressions.length} file(s) got worse:\n`);
  for (const r of regressions) {
    const d = detail[r.file];
    console.log(
      `  ${r.file} — ${r.kind === "new" ? "not in the baseline" : "above its baseline"}` +
        `  (hex ${r.was.hex}→${r.counts.hex}, sizes ${r.was.size}→${r.counts.size})`,
    );
    for (const h of d.hex.slice(0, 6)) console.log(`      line ${h.line}: ${h.found}`);
    for (const s of d.size.slice(0, 4)) console.log(`      line ${s.line}: ${s.found}`);
    const hidden = d.hex.length + d.size.length - Math.min(6, d.hex.length) - Math.min(4, d.size.length);
    if (hidden > 0) console.log(`      …and ${hidden} more`);
    console.log("");
  }

  console.log("Colours come from `useColors()`. Font sizes come from `useLayout().t`.");
  console.log(`If a literal genuinely is not a design decision, put \`${ESCAPE}\` on the line and say why.`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
