import * as vscode from "vscode";
import { rgPath } from "@vscode/ripgrep";
import { spawn } from "node:child_process";
import { CONTENT_DEBOUNCE_MS, EMPTY_HINT, TAB_CAP } from "./limits";
import { matchCommands } from "./commands/matchCommands";
import { coordinate, GroupedResults } from "./search/coordinator";
import { parseQuery } from "./query/parseQuery";
import { panelHtml } from "./panel/panelHtml";
import { matchWorkspaceSymbols } from "./symbols/matchSymbols";
import { SearchQuery, SearchTab } from "./types";
import { contentRgArgs, fileRgArgs, parseRgFiles, parseRgMatches, toRgExclude } from "./workspace/rg";
import { matchFiles } from "./workspace/matchFiles";

let current: vscode.WebviewPanel | undefined;
let generation = 0;
let contentTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("searchEverywhere.show", () => openPanel(context)));
  context.subscriptions.push(vscode.commands.registerCommand("searchEverywhere.refreshDependencies", () => undefined));
}

export function deactivate(): void { current?.dispose(); }

function openPanel(context: vscode.ExtensionContext): void {
  if (current) { current.reveal(vscode.ViewColumn.Active); return; }
  current = vscode.window.createWebviewPanel("searchEverywhere", "Search Everywhere", vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")] });
  const nonce = String(Date.now());
  const scriptUri = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "panel.js"));
  const styleUri = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "panel.css"));
  current.webview.html = panelHtml({ scriptUri: String(scriptUri), styleUri: String(styleUri), cspSource: current.webview.cspSource, nonce });
  current.onDidDispose(() => { current = undefined; });
  current.webview.onDidReceiveMessage(async (message) => {
    if (message.type === "close") current?.dispose();
    if (message.type === "query") schedule(message.text, message.tab);
    if (message.type === "open") await openHit(message.id);
  });
}

function schedule(text: string, tab: SearchTab): void {
  const currentGeneration = ++generation;
  if (contentTimer) clearTimeout(contentTimer);
  void publish(text, tab, currentGeneration, false);
  contentTimer = setTimeout(() => { void publish(text, tab, currentGeneration, true); }, CONTENT_DEBOUNCE_MS);
}

async function publish(text: string, tab: SearchTab, currentGeneration: number, includeContent: boolean): Promise<void> {
  const query = parseQuery(text);
  if (query.terms.length === 0 && query.extensions.length === 0) {
    post({ groups: [], status: workspaceStatus(), hint: EMPTY_HINT });
    return;
  }
  const result = await coordinate({
    query, tab, includeContent, isStale: () => currentGeneration !== generation,
    providers: {
      files: { search: (value) => searchFiles(value) },
      symbols: { search: (value) => searchSymbols(value) },
      commands: { search: (value) => Promise.resolve(matchCommands(readCommands(), value)) },
      content: { search: (value) => searchContent(value) },
    },
  });
  if (result.stale || currentGeneration !== generation) return;
  remember(result);
  post(toPayload(result, tab));
}

function post(payload: unknown): void {
  current?.webview.postMessage({ type: "results", payload });
}

function workspaceStatus(): string {
  return vscode.workspace.workspaceFolders ? "" : "没有打开的文件夹";
}

function excludeGlobs(): string[] {
  const files = vscode.workspace.getConfiguration("files").get<Record<string, boolean>>("exclude") ?? {};
  const search = vscode.workspace.getConfiguration("search").get<Record<string, boolean>>("exclude") ?? {};
  return Object.entries({ ...files, ...search }).filter(([, on]) => on).map(([pattern]) => toRgExclude(pattern));
}

function runRg(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 || code === 1 ? resolve(stdout) : reject(new Error(stderr)));
  });
}

async function searchFiles(query: SearchQuery) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return [];
  const stdout = await runRg(fileRgArgs(excludeGlobs()), folder.uri.fsPath);
  return matchFiles(parseRgFiles(stdout).map((relativePath) => ({ relativePath, uri: vscode.Uri.joinPath(folder.uri, relativePath).toString() })), query);
}

async function searchContent(query: SearchQuery) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return [];
  const stdout = await runRg(contentRgArgs(query, excludeGlobs()), folder.uri.fsPath);
  return parseRgMatches(stdout, TAB_CAP).map((match, stableIndex) => ({
    id: `content:${match.path}:${match.line}`,
    kind: "content" as const,
    title: match.path.split("/").pop() ?? match.path,
    detail: match.path,
    source: { type: "workspace" as const },
    uri: vscode.Uri.joinPath(folder.uri, match.path).toString(),
    line: match.line,
    preview: match.preview,
    extension: extensionOf(match.path),
    stableIndex,
  }));
}

async function searchSymbols(query: SearchQuery) {
  if (query.terms.length === 0) return [];
  const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>("vscode.executeWorkspaceSymbolProvider", query.terms.join(" "));
  return matchWorkspaceSymbols((symbols ?? []).map((symbol) => ({
    name: symbol.name,
    detail: symbol.containerName || symbol.location.uri.path,
    uri: symbol.location.uri.toString(),
    line: symbol.location.range.start.line + 1,
    extension: extensionOf(symbol.location.uri.path),
  })), query);
}

function readCommands(): { id: string; title?: string }[] {
  const titles = new Map<string, string>();
  for (const extension of vscode.extensions.all) {
    const contributes = extension.packageJSON.contributes?.commands ?? [];
    for (const command of contributes) titles.set(command.command, command.title);
  }
  return [...titles.entries()].map(([id, title]) => ({ id, title }));
}

function extensionOf(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

function toPayload(result: GroupedResults, tab: SearchTab) {
  const labels: Record<string, string> = { files: "文件名", symbols: "符号", commands: "命令", content: "内容" };
  const order = ["files", "symbols", "commands", "content"] as const;
  const groups = order.map((key) => {
    const value = result[key];
    const tabName = key === "files" || key === "content" ? "文件" : labels[key];
    const note = result.contentFailed && key === "content"
      ? "内容搜索失败"
      : value.truncated ? (tab === "all" ? `还有更多结果，请切换到「${tabName}」` : "只显示前 100 条") : "";
    return {
      title: labels[key],
      note,
      hits: value.hits.map((hit) => ({
        id: hit.id,
        title: hit.title,
        detail: hit.detail,
        sourceLabel: hit.source.type === "workspace" ? "工作区" : hit.source.jarName ?? "JAR",
        preview: hit.preview ?? "",
        line: hit.line ?? 0,
        textTruncated: Boolean(hit.textTruncated),
      })),
    };
  });
  return { groups, status: workspaceStatus(), hint: EMPTY_HINT };
}

async function openHit(id: string): Promise<void> {
  const hit = lastHits.get(id);
  current?.dispose();
  if (!hit) return;
  if (hit.kind === "command") {
    try { await vscode.commands.executeCommand(hit.detail); }
    catch (error) { void vscode.window.showErrorMessage(String(error)); }
    return;
  }
  if (!hit.uri) return;
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(hit.uri));
    const editor = await vscode.window.showTextDocument(document);
    if (hit.line) {
      const position = new vscode.Position(hit.line - 1, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
    }
  } catch (error) {
    void vscode.window.showErrorMessage(String(error));
  }
}

const lastHits = new Map<string, import("./types").SearchHit>();
function remember(result: GroupedResults): void {
  lastHits.clear();
  for (const key of ["files", "symbols", "commands", "content"] as const) {
    for (const hit of result[key].hits) lastHits.set(hit.id, hit);
  }
}
