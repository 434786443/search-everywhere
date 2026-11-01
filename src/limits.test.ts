import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_GROUP_CAP, CONTENT_DEBOUNCE_MS, EMPTY_HINT, FILE_TEXT_CAP, JAR_TEXT_CAP, REBUILD_DEBOUNCE_MS, RESOLVE_TIMEOUT_MS, TAB_CAP } from "./limits";

test("spec limits", () => {
  assert.equal(ALL_GROUP_CAP, 8);
  assert.equal(TAB_CAP, 100);
  assert.equal(CONTENT_DEBOUNCE_MS, 200);
  assert.equal(REBUILD_DEBOUNCE_MS, 1000);
  assert.equal(RESOLVE_TIMEOUT_MS, 180000);
  assert.equal(FILE_TEXT_CAP, 1048576);
  assert.equal(JAR_TEXT_CAP, 52428800);
  assert.equal(EMPTY_HINT, "输入关键词，用 .java 或 *.java,*.xml 按后缀过滤。");
});
