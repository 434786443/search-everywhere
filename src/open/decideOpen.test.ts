import { test } from "node:test";
import assert from "node:assert/strict";
import { decideOpen } from "./decideOpen";
import { SearchHit } from "../types";

function base(partial: Partial<SearchHit>): SearchHit {
  return { id: "1", kind: "file", title: "A", detail: "A", source: { type: "workspace" }, extension: ".java", stableIndex: 0, ...partial };
}

test("open decisions", () => {
  assert.deepEqual(decideOpen({ hit: base({ kind: "content", uri: "file:///src/A.java", line: 4 }) }), { type: "workspace", uri: "file:///src/A.java", line: 4 });
  assert.deepEqual(decideOpen({
    hit: base({ kind: "symbol", title: "Inner", source: { type: "jar", jarPath: "/a.jar" }, entry: "com/foo/Outer$Inner.class" }),
    sourcesJarPath: "/a-sources.jar",
    sourceText: "public class Outer {\n  class Inner {}\n",
  }), { type: "jar-text", jarPath: "/a-sources.jar", entry: "com/foo/Outer.java", line: 2 });
  assert.deepEqual(decideOpen({ hit: base({ kind: "symbol", source: { type: "jar", jarPath: "/a.jar" }, entry: "com/foo/User.class" }) }), { type: "declaration", jarPath: "/a.jar", entry: "com/foo/User.class" });
  assert.deepEqual(decideOpen({ hit: base({ kind: "command", detail: "workbench.action.quickOpen" }) }), { type: "command", commandId: "workbench.action.quickOpen" });
  const annotation = decideOpen({
    hit: base({ kind: "symbol", title: "@Service", annotation: true, source: { type: "jar", jarPath: "/a.jar" }, entry: "org/Service.class" }),
    sourcesJarPath: "/a-sources.jar",
    sourceText: "public @interface Service {}\n",
  });
  assert.equal(annotation.type, "jar-text");
  if (annotation.type === "jar-text") assert.equal(annotation.line, 1);
});
