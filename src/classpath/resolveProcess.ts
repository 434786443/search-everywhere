import { spawn } from "node:child_process";

export interface ToolResult { timedOut: boolean; code: number | null; stdout: string; stderr: string; }

export function runTool(input: { cwd: string; command: string; args: string[]; timeoutMs: number }): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, { cwd: input.cwd });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, input.timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ timedOut, code: null, stdout, stderr: stderr + error.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ timedOut, code, stdout, stderr }); });
  });
}

export function resolveFailed(result: { timedOut: boolean; code: number | null }): boolean {
  return result.timedOut || result.code !== 0;
}
