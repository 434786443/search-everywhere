import { test } from "node:test";
import assert from "node:assert/strict";
import { contentRgArgs, parseRgMatches, toRgExclude } from "./rg";

test("exclude patterns become ripgrep globs", () => {
  assert.equal(toRgExclude("**/node_modules"), "!**/node_modules");
  assert.equal(toRgExclude("target"), "!**/target");
});

test("content args require every term and the extension glob", () => {
  const args = contentRgArgs({ terms: ["User", "Service"], extensions: [".java"] }, ["!**/target"]);
  assert.ok(args.includes("-i"));
  assert.ok(args.includes("*.java"));
  assert.ok(args.includes("(?=.*User)(?=.*Service).*"));
  assert.ok(args.includes("!**/target"));
});

test("parse ripgrep lines and stop at the limit", () => {
  const parsed = parseRgMatches("src/User.java:3:class User\nsrc/Other.java:4:class User\n", 1);
  assert.deepEqual(parsed, [{ path: "src/User.java", line: 3, preview: "class User" }]);
});
