import { test } from "node:test";
import assert from "node:assert/strict";
import { classEntryToSourceEntry, classNameFromEntry, findDeclarationLine } from "./sourcePath";

test("inner class maps to the outer source file", () => {
  assert.equal(classEntryToSourceEntry("com/foo/Outer$Inner.class"), "com/foo/Outer.java");
  assert.deepEqual(classNameFromEntry("com/foo/Outer$Inner.class"), { simpleName: "Inner", binaryName: "com.foo.Outer$Inner" });
});

test("finds the first matching declaration", () => {
  const source = "public class Outer {\n  class Inner {}\n}\n";
  assert.equal(findDeclarationLine(source, "Inner"), 2);
  assert.equal(findDeclarationLine(source, "Missing"), undefined);
});
