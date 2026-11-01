import { test } from "node:test";
import assert from "node:assert/strict";
import { gradleArgs, mavenArgs } from "../classpath/parseClasspath";
import { ToolResult } from "../classpath/resolveProcess";
import { IndexedJar } from "../jar/indexJar";
import { FILE_TEXT_CAP, JAR_TEXT_CAP, RESOLVE_TIMEOUT_MS } from "../limits";
import { refreshDependencyIndex, RefreshInput } from "./refreshDependencies";

const ZIP = storedZip([
  { name: "readme.txt", data: Buffer.from("hello"), method: 0 },
]);

test("indexes a readable maven jar, counts a missing jar, and skips a reread", async () => {
  let reads = 0;
  const calls: Parameters<RefreshInput["run"]>[0][] = [];
  const input = baseInput({
    exists: (filePath) => filePath === "/app/pom.xml" || filePath === "/repo/a.jar" || filePath === "/repo/a-sources.jar",
    which: (command) => command === "mvn",
    stat: (filePath) => filePath === "/repo/a.jar" ? { mtimeMs: 42, size: 12345 } : undefined,
    readFile: (filePath) => {
      reads += 1;
      return filePath === "/repo/a.jar" ? ZIP : undefined;
    },
    run: async (call) => {
      calls.push(call);
      return ok("/repo/a.jar|/missing.jar");
    },
  });

  const first = await refreshDependencyIndex(input);
  assert.equal(first.failed, false);
  assert.equal(first.jars.length, 1);
  assert.equal(first.jars[0].jarPath, "/repo/a.jar");
  assert.equal(first.jars[0].mtimeMs, 42);
  assert.equal(first.jars[0].size, 12345);
  assert.equal(first.unreadableCount, 1);
  assert.match(first.log, /\/missing\.jar/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, "/app");
  assert.equal(calls[0].command, "mvn");
  assert.deepEqual(calls[0].args, mavenArgs());
  assert.equal(calls[0].timeoutMs, RESOLVE_TIMEOUT_MS);
  const readsAfterFirst = reads;
  assert.ok(readsAfterFirst >= 1);

  const second = await refreshDependencyIndex({ ...input, previous: first.jars });
  assert.equal(second.failed, false);
  assert.equal(second.jars.length, 1);
  assert.equal(second.jars[0].jarPath, "/repo/a.jar");
  assert.equal(reads, readsAfterFirst);
});

test("keeps the previous index when resolve times out", async () => {
  const previous = [emptyJar("/repo/old.jar")];
  const outcome = await refreshDependencyIndex(baseInput({
    previous,
    exists: (filePath) => filePath === "/app/pom.xml",
    which: (command) => command === "mvn",
    run: async () => ({ timedOut: true, code: null, stdout: "", stderr: "" }),
  }));
  assert.equal(outcome.failed, true);
  assert.deepEqual(outcome.jars, previous);
  assert.equal(outcome.hasPreviousIndex, true);
});

test("fails when mvn is missing and mvnw does not exist", async () => {
  let runs = 0;
  const outcome = await refreshDependencyIndex(baseInput({
    exists: (filePath) => filePath === "/app/pom.xml",
    which: () => false,
    run: async () => {
      runs += 1;
      return ok("");
    },
  }));
  assert.equal(runs, 0);
  assert.equal(outcome.failed, true);
  assert.match(outcome.log, /mvn/);
  assert.deepEqual(outcome.jars, []);
});

test("uses mvnw instead of mvn on PATH", async () => {
  const calls: string[] = [];
  const outcome = await refreshDependencyIndex(baseInput({
    exists: (filePath) => filePath === "/app/pom.xml" || filePath === "/app/mvnw" || filePath === "/repo/a.jar",
    which: () => false,
    stat: (filePath) => filePath === "/repo/a.jar" ? { mtimeMs: 1, size: ZIP.length } : undefined,
    readFile: (filePath) => filePath === "/repo/a.jar" ? ZIP : undefined,
    run: async (call) => {
      calls.push(call.command);
      return ok("/repo/a.jar");
    },
  }));
  assert.deepEqual(calls, ["/app/mvnw"]);
  assert.equal(outcome.failed, false);
  assert.equal(outcome.jars.length, 1);
});

test("runs gradle for settings.gradle.kts and for gradlew", async () => {
  const commands: string[] = [];
  const withSettings = await refreshDependencyIndex(baseInput({
    exists: (filePath) => filePath === "/app/settings.gradle.kts" || filePath === "/repo/a.jar",
    which: (command) => command === "gradle",
    stat: (filePath) => filePath === "/repo/a.jar" ? { mtimeMs: 3, size: ZIP.length } : undefined,
    readFile: (filePath) => filePath === "/repo/a.jar" ? ZIP : undefined,
    run: async (call) => {
      commands.push(call.command);
      assert.deepEqual(call.args, gradleArgs("/ext/init.gradle"));
      assert.equal(call.timeoutMs, RESOLVE_TIMEOUT_MS);
      return ok("JAR\t/repo/a.jar\n");
    },
  }));
  assert.deepEqual(commands, ["gradle"]);
  assert.equal(withSettings.failed, false);
  assert.equal(withSettings.jars[0].jarPath, "/repo/a.jar");

  const wrapperCommands: string[] = [];
  const withWrapper = await refreshDependencyIndex(baseInput({
    exists: (filePath) => filePath === "/app/build.gradle" || filePath === "/app/gradlew" || filePath === "/repo/a.jar",
    which: () => false,
    stat: (filePath) => filePath === "/repo/a.jar" ? { mtimeMs: 4, size: ZIP.length } : undefined,
    readFile: (filePath) => filePath === "/repo/a.jar" ? ZIP : undefined,
    run: async (call) => {
      wrapperCommands.push(call.command);
      return ok("JAR\t/repo/a.jar\n");
    },
  }));
  assert.deepEqual(wrapperCommands, ["/app/gradlew"]);
  assert.equal(withWrapper.failed, false);
});

