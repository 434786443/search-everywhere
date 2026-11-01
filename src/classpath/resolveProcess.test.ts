import { test } from "node:test";
import assert from "node:assert/strict";
import { commandNeedsShell, resolveFailed, runTool } from "./resolveProcess";

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
