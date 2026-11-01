import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFileQuery } from "./fileQuery";

test("splits extension tokens from search words", () => {
  assert.deepEqual(parseFileQuery("User .java"), { text: "User", terms: ["User"], extensions: [".java"] });
  assert.deepEqual(parseFileQuery("Order *.java,*.xml").extensions, [".java", ".xml"]);
  assert.deepEqual(parseFileQuery("User.java").terms, ["User.java"]);
  assert.deepEqual(parseFileQuery(".java"), { text: "", terms: [], extensions: [".java"] });
  assert.deepEqual(parseFileQuery(""), { text: "", terms: [], extensions: [] });
});

test("reads a trailing line and column", () => {
  assert.deepEqual(parseFileQuery("Button.tsx:12"), { text: "Button.tsx", terms: ["Button.tsx"], extensions: [], line: 12 });
  assert.deepEqual(parseFileQuery("Button.tsx:1:5"), { text: "Button.tsx", terms: ["Button.tsx"], extensions: [], line: 1 });
  assert.deepEqual(parseFileQuery("notes.md:0").line, undefined);
});

test("a drive letter is not a line suffix", () => {
  assert.deepEqual(parseFileQuery("C:\\src\\A.java").terms, ["C:\\src\\A.java"]);
  assert.equal(parseFileQuery("C:\\src\\A.java").line, undefined);
});

test("strips a workspace root prefix", () => {
  const parsed = parseFileQuery("/repo/src/Button.tsx:7", ["/repo"]);
  assert.equal(parsed.text, "src/Button.tsx");
  assert.equal(parsed.line, 7);
  assert.equal(parseFileQuery("/repo/", ["/repo"]).text, "");
});

test("keeps a position suffix on a jar-style relative path", () => {
  const parsed = parseFileQuery("com/foo/Bar.java:42", []);
  assert.equal(parsed.text, "com/foo/Bar.java");
  assert.equal(parsed.line, 42);
});