test("indexes jars from a root that resolved when another root times out", async () => {
  const outcome = await refreshDependencyIndex(baseInput({
    workspaceRoots: ["/ok", "/bad"],
    exists: (filePath) => filePath === "/ok/pom.xml" || filePath === "/bad/pom.xml" || filePath === "/repo/ok.jar",
    which: (command) => command === "mvn",
    stat: (filePath) => filePath === "/repo/ok.jar" ? { mtimeMs: 7, size: ZIP.length } : undefined,
    readFile: (filePath) => filePath === "/repo/ok.jar" ? ZIP : undefined,
    run: async (call) => {
      if (call.cwd === "/bad") return { timedOut: true, code: null, stdout: "", stderr: "" };
      return ok("/repo/ok.jar");
    },
  }));
  assert.equal(outcome.failed, false);
  assert.equal(outcome.jars.length, 1);
  assert.equal(outcome.jars[0].jarPath, "/repo/ok.jar");
  assert.match(outcome.log, /timed out/);
});

test("keeps gradle jars when maven on the same root times out", async () => {
  const outcome = await refreshDependencyIndex(baseInput({
    exists: (filePath) => filePath === "/app/pom.xml" || filePath === "/app/build.gradle" || filePath === "/repo/ok.jar",
    which: (command) => command === "mvn" || command === "gradle",
    stat: (filePath) => filePath === "/repo/ok.jar" ? { mtimeMs: 9, size: ZIP.length } : undefined,
    readFile: (filePath) => filePath === "/repo/ok.jar" ? ZIP : undefined,
    run: async (call) => {
      if (call.command === "mvn") return { timedOut: true, code: null, stdout: "", stderr: "" };
      return ok("JAR\t/repo/ok.jar\n");
    },
  }));
  assert.equal(outcome.failed, false);
  assert.equal(outcome.jars.length, 1);
  assert.equal(outcome.jars[0].jarPath, "/repo/ok.jar");
  assert.match(outcome.log, /timed out/);
});

test("counts an unreadable sources jar and keeps the binary jar", async () => {
  const outcome = await refreshDependencyIndex(baseInput({
    exists: (filePath) => filePath === "/app/pom.xml" || filePath === "/repo/a.jar" || filePath === "/repo/a-sources.jar",
    which: (command) => command === "mvn",
    stat: (filePath) => filePath === "/repo/a.jar" || filePath === "/repo/a-sources.jar" ? { mtimeMs: 8, size: 9 } : undefined,
    readFile: (filePath) => filePath === "/repo/a.jar" ? ZIP : Buffer.from("not a zip"),
    run: async () => ok("/repo/a.jar"),
  }));
  assert.equal(outcome.failed, false);
  assert.equal(outcome.jars.length, 1);
  assert.equal(outcome.jars[0].jarPath, "/repo/a.jar");
  assert.equal(outcome.unreadableCount, 1);
  assert.match(outcome.log, /\/repo\/a-sources\.jar/);
});

test("counts a jar that cannot be unzipped and still indexes the next one", async () => {
  const outcome = await refreshDependencyIndex(baseInput({
    exists: (filePath) => filePath === "/app/pom.xml" || filePath === "/repo/bad.jar" || filePath === "/repo/a.jar",
    which: (command) => command === "mvn",
    stat: (filePath) => filePath === "/repo/bad.jar" || filePath === "/repo/a.jar" ? { mtimeMs: 5, size: 9 } : undefined,
    readFile: (filePath) => filePath === "/repo/a.jar" ? ZIP : Buffer.from("not a zip"),
    run: async () => ok("/repo/bad.jar|/repo/a.jar"),
  }));
  assert.equal(outcome.failed, false);
  assert.equal(outcome.unreadableCount, 1);
  assert.equal(outcome.jars.length, 1);
  assert.equal(outcome.jars[0].jarPath, "/repo/a.jar");
  assert.match(outcome.log, /\/repo\/bad\.jar/);
  assert.match(outcome.log, /eocd/);
});

function ok(stdout: string): ToolResult {
  return { timedOut: false, code: 0, stdout, stderr: "" };
}

function emptyJar(jarPath: string): IndexedJar {
  return { jarPath, mtimeMs: 1, size: 2, classes: [], texts: [], paths: [] };
}

function baseInput(partial: Partial<RefreshInput> & Pick<RefreshInput, "exists" | "which" | "run">): RefreshInput {
  return {
    workspaceRoots: ["/app"],
    previous: [],
    readFile: () => undefined,
    stat: () => undefined,
    initScriptPath: "/ext/init.gradle",
    fileTextCap: FILE_TEXT_CAP,
    jarTextCap: JAR_TEXT_CAP,
    ...partial,
  };
}

function storedZip(files: { name: string; data: Buffer; method: 0 | 8 }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const stored = file.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(file.method, 8);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const chunk = Buffer.concat([local, name, stored]);
    locals.push(chunk);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(file.method, 10);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += chunk.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}
