import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFailed, runTool } from "./resolveProcess";

test("timeout marks the run failed", async () => {
  const result = await runTool({ cwd: process.cwd(), command: process.execPath, args: ["-e", "setTimeout(() => {}, 10000)"], timeoutMs: 200 });
  assert.equal(result.timedOut, true);
  assert.equal(resolveFailed(result), true);
});
