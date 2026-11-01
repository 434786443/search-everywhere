import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "./parseQuery";

test("User .java", () => {
  assert.deepEqual(parseQuery("User .java"), { terms: ["User"], extensions: [".java"] });
});

test("comma masks", () => {
  assert.deepEqual(parseQuery("*.java,*.xml"), { terms: [], extensions: [".java", ".xml"] });
  assert.deepEqual(parseQuery(".java,.xml"), { terms: [], extensions: [".java", ".xml"] });
});

test("User.java stays a term", () => {
  assert.deepEqual(parseQuery("User.java"), { terms: ["User.java"], extensions: [] });
});

test("extension case and empty input", () => {
  assert.deepEqual(parseQuery("  .JAVA  "), { terms: [], extensions: [".java"] });
  assert.deepEqual(parseQuery("   "), { terms: [], extensions: [] });
});

test("two terms share one mask", () => {
  assert.deepEqual(parseQuery("foo bar .java"), { terms: ["foo", "bar"], extensions: [".java"] });
});
