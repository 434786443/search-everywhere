import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

export interface ToolResult { timedOut: boolean; code: number | null; stdout: string; stderr: string; }

const WINDOWS_CMD_META = /[ "|&<>^]/;

export function quoteWindowsArg(argument: string): string {
  if (!WINDOWS_CMD_META.test(argument)) return argument;
  return `"${argument.replaceAll('"', '""')}"`;
}

export function windowsCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(quoteWindowsArg).join(" ");
}

export function commandNeedsShell(command: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" && /\.(?:cmd|bat)$/i.test(path.basename(command));
}

function startTool(input: { cwd: string; command: string; args: string[] }): ChildProcess {
  if (!commandNeedsShell(input.command)) return spawn(input.command, input.args, { cwd: input.cwd });
  const commandLine = `"${windowsCommandLine(input.command, input.args)}"`;
  return spawn(process.env.comspec || "cmd.exe", ["/d", "/s", "/c", commandLine], {
    cwd: input.cwd,
    windowsVerbatimArguments: true,
  });
}

function killTool(child: ChildProcess): void {
  if (process.platform !== "win32") {
    child.kill("SIGKILL");
    return;
  }
  if (child.pid === undefined) return;
  const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  killer.on("error", () => {});
}

export function runTool(input: { cwd: string; command: string; args: string[]; timeoutMs: number }): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = startTool(input);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTool(child); }, input.timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ timedOut, code: null, stdout, stderr: stderr + error.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ timedOut, code, stdout, stderr }); });
  });
}

export function resolveFailed(result: { timedOut: boolean; code: number | null }): boolean {
  return result.timedOut || result.code !== 0;
}
