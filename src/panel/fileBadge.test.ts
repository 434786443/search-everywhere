import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMAND_BADGE, fileBadge } from "./fileBadge";

test("java, go and typescript get their own badge", () => {
  assert.deepEqual(fileBadge(".java"), { text: "J", color: "#E76F00" });
  assert.deepEqual(fileBadge(".go"), { text: "GO", color: "#00ADD8" });
  assert.deepEqual(fileBadge(".ts"), { text: "TS", color: "#3178C6" });
});

test("extension matching ignores case and a missing dot", () => {
  assert.deepEqual(fileBadge(".JAVA"), fileBadge(".java"));
  assert.deepEqual(fileBadge("JAVA"), fileBadge(".java"));
  assert.deepEqual(fileBadge(".Go"), fileBadge(".go"));
});

test("dependency classes reuse the java badge", () => {
  assert.deepEqual(fileBadge(".class"), fileBadge(".java"));
});

test("an unknown or empty extension has no badge", () => {
  assert.equal(fileBadge(".unknownext"), undefined);
  assert.equal(fileBadge(""), undefined);
  assert.equal(fileBadge("."), undefined);
});

test("commands get a fixed glyph", () => {
  assert.equal(COMMAND_BADGE.text, ">");
});
