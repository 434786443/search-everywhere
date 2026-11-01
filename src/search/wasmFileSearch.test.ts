import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { WasmFileSearch } from "./wasmFileSearch";

const vendor = path.join(__dirname, "..", "..", "vendor", "wasm");

test("missing wasm leaves the search unavailable", async () => {
  const search = await WasmFileSearch.load("/nonexistent/wasm", () => {});
  assert.equal(search.available, false);
  assert.deepEqual(search.find("a", 10, []).hits, []);
});

test("files and recents round-trip through the wasm module", async () => {
  const search = await WasmFileSearch.load(vendor, () => {});
  assert.equal(search.available, true);
  search.setFiles([
    { key: "src/A.java", rel: "src/A.java", library: false },
    { key: "src/B.xml", rel: "src/B.xml", library: false },
  ]);
  search.setRecents(["src/A.java"]);
  assert.equal(search.find("A", 10, [])?.hits[0]?.key, "src/A.java");
  assert.deepEqual(search.listByExtension([".xml"], 10).hits.map(hit => hit.rel), ["src/B.xml"]);
  search.removeFiles(["src/A.java"]);
  assert.equal(search.find("A", 10, []).total, 0);
});

test("a throwing module marks the search unavailable after the first failure", async () => {
  const search = await WasmFileSearch.load(vendor, () => {});
  search.setFiles([{ key: "a", rel: "a", library: false }]);
  (search as unknown as { module: { findFiles: () => string } }).module.findFiles = () => {
    throw new Error("boom");
  };
  assert.deepEqual(search.find("a", 10, []).hits, []);
  assert.equal(search.available, false);
});
