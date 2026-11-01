import { test } from "node:test";
import assert from "node:assert/strict";
import { gradleArgs, mavenArgs } from "./parseClasspath";
import { commandNeedsShell, quoteWindowsArg, resolveFailed, runTool, windowsCommandLine } from "./resolveProcess";

test("timeout marks the run failed", async () => {
  const result = await runTool({ cwd: process.cwd(), command: process.execPath, args: ["-e", "setTimeout(() => {}, 10000)"], timeoutMs: 200 });
  assert.equal(result.timedOut, true);
  assert.equal(resolveFailed(result), true);
});

test("windows batch launchers need a shell", () => {
  assert.equal(commandNeedsShell("C:\\app\\mvnw.cmd", "win32"), true);
  assert.equal(commandNeedsShell("/app/gradlew.bat", "win32"), true);
  assert.equal(commandNeedsShell("/app/mvnw", "win32"), false);
  assert.equal(commandNeedsShell("/app/mvnw.cmd", "linux"), false);
});

test("windows command line keeps the maven separator and a spaced path", () => {
  const maven = windowsCommandLine("mvn.cmd", mavenArgs());
  assert.ok(maven.includes('"-Dmdep.pathSeparator=|"'));
  assert.equal(splitWindowsCommand(maven).at(-1), "-Dmdep.pathSeparator=|");
  const initScript = "C:\\Program Files\\init.gradle";
  assert.equal(quoteWindowsArg(initScript), `"${initScript}"`);
  const gradle = windowsCommandLine("gradle.bat", gradleArgs(initScript));
  assert.deepEqual(splitWindowsCommand(gradle), ["gradle.bat", "-q", "-I", initScript, "projects"]);
});

function splitWindowsCommand(commandLine: string): string[] {
  const args: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < commandLine.length; index++) {
    const ch = commandLine[index];
    if (ch === '"') {
      if (quoted && commandLine[index + 1] === '"') {
        current += '"';
        index++;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (ch === " " && !quoted) {
      args.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  args.push(current);
  return args;
}
