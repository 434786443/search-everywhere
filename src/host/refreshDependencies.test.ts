import { test } from "node:test";
import assert from "node:assert/strict";
import { gradleArgs, mavenArgs } from "../classpath/parseClasspath";
import { ToolResult } from "../classpath/resolveProcess";
import { IndexedJar } from "../jar/indexJar";
import { FILE_TEXT_CAP, JAR_TEXT_CAP, RESOLVE_TIMEOUT_MS } from "../limits";
import { statusText } from "../status/statusText";
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

test("reuses sources only when that jar is unchanged", async () => {
  const sourcesZip = storedZip([
    { name: "com/example/A.java", data: Buffer.from("class A { int longer; }"), method: 0 },
  ]);
  const reads: string[] = [];
  const statOf = (sourcesMtime: number) => (filePath: string) => {
    if (filePath === "/repo/a.jar") return { mtimeMs: 1, size: 10 };
    if (filePath === "/repo/a-sources.jar") return { mtimeMs: sourcesMtime, size: 20 };
    return undefined;
  };
  const input = baseInput({
    exists: (filePath) => filePath === "/app/pom.xml" || filePath === "/repo/a.jar" || filePath === "/repo/a-sources.jar",
    which: (command) => command === "mvn",
    stat: statOf(2),
    readFile: (filePath) => {
      reads.push(filePath);
      if (filePath === "/repo/a.jar") return ZIP;
      if (filePath === "/repo/a-sources.jar") return sourcesZip;
      return undefined;
    },
    run: async () => ok("/repo/a.jar"),
    fileTextCap: 4,
  });
  const first = await refreshDependencyIndex(input);
  const java = first.jars[0].texts.find(item => item.entry === "com/example/A.java");
  assert.equal(java?.text, "clas");
  assert.equal(java?.truncated, true);
  assert.equal(first.jars[0].paths.some(item => item.entry === "com/example/A.java" && item.truncated), true);
  assert.deepEqual(first.jars[0].sources, { jarPath: "/repo/a-sources.jar", mtimeMs: 2, size: 20 });
  const afterFirst = reads.length;
  const second = await refreshDependencyIndex({ ...input, previous: first.jars });
  assert.equal(reads.length, afterFirst);
  assert.equal(second.unreadableCount, 0);

  const changedReads: string[] = [];
  const changed = await refreshDependencyIndex({
    ...input,
    previous: second.jars,
    stat: statOf(9),
    readFile: (filePath) => {
      changedReads.push(filePath);
      if (filePath === "/repo/a.jar") return ZIP;
      if (filePath === "/repo/a-sources.jar") return sourcesZip;
      return undefined;
    },
  });
  assert.ok(changedReads.includes("/repo/a-sources.jar"));
  assert.equal(changed.jars[0].sources?.mtimeMs, 9);
});

test("reuses the previous unreadable sources count when the sources jar is unchanged", async () => {
  const input = baseInput({
    exists: (filePath) => filePath === "/app/pom.xml" || filePath === "/repo/a.jar" || filePath === "/repo/a-sources.jar",
    which: (command) => command === "mvn",
    stat: (filePath) => filePath === "/repo/a.jar" || filePath === "/repo/a-sources.jar" ? { mtimeMs: 8, size: 9 } : undefined,
    readFile: (filePath) => filePath === "/repo/a.jar" ? ZIP : Buffer.from("not a zip"),
    run: async () => ok("/repo/a.jar"),
  });
  const first = await refreshDependencyIndex(input);
  assert.equal(first.unreadableCount, 1);
  let reads = 0;
  const second = await refreshDependencyIndex({
    ...input,
    previous: first.jars,
    readFile: () => {
      reads += 1;
      return Buffer.from("not a zip");
    },
  });
  assert.equal(reads, 0);
  assert.equal(second.unreadableCount, 1);
});

