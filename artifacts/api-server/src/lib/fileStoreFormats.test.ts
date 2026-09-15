import assert from "node:assert/strict";
import test from "node:test";

import { ALLOWED_UPLOAD_TYPES, downloadDisposition, extensionFor } from "./fileStoreFormats.ts";

test("message storage accepts only the intended document families", () => {
  assert.ok(ALLOWED_UPLOAD_TYPES.includes("application/pdf"));
  assert.ok(ALLOWED_UPLOAD_TYPES.includes("application/msword"));
  assert.ok(ALLOWED_UPLOAD_TYPES.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
  assert.ok(ALLOWED_UPLOAD_TYPES.includes("application/vnd.ms-excel"));
  assert.ok(ALLOWED_UPLOAD_TYPES.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
  assert.equal(ALLOWED_UPLOAD_TYPES.includes("application/x-msdownload" as never), false);
});

test("download filenames cannot inject headers and retain a Unicode name", () => {
  const header = downloadDisposition("अभ्यास \"एक\"\r\nSet-Cookie: x.xlsx");
  assert.ok(header?.startsWith("attachment; filename="));
  assert.equal(header?.includes("\r"), false);
  assert.equal(header?.includes("\n"), false);
  assert.match(header ?? "", /filename\*=UTF-8''/);
  assert.match(header ?? "", /\.xlsx/);
});

test("Office formats retain the extension their receiving app expects", () => {
  assert.equal(extensionFor("application/msword"), ".doc");
  assert.equal(extensionFor("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), ".docx");
  assert.equal(extensionFor("application/vnd.ms-excel"), ".xls");
  assert.equal(extensionFor("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), ".xlsx");
});
