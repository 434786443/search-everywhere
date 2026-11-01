import { test } from "node:test";
import assert from "node:assert/strict";
import { coordinate, SearchProvider } from "./coordinator";
import { SearchHit, SearchQuery } from "../types";

function file(id: string, index: number): SearchHit {
  return { id, kind: "file", title: `F${id}.java`, detail: `src/F${id}.java`, source: { type: "workspace" }, extension: ".java", stableIndex: index };
}

function provider(hits: SearchHit[] | Error): SearchProvider {
  return { search: async () => { if (hits instanceof Error) throw hits; return hits; } };
}

const query: SearchQuery = { terms: ["F"], extensions: [] };

test("empty input does not call providers", async () => {
  const bomb: SearchProvider = { search: async () => { throw new Error("called"); } };
  const result = await coordinate({
    query: { terms: [], extensions: [] },
    tab: "all",
    includeContent: true,
    isStale: () => false,
    providers: { files: bomb, symbols: bomb, commands: bomb, content: bomb },
  });
  assert.equal(result.files.hits.length, 0);
  assert.equal(result.stale, false);
});

test("all tab caps each group at 8", async () => {
  const files = Array.from({ length: 9 }, (_, index) => file(String(index), index));
  const result = await coordinate({
    query, tab: "all", includeContent: false, isStale: () => false,
    providers: { files: provider(files), symbols: provider([]), commands: provider([]), content: provider([]) },
  });
  assert.equal(result.files.hits.length, 8);
  assert.equal(result.files.truncated, true);
});

test("files tab caps at 100 and keeps workspace content first", async () => {
  const content: SearchHit[] = [
    { id: "jar", kind: "content", title: "A.java", detail: "jar", source: { type: "jar", jarName: "a.jar" }, extension: ".java", preview: "F", stableIndex: 0 },
    { id: "ws", kind: "content", title: "A.java", detail: "src/A.java", source: { type: "workspace" }, extension: ".java", preview: "F", stableIndex: 1 },
  ];
  const result = await coordinate({
    query, tab: "files", includeContent: true, isStale: () => false,
    providers: { files: provider([]), symbols: provider([]), commands: provider([]), content: provider(content) },
  });
  assert.deepEqual(result.content.hits.map(item => item.id), ["ws", "jar"]);
});

test("content failure keeps file hits", async () => {
  const result = await coordinate({
    query, tab: "all", includeContent: true, isStale: () => false,
    providers: { files: provider([file("1", 0)]), symbols: provider([]), commands: provider([]), content: provider(new Error("rg")) },
  });
  assert.equal(result.files.hits.length, 1);
  assert.equal(result.contentFailed, true);
  assert.equal(result.content.hits.length, 0);
});

test("extension mask skips the command provider", async () => {
  let called = false;
  const commands: SearchProvider = { search: async () => { called = true; return []; } };
  await coordinate({
    query: { terms: ["User"], extensions: [".java"] },
    tab: "all", includeContent: false, isStale: () => false,
    providers: { files: provider([]), symbols: provider([]), commands, content: provider([]) },
  });
  assert.equal(called, false);
});

test("stale generation is flagged", async () => {
  const result = await coordinate({
    query, tab: "all", includeContent: false, isStale: () => true,
    providers: { files: provider([file("1", 0)]), symbols: provider([]), commands: provider([]), content: provider([]) },
  });
  assert.equal(result.stale, true);
});
