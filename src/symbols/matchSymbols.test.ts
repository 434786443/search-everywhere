import { test } from "node:test";
import assert from "node:assert/strict";
import { matchDependencyClasses, matchWorkspaceSymbols } from "./matchSymbols";

test("extension-only query skips workspace symbols and keeps dependency classes", () => {
  const query = { terms: [], extensions: [".java"] };
  const workspace = matchWorkspaceSymbols([
    { name: "User", detail: "src/User.java", uri: "file:///src/User.java", line: 1, extension: ".java" },
  ], query);
  const classes = matchDependencyClasses([
    { simpleName: "User", detail: "com.example.User", jarPath: "/repo/a.jar", jarName: "a.jar", entry: "com/example/User.class" },
  ], query);
  assert.equal(workspace.length, 0);
  assert.equal(classes.length, 1);
  assert.equal(classes[0].treatAsJava, true);
  assert.equal(classes[0].source.jarName, "a.jar");
});
