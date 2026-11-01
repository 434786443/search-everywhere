import { test } from "node:test";
import assert from "node:assert/strict";
import { matchFiles } from "./matchFiles";

test("extension-only query lists file names and skips content fields", () => {
  const hits = matchFiles([
    { relativePath: "src/User.java", uri: "file:///src/User.java" },
    { relativePath: "src/App.xml", uri: "file:///src/App.xml" },
  ], { terms: [], extensions: [".java"] });
  assert.deepEqual(hits.map(hit => hit.title), ["User.java"]);
  assert.equal(hits[0].kind, "file");
  assert.equal(hits[0].line, undefined);
});
