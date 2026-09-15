import assert from "node:assert/strict";
import test from "node:test";

import { ATTACHMENT_PICKER_TYPES, attachmentContentType, attachmentKind, attachmentKindLabel } from "./attachmentTypes.ts";

test("recognises every attachment Fadko can preview or download", () => {
  assert.equal(attachmentKind("image/jpeg"), "image");
  assert.equal(attachmentKind("application/pdf"), "pdf");
  assert.equal(attachmentKind("application/msword"), "word");
  assert.equal(attachmentKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "word");
  assert.equal(attachmentKind("application/vnd.ms-excel"), "spreadsheet");
  assert.equal(attachmentKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "spreadsheet");
  assert.equal(attachmentKind("application/octet-stream"), "file");
});

test("older homework rows can recover their viewer type from the private key", () => {
  assert.equal(attachmentContentType("evidence/7/private.PDF"), "application/pdf");
  assert.equal(attachmentContentType("worksheet.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(attachmentContentType("marks.xlsx?temporary=1"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(attachmentContentType("unknown.bin"), "application/octet-stream");
});

test("picker includes Word and Excel without accepting arbitrary executables", () => {
  assert.ok(ATTACHMENT_PICKER_TYPES.includes("application/pdf"));
  assert.ok(ATTACHMENT_PICKER_TYPES.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
  assert.ok(ATTACHMENT_PICKER_TYPES.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
  assert.equal(ATTACHMENT_PICKER_TYPES.includes("application/octet-stream" as never), false);
  assert.equal(attachmentKindLabel("application/vnd.ms-excel"), "Excel spreadsheet");
});
