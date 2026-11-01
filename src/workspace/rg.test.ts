import { test } from "node:test";
import assert from "node:assert/strict";
import { contentRgArgs, normalizeRgPath, parseRgFiles, parseRgMatches, searchContentFolders, toRgExclude } from "./rg";
import { SearchHit } from "../types";

test("exclude patterns become ripgrep globs", () => {
  assert.equal(toRgExclude("**/node_modules"), "!**/node_modules");
  assert.equal(toRgExclude("target"), "!**/target");
});

test("content args require every term and the extension glob", () => {
  const args = contentRgArgs({ terms: ["User", "Service"], extensions: [".java"] }, ["!**/target"]);
  assert.ok(args.includes("--pcre2"));
  assert.ok(args.includes("-i"));
  assert.ok(args.includes("*.java"));
  assert.ok(args.includes("(?=.*User)(?=.*Service).*"));
  assert.ok(args.includes("!**/target"));
});

test("annotation queries search java files for the annotation token", () => {
  const args = contentRgArgs({ terms: ["@Bean"], extensions: [] }, []);
  assert.ok(args.includes("*.java"));
  assert.ok(args.includes("!**/*.prefs"));
  assert.ok(args.includes("(?=.*@Bean\\b).*"));
});

test("drops a single enormous content line", () => {
  const huge = `src/eclipse/org.eclipse.jdt.ui.prefs:66:${"x".repeat(1001)}`;
  assert.deepEqual(parseRgMatches(`${huge}\nsrc/Bean.java:3:    @Bean\n`, 10), [
    { path: "src/Bean.java", line: 3, preview: "    @Bean" },
  ]);
});

test("parse ripgrep lines and stop at the limit", () => {
  const parsed = parseRgMatches("src/User.java:3:class User\nsrc/Other.java:4:class User\n", 1);
  assert.deepEqual(parsed, [{ path: "src/User.java", line: 3, preview: "class User" }]);
});

test("normalizes ripgrep paths that start with .\\", () => {
  assert.equal(normalizeRgPath(".\\src\\User.java"), "src/User.java");
  assert.equal(normalizeRgPath("./src/User.java"), "src/User.java");
  assert.deepEqual(parseRgFiles(".\\src\\User.java\n./src/Other.java\n"), ["src/User.java", "src/Other.java"]);
  const parsed = parseRgMatches(".\\src\\User.java:3:class User\n", 1);
  assert.equal(parsed[0].path, "src/User.java");
});

test("one folder failure keeps the other folder and dependency hits within one cap", async () => {
  const dependency: SearchHit = {
    id: "jar",
    kind: "content",
    title: "A.java",
    detail: "jar",
    source: { type: "jar", jarName: "a.jar" },
    extension: ".java",
    preview: "User",
    stableIndex: 0,
  };
  const hits = await searchContentFolders(
    [{ key: "bad" }, { key: "ok" }, { key: "extra" }],
    async (folder) => {
      if (folder.key === "bad") throw new Error("rg failed");
      if (folder.key === "ok") return "src/User.java:3:class User\nsrc/Next.java:4:class User\n";
      return "src/Later.java:5:class User\n";
    },
    2,
    [dependency],
    (folderKey, match, stableIndex) => ({
      id: `${folderKey}:${match.path}`,
      kind: "content",
      title: match.path,
      detail: match.path,
      source: { type: "workspace" },
      extension: ".java",
      preview: match.preview,
      stableIndex,
    }),
  );
  assert.deepEqual(hits.map(hit => hit.id), ["ok:src/User.java", "ok:src/Next.java", "jar"]);
});
