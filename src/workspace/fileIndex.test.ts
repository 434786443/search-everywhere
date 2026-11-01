import { test } from "node:test";
import assert from "node:assert/strict";
import { keyFor, makeEntries, shouldFullRebuild } from "./fileIndex";
import { FILE_BATCH_LIMIT } from "../limits";

test("a single folder keeps the bare relative path", () => {
  assert.equal(keyFor({ name: "repo", fsPath: "/repo" }, "src/A.java", true), "src/A.java");
  assert.equal(keyFor({ name: "repo", fsPath: "/repo" }, "src/A.java", false), "repo/src/A.java");
});

test("multiple folders prefix the folder name", () => {
  const folders = [
    { name: "app", fsPath: "/code/app" },
    { name: "lib", fsPath: "/code/lib" },
  ];
  const entries = makeEntries(folders, new Map([
    ["/code/app", ["src/A.java"]],
    ["/code/lib", ["src/A.java"]],
  ]));
  assert.deepEqual(entries.map(entry => entry.key), ["app/src/A.java", "lib/src/A.java"]);
  assert.ok(entries.every(entry => entry.library === false));
});

test("a single folder does not prefix", () => {
  const entries = makeEntries([{ name: "repo", fsPath: "/repo" }], new Map([["/repo", ["src/A.java"]]]));
  assert.deepEqual(entries.map(entry => entry.key), ["src/A.java"]);
});

test("batches over the limit fall back to a full rebuild", () => {
  assert.equal(shouldFullRebuild(FILE_BATCH_LIMIT), false);
  assert.equal(shouldFullRebuild(FILE_BATCH_LIMIT + 1), true);
});

test("missing folders contribute nothing", () => {
  const entries = makeEntries([{ name: "a", fsPath: "/a" }, { name: "b", fsPath: "/b" }], new Map([["/a", ["x"]]]));
  assert.deepEqual(entries.map(entry => entry.key), ["a/x"]);
});
