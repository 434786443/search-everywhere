import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { WasmFileSearch } from "../search/wasmFileSearch";
import { parseFileQuery } from "../query/fileQuery";
import { keyFor, makeEntries } from "../workspace/fileIndex";

const vendor = path.join(__dirname, "..", "..", "vendor", "wasm");

const tree: Record<string, string[]> = {
  "/repo": [
    "src/main.rs",
    "docs/maintenance.md",
    "src/order/OrderController.java",
    "src/other/OtherCollection.ts",
    "src/ui/Button.tsx",
    "src/gen0.java",
    "src/gen1.java",
    "src/lib0.xml",
    "pom.xml",
  ],
};

test("a query flows from input parsing through the wasm matcher", async () => {
  const search = await WasmFileSearch.load(vendor, () => {});
  search.setFiles(makeEntries([{ name: "repo", fsPath: "/repo" }], new Map(Object.entries(tree))));

  const query = parseFileQuery("ui/btn");
  assert.equal(query.text, "ui/btn");
  const found = search.find(query.text, 10, query.extensions);
  assert.equal(found.hits[0]?.rel, "src/ui/Button.tsx");

  const listed = search.listByExtension([".xml"], 10);
  assert.deepEqual(listed.hits.map((hit) => hit.rel).sort(), ["pom.xml", "src/lib0.xml"]);

  const camel = search.find("OCo", 5, []);
  assert.ok(camel.hits.some((hit) => hit.rel === "src/order/OrderController.java"));
});

test("a position suffix survives the round trip without affecting matching", async () => {
  const search = await WasmFileSearch.load(vendor, () => {});
  search.setFiles(makeEntries([{ name: "repo", fsPath: "/repo" }], new Map(Object.entries(tree))));
  const query = parseFileQuery("Button.tsx:12", ["/repo"]);
  assert.equal(query.line, 12);
  const found = search.find(query.text, 10, query.extensions);
  assert.equal(found.hits[0]?.rel, "src/ui/Button.tsx");
});

test("recents drive the empty query and drop deleted files", async () => {
  const search = await WasmFileSearch.load(vendor, () => {});
  const folders = [{ name: "repo", fsPath: "/repo" }];
  search.setFiles(makeEntries(folders, new Map(Object.entries(tree))));
  const key = keyFor(folders[0]!, "src/main.rs", true);
  search.setRecents([key]);
  assert.deepEqual(search.find("", 10, []).hits.map((hit) => hit.rel), [key]);

  search.removeFiles([key]);
  assert.equal(search.find("", 10, []).total, 0);
});

test("multiple folders stay distinguishable through the matcher", async () => {
  const search = await WasmFileSearch.load(vendor, () => {});
  const folders = [
    { name: "app", fsPath: "/code/app" },
    { name: "lib", fsPath: "/code/lib" },
  ];
  search.setFiles(makeEntries(folders, new Map([
    ["/code/app", ["src/A.java"]],
    ["/code/lib", ["src/A.java"]],
  ])));
  const hits = search.find("A.java", 10, []);
  assert.deepEqual(hits.hits.map((hit) => hit.rel).sort(), ["app/src/A.java", "lib/src/A.java"]);
});
