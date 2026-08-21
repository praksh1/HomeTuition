import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PDF_BYTES, preparePickedPdf, type ReadableFile } from "./pickedPdf.ts";

const PATH = "file:///var/mobile/Containers/Data/tmp/notes.pdf";

function file(over: Partial<ReadableFile> = {}): ReadableFile {
  return { exists: true, size: 1_000, base64: async () => "JVBERi0xLjQ=", ...over };
}

test("a readable PDF becomes bytes the board can hold", async () => {
  const picked = await preparePickedPdf(PATH, () => file());
  assert.equal(picked.shareable, true);
  assert.ok(picked.shareable && picked.dataUrl.startsWith("data:application/pdf;base64,"));
  assert.ok(picked.shareable && picked.dataUrl.endsWith("JVBERi0xLjQ="));
});

test("a PDF that vanished between picking and reading is not lost, only unshared", async () => {
  const picked = await preparePickedPdf(PATH, () => file({ exists: false }));
  assert.equal(picked.shareable, false);
  // The teacher keeps the document. Refusing to open it at all would be a worse answer than
  // opening it for one person and saying so.
  assert.equal(picked.shareable === false && picked.localUri, PATH);
  assert.match(picked.shareable === false ? picked.reason : "", /could not be opened/i);
});

test("a PDF too large to carry is refused before it is read", async () => {
  let read = false;
  const picked = await preparePickedPdf(PATH, () =>
    file({ size: MAX_PDF_BYTES + 1, base64: async () => { read = true; return "x"; } }),
  );
  assert.equal(picked.shareable, false);
  // Reading it first is the thing this is meant to avoid: base64 makes a large file a third
  // larger again, in the memory of a phone that has little of it.
  assert.equal(read, false, "an oversized PDF must not be read into memory at all");
  assert.match(picked.shareable === false ? picked.reason : "", /under 8 MB/);
});

test("a PDF exactly at the ceiling is still shared", async () => {
  const picked = await preparePickedPdf(PATH, () => file({ size: MAX_PDF_BYTES }));
  assert.equal(picked.shareable, true);
});

test("an empty read is a failure, not a document with no pages", async () => {
  const picked = await preparePickedPdf(PATH, () => file({ base64: async () => "" }));
  assert.equal(picked.shareable, false);
  assert.match(picked.shareable === false ? picked.reason : "", /empty/i);
});

test("a file system that throws does not take the classroom down with it", async () => {
  const opening = await preparePickedPdf(PATH, () => { throw new Error("permission denied"); });
  assert.equal(opening.shareable, false);
  assert.equal(opening.shareable === false && opening.localUri, PATH);

  const reading = await preparePickedPdf(PATH, () =>
    file({ base64: async () => { throw new Error("i/o error"); } }),
  );
  assert.equal(reading.shareable, false);
  assert.equal(reading.shareable === false && reading.localUri, PATH);
});

test("the reason a teacher is shown never leaks the underlying error", async () => {
  const picked = await preparePickedPdf(PATH, () => {
    throw new Error("EACCES: permission denied, open '/data/user/0/com.sikshya.app/cache/x.pdf'");
  });
  assert.equal(picked.shareable, false);
  assert.doesNotMatch(picked.shareable === false ? picked.reason : "", /EACCES|\/data\/user/);
});
