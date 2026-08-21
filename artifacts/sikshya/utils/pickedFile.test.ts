import assert from "node:assert/strict";
import { test } from "node:test";
import { isShareableSource, looksLikeImage, looksLikePdf } from "./pickedFile.ts";

test("a PDF that declares itself is a PDF", () => {
  assert.equal(looksLikePdf({ name: "notes.pdf", type: "application/pdf" }), true);
});

test("a PDF from an Android file manager, which declares nothing, is still a PDF", () => {
  // The reported bug. Downloads and Drive hand over files with no type at all, and the old
  // check sent them to the image path, where a teacher was told their PDF was not an image.
  assert.equal(looksLikePdf({ name: "chapter-4.pdf", type: "" }), true);
  assert.equal(looksLikePdf({ name: "chapter-4.PDF", type: "application/octet-stream" }), true);
  assert.equal(looksLikePdf({ name: "chapter-4.pdf" }), true);
});

test("a photo is not mistaken for a PDF", () => {
  assert.equal(looksLikePdf({ name: "photo.jpg", type: "image/jpeg" }), false);
  assert.equal(looksLikePdf({ name: "photo.jpg", type: "" }), false);
});

test("a file that declares a real, different type is believed", () => {
  // Only an absent or meaningless type falls back to the name; a wrong extension on a file
  // that knows what it is should not override it.
  assert.equal(looksLikePdf({ name: "actually-a-photo.pdf", type: "image/jpeg" }), false);
});

test("photos are recognised however they arrive", () => {
  assert.equal(looksLikeImage({ name: "a.jpg", type: "image/jpeg" }), true);
  assert.equal(looksLikeImage({ name: "a.HEIC", type: "" }), true, "an iPhone photo with no type");
  assert.equal(looksLikeImage({ name: "a.png", type: "application/octet-stream" }), true);
});

test("a PDF is not mistaken for a photo", () => {
  assert.equal(looksLikeImage({ name: "notes.pdf", type: "application/pdf" }), false);
  assert.equal(looksLikeImage({ name: "notes.pdf", type: "" }), false);
});

test("something unrecognisable is neither", () => {
  assert.equal(looksLikePdf({ name: "archive.zip", type: "" }), false);
  assert.equal(looksLikeImage({ name: "archive.zip", type: "" }), false);
  assert.equal(looksLikePdf({}), false);
  assert.equal(looksLikeImage({}), false);
});

test("bytes can go on the board; a path on one phone cannot", () => {
  assert.equal(isShareableSource("data:application/pdf;base64,JVBERi0="), true);
  assert.equal(isShareableSource("https://example.com/notes.pdf"), true);
  assert.equal(isShareableSource("file:///var/mobile/Containers/notes.pdf"), false, "iOS picker");
  assert.equal(isShareableSource("content://com.android.providers.downloads/1"), false, "Android");
});

test("an unfamiliar scheme is refused rather than guessed at", () => {
  // Refusing wrongly opens the local viewer and says the class cannot see it. Accepting
  // wrongly breaks the lesson for every student and tells nobody.
  assert.equal(isShareableSource("ph://ABCD-1234"), false, "an iOS photo library reference");
  assert.equal(isShareableSource("assets-library://asset/asset.JPG"), false);
  assert.equal(isShareableSource(""), false);
});

test("whitespace around a source does not change what it is", () => {
  assert.equal(isShareableSource("  data:application/pdf;base64,JVBERi0="), true);
  assert.equal(isShareableSource(" file:///tmp/notes.pdf "), false);
});
