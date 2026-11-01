import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneRecents, pushRecent } from "./recentFiles";
import { RECENT_LIMIT } from "../limits";

test("pushes the newest key first and drops duplicates", () => {
  assert.deepEqual(pushRecent(["b", "a"], "a"), ["a", "b"]);
  assert.deepEqual(pushRecent([], "a"), ["a"]);
  assert.deepEqual(pushRecent(["a"], "a"), ["a"]);
});

test("ignores an empty key", () => {
  assert.deepEqual(pushRecent(["a"], ""), ["a"]);
});

test("keeps at most RECENT_LIMIT entries", () => {
  let list: string[] = [];
  for (let index = 0; index < RECENT_LIMIT + 5; index += 1) list = pushRecent(list, `f${index}`);
  assert.equal(list.length, RECENT_LIMIT);
  assert.equal(list[0], `f${RECENT_LIMIT + 4}`);
  assert.equal(list.includes("f0"), false);
});

test("drops keys that left the index", () => {
  const live = new Set(["a", "c"]);
  assert.deepEqual(pruneRecents(["a", "b", "c"], live), ["a", "c"]);
});
