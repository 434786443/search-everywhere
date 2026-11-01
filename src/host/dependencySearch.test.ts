import assert from "node:assert/strict";
import { test } from "node:test";
import { IndexedJar } from "../jar/indexJar";
import { dependencyContentHits, dependencyFileHits, dependencySymbolHits } from "./dependencySearch";

function exampleJar(): IndexedJar {
  return {
    jarPath: "/libs/app.jar",
    mtimeMs: 1,
    size: 2,
    classes: [{
      entry: "com/example/User.class",
      simpleName: "User",
      binaryName: "com.example.User",
      declaration: "class User",
      signaturesFailed: false,
    }],
    texts: [{ entry: "meta/app.xml", text: "<app>User</app>", truncated: false }],
    paths: [
      { entry: "com/example/User.class", truncated: false },
      { entry: "meta/app.xml", truncated: false },
    ],
  };
}

test("term query returns dependency symbol and content hits", () => {
  const jars = [exampleJar()];
  const query = { terms: ["User"], extensions: [] as string[] };
  const symbols = dependencySymbolHits(jars, query);
  const content = dependencyContentHits(jars, query);

  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].id, "jar-class:/libs/app.jar!com/example/User.class");
  assert.equal(symbols[0].kind, "symbol");
  assert.equal(symbols[0].title, "User");
  assert.equal(symbols[0].detail, "com.example.User");
  assert.equal(symbols[0].extension, ".class");
  assert.equal(symbols[0].treatAsJava, true);
  assert.equal(symbols[0].source.type, "jar");
  assert.equal(symbols[0].source.jarPath, "/libs/app.jar");
  assert.equal(symbols[0].source.jarName, "app.jar");
  assert.equal(symbols[0].entry, "com/example/User.class");

  assert.equal(content.length, 1);
  assert.equal(content[0].id, "jar-content:/libs/app.jar!meta/app.xml:1");
  assert.equal(content[0].kind, "content");
  assert.equal(content[0].title, "app.xml");
  assert.equal(content[0].detail, "meta/app.xml");
  assert.equal(content[0].preview, "<app>User</app>");
  assert.equal(content[0].line, 1);
  assert.equal(content[0].extension, ".xml");
  assert.ok(!content[0].textTruncated);
  assert.equal(content[0].source.jarName, "app.jar");
  assert.equal(content[0].source.jarPath, "/libs/app.jar");
});

test("extension-only query returns only matching dependency file names", () => {
  const jars = [exampleJar()];
  const query = { terms: [], extensions: [".xml"] };
  const files = dependencyFileHits(jars, query);

  assert.deepEqual(files.map(hit => hit.id), ["jar-file:/libs/app.jar!meta/app.xml"]);
  assert.equal(files[0].kind, "file");
  assert.equal(files[0].title, "app.xml");
  assert.equal(files[0].detail, "meta/app.xml");
  assert.equal(files[0].extension, ".xml");
  assert.equal(files[0].source.type, "jar");
  assert.equal(files[0].source.jarName, "app.jar");
  assert.ok(!files[0].treatAsJava);
  assert.deepEqual(dependencySymbolHits(jars, query), []);
  assert.deepEqual(dependencyContentHits(jars, query), []);
});

test("file hits include classes, texts, and path-only entries once", () => {
  const jar: IndexedJar = {
    jarPath: "/libs/app.jar",
    mtimeMs: 1,
    size: 1,
    classes: [{
      entry: "com/example/User.class",
      simpleName: "User",
      binaryName: "com.example.User",
      declaration: "",
      signaturesFailed: false,
    }],
    texts: [{ entry: "meta/app.xml", text: "<app>User</app>", truncated: false }],
    paths: [
      { entry: "com/example/User.class", truncated: false },
      { entry: "meta/app.xml", truncated: false },
      { entry: "assets/logo.png", truncated: true },
    ],
  };
  const hits = dependencyFileHits([jar], { terms: [], extensions: [] });

  assert.deepEqual(hits.map(hit => hit.detail), [
    "com/example/User.class",
    "meta/app.xml",
    "assets/logo.png",
  ]);
  assert.equal(hits[0].id, "jar-file:/libs/app.jar!com/example/User.class");
  assert.equal(hits[0].kind, "file");
  assert.equal(hits[0].title, "User.class");
  assert.equal(hits[0].extension, ".class");
  assert.ok(!hits[0].treatAsJava);
  assert.equal(hits[1].title, "app.xml");
  assert.equal(hits[1].extension, ".xml");
  assert.equal(hits[2].title, "logo.png");
  assert.equal(hits[2].extension, ".png");
  assert.equal(hits[2].textTruncated, true);
  assert.equal(hits[2].source.jarName, "app.jar");
});

test("content hits require every term on the same line", () => {
  const jar: IndexedJar = {
    jarPath: "/libs/app.jar",
    mtimeMs: 1,
    size: 1,
    classes: [],
    texts: [
      { entry: "meta/app.xml", text: "User\n<app>User</app>\nService", truncated: false },
      { entry: "meta/notes.txt", text: "see USER in the APP", truncated: true },
    ],
    paths: [],
  };
  const jars = [jar];
  const hits = dependencyContentHits(jars, { terms: ["user", "app"], extensions: [] });

  assert.deepEqual(hits.map(hit => hit.id), [
    "jar-content:/libs/app.jar!meta/app.xml:2",
    "jar-content:/libs/app.jar!meta/notes.txt:1",
  ]);
  assert.equal(hits[0].preview, "<app>User</app>");
  assert.equal(hits[0].line, 2);
  assert.equal(hits[0].extension, ".xml");
  assert.ok(!hits[0].textTruncated);
  assert.equal(hits[1].preview, "see USER in the APP");
  assert.equal(hits[1].line, 1);
  assert.equal(hits[1].title, "notes.txt");
  assert.equal(hits[1].detail, "meta/notes.txt");
  assert.equal(hits[1].extension, ".txt");
  assert.equal(hits[1].textTruncated, true);

  assert.deepEqual(dependencyContentHits(jars, { terms: ["User", "Service"], extensions: [] }), []);
  assert.deepEqual(dependencyContentHits(jars, { terms: [], extensions: [".xml"] }), []);
});

test("java extension filter keeps class symbols and skips class file names", () => {
  const jars = [exampleJar()];
  const query = { terms: [], extensions: [".java"] };
  const symbols = dependencySymbolHits(jars, query);

  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].treatAsJava, true);
  assert.equal(symbols[0].extension, ".class");
  assert.deepEqual(dependencyFileHits(jars, query), []);
});