test("resolves a nested module and skips children of a reactor", async () => {
  const calls: string[] = [];
  const outcome = await refreshDependencyIndex(baseInput({
    buildFiles: ["/app/pom.xml", "/app/child/pom.xml", "/app/other/pom.xml", "/side/pom.xml"],
    exists: (filePath) => filePath.endsWith("/pom.xml") || filePath === "/repo/root.jar" || filePath === "/repo/side.jar",
    which: (command) => command === "mvn",
    stat: (filePath) => filePath.endsWith(".jar") ? { mtimeMs: 1, size: ZIP.length } : undefined,
    readFile: (filePath) => {
      if (filePath === "/app/pom.xml") return Buffer.from("<project><modules><module>child</module></modules></project>");
      if (filePath === "/repo/root.jar" || filePath === "/repo/side.jar") return ZIP;
      return undefined;
    },
    run: async (call) => {
      calls.push(call.cwd);
      if (call.cwd === "/side") return ok("/repo/side.jar");
      return ok("/repo/root.jar");
    },
  }));
  assert.deepEqual(calls.sort(), ["/app", "/side"]);
  assert.deepEqual(outcome.jars.map(jar => jar.jarPath).sort(), ["/repo/root.jar", "/repo/side.jar"]);
});

test("does not resolve the same module directory twice", async () => {
  const calls: string[] = [];
  await refreshDependencyIndex(baseInput({
    buildFiles: ["/app/pom.xml", "/app/pom.xml", "/app/build.gradle"],
    exists: (filePath) => filePath === "/app/pom.xml" || filePath === "/app/build.gradle",
    which: (command) => command === "mvn" || command === "gradle",
    run: async (call) => {
      calls.push(call.command);
      return ok("");
    },
  }));
  assert.deepEqual(calls.sort(), ["gradle", "mvn"]);
});

test("a gradle allprojects root covers nested gradle builds", async () => {
  const calls: string[] = [];
  await refreshDependencyIndex(baseInput({
    buildFiles: ["/app/build.gradle", "/app/child/build.gradle"],
    exists: (filePath) => filePath === "/app/build.gradle" || filePath === "/app/child/build.gradle",
    which: (command) => command === "gradle",
    readFile: (filePath) => filePath === "/app/build.gradle" ? Buffer.from("allprojects { }\n") : undefined,
    run: async (call) => {
      calls.push(call.cwd);
      return ok("");
    },
  }));
  assert.deepEqual(calls, ["/app"]);
});

test("uses mvnw.cmd and gradlew.bat when the shell wrappers are absent", async () => {
  const maven = await refreshDependencyIndex(baseInput({
    exists: (filePath) => filePath === "/app/pom.xml" || filePath === "/app/mvnw.cmd",
    which: () => false,
    run: async (call) => ok(call.command),
  }));
  assert.match(maven.log, /^$/);
  const commands: string[] = [];
  await refreshDependencyIndex(baseInput({
    exists: (filePath) => filePath === "/app/pom.xml" || filePath === "/app/mvnw.cmd" || filePath === "/app/build.gradle" || filePath === "/app/gradlew.bat",
    which: () => false,
    run: async (call) => {
      commands.push(call.command);
      return ok("");
    },
  }));
  assert.deepEqual(commands.sort(), ["/app/gradlew.bat", "/app/mvnw.cmd"]);
});

test("keeps previous jars for a failed module and uses the existing failure status", async () => {
  const previous = [{ ...emptyJar("/repo/old.jar"), moduleRoots: ["/bad"] }];
  const outcome = await refreshDependencyIndex(baseInput({
    previous,
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
  assert.equal(outcome.failed, true);
  assert.equal(outcome.hasPreviousIndex, true);
  assert.deepEqual(outcome.jars.map(jar => jar.jarPath).sort(), ["/repo/ok.jar", "/repo/old.jar"]);
  assert.match(outcome.log, /timed out/);
  assert.equal(statusText({
    hasFolder: true,
    updating: false,
    failed: outcome.failed,
    hasPreviousIndex: outcome.hasPreviousIndex,
    unreadableCount: outcome.unreadableCount,
  }), "依赖解析失败，仍使用上一份索引");
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
