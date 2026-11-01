import { test } from "node:test";
import assert from "node:assert/strict";
import { rankHits } from "./rankHits";
import { SearchHit } from "../types";

function hit(partial: Partial<SearchHit> & Pick<SearchHit, "id" | "kind" | "title">): SearchHit {
  return {
    detail: partial.title,
    source: { type: "workspace" },
    extension: ".java",
    stableIndex: 0,
    ...partial,
  };
}

test("exact file name beats prefix", () => {
  const ranked = rankHits([
    hit({ id: "prefix", kind: "file", title: "UserService.java", stableIndex: 0 }),
    hit({ id: "exact", kind: "file", title: "User.java", stableIndex: 1 }),
  ], { terms: ["User"], extensions: [] });
  assert.deepEqual(ranked.map(item => item.id), ["exact", "prefix"]);
});

test("workspace beats jar at the same tier", () => {
  const ranked = rankHits([
    hit({ id: "jar", kind: "file", title: "User.java", source: { type: "jar", jarName: "a.jar" }, stableIndex: 0 }),
    hit({ id: "ws", kind: "file", title: "User.java", stableIndex: 1 }),
  ], { terms: ["User"], extensions: [] });
  assert.deepEqual(ranked.map(item => item.id), ["ws", "jar"]);
});

test("java filter keeps source files and dependency classes", () => {
  const ranked = rankHits([
    hit({ id: "xml", kind: "file", title: "User.xml", extension: ".xml" }),
    hit({ id: "class", kind: "symbol", title: "User", extension: ".class", treatAsJava: true, source: { type: "jar" } }),
    hit({ id: "java", kind: "file", title: "User.java", extension: ".java" }),
  ], { terms: ["User"], extensions: [".java"] });
  assert.deepEqual(ranked.map(item => item.id), ["java", "class"]);
});

test("class filter matches class paths only", () => {
  const ranked = rankHits([
    hit({ id: "java", kind: "file", title: "User.java", extension: ".java" }),
    hit({ id: "class", kind: "symbol", title: "User", extension: ".class", treatAsJava: true }),
  ], { terms: ["User"], extensions: [".class"] });
  assert.deepEqual(ranked.map(item => item.id), ["class"]);
});

test("extension filter removes commands", () => {
  const ranked = rankHits([
    hit({ id: "cmd", kind: "command", title: "User", extension: "", detail: "user.command" }),
  ], { terms: ["User"], extensions: [".java"] });
  assert.deepEqual(ranked, []);
});

test("multiple terms have no exact tier", () => {
  const ranked = rankHits([
    hit({ id: "loose", kind: "file", title: "xxUserYYService.java", stableIndex: 0 }),
    hit({ id: "joined", kind: "file", title: "UserService.java", stableIndex: 1 }),
  ], { terms: ["User", "Service"], extensions: [] });
  assert.deepEqual(ranked.map(item => item.id), ["loose", "joined"]);
});
