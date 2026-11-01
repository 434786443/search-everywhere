import * as vscode from "vscode";
import { rgPath } from "@vscode/ripgrep";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isRebuildPath, siblingSourcesJar } from "./classpath/parseClasspath";
import { runTool } from "./classpath/resolveProcess";
import { matchCommands } from "./commands/matchCommands";
import { refreshDependencyIndex } from "./host/refreshDependencies";
import { dependencyContentHits, dependencyFileHits, dependencySymbolHits } from "./host/dependencySearch";
import { IndexedJar } from "./jar/indexJar";
import { classEntryToSourceEntry } from "./jar/sourcePath";
import { CONTENT_DEBOUNCE_MS, EMPTY_HINT, FILE_TEXT_CAP, JAR_TEXT_CAP, REBUILD_DEBOUNCE_MS, TAB_CAP } from "./limits";
import { decideOpen } from "./open/decideOpen";
import { panelHtml } from "./panel/panelHtml";
import { parseQuery } from "./query/parseQuery";
import { coordinate, GroupedResults } from "./search/coordinator";
import { shouldPublish } from "./search/shouldPublish";
import { IndexStatus, statusText } from "./status/statusText";
import { matchWorkspaceSymbols } from "./symbols/matchSymbols";
import { SearchHit, SearchQuery, SearchTab } from "./types";
import { contentRgArgs, fileRgArgs, parseRgFiles, parseRgMatches, toRgExclude } from "./workspace/rg";
import { matchFiles } from "./workspace/matchFiles";

let current: vscode.WebviewPanel | undefined;
let generation = 0;
let postedContentGeneration: number | undefined;
let contentTimer: NodeJS.Timeout | undefined;
let rebuildTimer: NodeJS.Timeout | undefined;
let dependencyJars: IndexedJar[] = [];
let indexStatus = statusText({ hasFolder: false, updating: false, failed: false, hasPreviousIndex: false, unreadableCount: 0 });
let output: vscode.OutputChannel | undefined;
let initScriptPath = "";
let refreshRunning = false;
let refreshAgain = false;
let refreshTail: Promise<void> = Promise.resolve();
let lastPayload: { groups: unknown[]; status: string; hint: string } | undefined;

const lastHits = new Map<string, SearchHit>();

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Search Everywhere");
  initScriptPath = path.join(context.extensionPath, "src", "classpath", "gradle-classpath.init.gradle");
  context.subscriptions.push(output);
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("se-jar", { provideTextDocumentContent: jarText }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("se-decl", { provideTextDocumentContent: declarationText }));
  context.subscriptions.push(vscode.commands.registerCommand("searchEverywhere.show", () => openPanel(context)));
  context.subscriptions.push(vscode.commands.registerCommand("searchEverywhere.refreshDependencies", () => { void refreshDependencies(); }));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { void refreshDependencies(); }));
  watchRebuildFiles(context);
  void refreshDependencies();
}

export function deactivate(): void {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  current?.dispose();
}

function watchRebuildFiles(context: vscode.ExtensionContext): void {
  const watcher = vscode.workspace.createFileSystemWatcher("**/{pom.xml,build.gradle,build.gradle.kts,settings.gradle,settings.gradle.kts,gradle.properties,libs.versions.toml}");
  const schedule = (uri: vscode.Uri) => {
    if (!isRebuildPath(uri.fsPath)) return;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildTimer = undefined;
      void refreshDependencies();
    }, REBUILD_DEBOUNCE_MS);
  };
  context.subscriptions.push(watcher, watcher.onDidChange(schedule), watcher.onDidCreate(schedule), watcher.onDidDelete(schedule));
}

function refreshDependencies(): Promise<void> {
  refreshAgain = true;
  if (refreshRunning) return refreshTail;
  refreshRunning = true;
  refreshTail = (async () => {
    try {
      while (refreshAgain) {
        refreshAgain = false;
        await refreshOnce();
      }
    } finally {
      refreshRunning = false;
      if (refreshAgain) void refreshDependencies();
    }
  })();
  return refreshTail;
}

async function refreshOnce(): Promise<void> {
  const roots = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
  if (roots.length === 0) {
    dependencyJars = [];
    applyStatus({ hasFolder: false, updating: false, failed: false, hasPreviousIndex: false, unreadableCount: 0 });
    return;
  }
  applyStatus({ hasFolder: true, updating: true, failed: false, hasPreviousIndex: dependencyJars.length > 0, unreadableCount: 0 });
  try {
    const outcome = await refreshDependencyIndex({
      workspaceRoots: roots,
      previous: dependencyJars,
      run: runTool,
      readFile: readFileBuffer,
      stat: statFile,
      exists: (filePath) => fs.existsSync(filePath),
      which: commandExists,
      initScriptPath,
      fileTextCap: FILE_TEXT_CAP,
      jarTextCap: JAR_TEXT_CAP,
    });
    dependencyJars = outcome.jars;
    appendLog(outcome.log);
    applyStatus({
      hasFolder: true,
      updating: false,
      failed: outcome.failed,
      hasPreviousIndex: outcome.hasPreviousIndex,
      unreadableCount: outcome.unreadableCount,
    });
  } catch (error) {
    appendLog(String(error));
    applyStatus({ hasFolder: true, updating: false, failed: true, hasPreviousIndex: dependencyJars.length > 0, unreadableCount: 0 });
  }
}

function applyStatus(state: IndexStatus): void {
  indexStatus = statusText(state);
  postStatus();
}

function appendLog(text: string): void {
  if (!output || !text) return;
  output.append(text.endsWith("\n") ? text : `${text}\n`);
}

function readFileBuffer(filePath: string): Buffer | undefined {
  try { return fs.readFileSync(filePath); }
  catch { return undefined; }
}

function statFile(filePath: string): { mtimeMs: number; size: number } | undefined {
  try {
    const stat = fs.statSync(filePath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return undefined;
  }
}

function commandExists(command: string): boolean {
  const folders = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const suffixes = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const folder of folders) {
    for (const suffix of suffixes) {
      if (fs.existsSync(path.join(folder, `${command}${suffix}`))) return true;
    }
  }
  return false;
}

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
  post({ groups: [], status: workspaceStatus(), hint: EMPTY_HINT });
}

function schedule(text: string, tab: SearchTab): void {
  const currentGeneration = ++generation;
  if (contentTimer) clearTimeout(contentTimer);
  void publish(text, tab, currentGeneration, false);
  contentTimer = setTimeout(() => {
    void publish(text, tab, currentGeneration, true);
  }, CONTENT_DEBOUNCE_MS);
}

function currentDecision(requestGeneration: number, includeContent: boolean) {
  return shouldPublish({
    generation: requestGeneration,
    currentGeneration: generation,
    includeContent,
    contentPosted: postedContentGeneration === requestGeneration,
  });
}

function noteContentPosted(includeContent: boolean, requestGeneration: number): void {
  if (includeContent) postedContentGeneration = requestGeneration;
}

async function publish(text: string, tab: SearchTab, currentGeneration: number, includeContent: boolean): Promise<void> {
  const query = parseQuery(text);
  if (query.terms.length === 0 && query.extensions.length === 0) {
    if (currentDecision(currentGeneration, includeContent)) {
      post({ groups: [], status: workspaceStatus(), hint: EMPTY_HINT });
      noteContentPosted(includeContent, currentGeneration);
    }
    return;
  }
  const result = await coordinate({
    query, tab, includeContent, isStale: () => currentGeneration !== generation,
    providers: {
      files: { search: (value) => searchFiles(value) },
      symbols: { search: (value) => searchSymbols(value) },
      commands: { search: async (value) => matchCommands(await readCommands(), value) },
      content: { search: (value) => searchContent(value) },
    },
  });
  if (result.stale || !currentDecision(currentGeneration, includeContent)) return;
  remember(result);
  post(toPayload(result, tab));
  noteContentPosted(includeContent, currentGeneration);
}

function post(payload: { groups: unknown[]; status: string; hint: string }): void {
  lastPayload = payload;
  current?.webview.postMessage({ type: "results", payload });
}

function postStatus(): void {
  if (!current) return;
  if (lastPayload) post({ ...lastPayload, status: indexStatus });
  else post({ groups: [], status: indexStatus, hint: EMPTY_HINT });
}

function workspaceStatus(): string {
  return indexStatus;
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
  const folders = vscode.workspace.workspaceFolders ?? [];
  const indexed: { relativePath: string; uri: string }[] = [];
  for (const folder of folders) {
    const relativePaths = parseRgFiles(await runRg(fileRgArgs(excludeGlobs()), folder.uri.fsPath));
    for (const relativePath of relativePaths) {
      indexed.push({ relativePath, uri: vscode.Uri.joinPath(folder.uri, relativePath).toString() });
    }
  }
  return [...matchFiles(indexed, query), ...dependencyFileHits(dependencyJars, query)];
}

async function searchContent(query: SearchQuery) {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const workspaceHits = [];
  for (const folder of folders) {
    const matches = parseRgMatches(await runRg(contentRgArgs(query, excludeGlobs()), folder.uri.fsPath), TAB_CAP);
    for (const match of matches) {
      workspaceHits.push({
        id: `content:${folder.uri.fsPath}:${match.path}:${match.line}`,
        kind: "content" as const,
        title: match.path.split("/").pop() ?? match.path,
        detail: match.path,
        source: { type: "workspace" as const },
        uri: vscode.Uri.joinPath(folder.uri, match.path).toString(),
        line: match.line,
        preview: match.preview,
        extension: extensionOf(match.path),
        stableIndex: workspaceHits.length,
      });
    }
  }
  return [...workspaceHits, ...dependencyContentHits(dependencyJars, query)];
}

async function searchSymbols(query: SearchQuery) {
  const dependencyHits = dependencySymbolHits(dependencyJars, query);
  if (query.terms.length === 0) return dependencyHits;
  const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>("vscode.executeWorkspaceSymbolProvider", query.terms.join(" "));
  return [...matchWorkspaceSymbols((symbols ?? []).map((symbol) => ({
    name: symbol.name,
    detail: symbol.containerName || symbol.location.uri.path,
    uri: symbol.location.uri.toString(),
    line: symbol.location.range.start.line + 1,
    extension: extensionOf(symbol.location.uri.path),
  })), query), ...dependencyHits];
}

async function readCommands(): Promise<{ id: string; title?: string }[]> {
  const titles = new Map<string, string>();
  for (const extension of vscode.extensions.all) {
    const contributes = extension.packageJSON?.contributes?.commands ?? [];
    for (const command of contributes) {
      if (!command?.command) continue;
      titles.set(command.command, command.title);
    }
  }
  const commands: { id: string; title?: string }[] = [...titles.entries()].map(([id, title]) => ({ id, title }));
  const ids = await vscode.commands.getCommands(true);
  for (const id of ids) {
    if (!titles.has(id)) commands.push({ id });
  }
  return commands;
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
  try {
    const jar = hit.source.jarPath ? dependencyJars.find(item => item.jarPath === hit.source.jarPath) : undefined;
    const sourcesJarPath = jar ? siblingSourcesJar(jar.jarPath) : undefined;
    const classEntry = hit.entry;
    let sourceText: string | undefined;
    if (jar && classEntry && classEntry.endsWith(".class")) {
      const javaEntry = classEntryToSourceEntry(classEntry);
      sourceText = jar.texts.find(item => item.entry === javaEntry)?.text;
    }
    const plan = decideOpen({
      hit,
      ...(sourcesJarPath ? { sourcesJarPath } : {}),
      ...(sourceText !== undefined ? { sourceText } : {}),
    });
    if (plan.type === "command") {
      await vscode.commands.executeCommand(plan.commandId);
      return;
    }
    if (plan.type === "workspace") {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(plan.uri));
      await showDocument(document, plan.line);
      return;
    }
    const jarPath = plan.jarPath;
    const openedEntry = plan.entry;
    const line = plan.type === "jar-text" ? plan.line : undefined;
    const opened = findJar(jarPath);
    const hasText = opened?.texts.some(item => item.entry === openedEntry) ?? false;
    const hasClass = opened?.classes.some(item => item.entry === openedEntry) ?? false;
    const scheme = plan.type === "jar-text" || (hasText && !hasClass) ? "se-jar" : "se-decl";
    const document = await vscode.workspace.openTextDocument(virtualUri(scheme, jarPath, openedEntry));
    await vscode.languages.setTextDocumentLanguage(document, languageIdFor(scheme, openedEntry));
    await showDocument(document, line);
  } catch (error) {
    void vscode.window.showErrorMessage(String(error));
  }
}

function remember(result: GroupedResults): void {
  lastHits.clear();
  for (const key of ["files", "symbols", "commands", "content"] as const) {
    for (const hit of result[key].hits) lastHits.set(hit.id, hit);
  }
}

function findJar(jarPath: string): IndexedJar | undefined {
  return dependencyJars.find(jar => jar.jarPath === jarPath)
    ?? dependencyJars.find(jar => siblingSourcesJar(jar.jarPath) === jarPath);
}

function jarText(uri: vscode.Uri): string {
  const { jarPath, entry } = parseVirtualUri(uri);
  const text = findJar(jarPath)?.texts.find(item => item.entry === entry);
  if (!text) throw new Error(`无法读取 ${entry}`);
  return text.text;
}

function declarationText(uri: vscode.Uri): string {
  const { jarPath, entry } = parseVirtualUri(uri);
  const declaration = findJar(jarPath)?.classes.find(item => item.entry === entry);
  if (!declaration) throw new Error(`无法读取 ${entry}`);
  return declaration.declaration;
}

function virtualUri(scheme: "se-jar" | "se-decl", jarPath: string, entry: string): vscode.Uri {
  const entryPath = entry.startsWith("/") ? entry : `/${entry}`;
  return vscode.Uri.from({ scheme, path: entryPath, query: Buffer.from(jarPath, "utf8").toString("base64url") });
}

function parseVirtualUri(uri: vscode.Uri): { jarPath: string; entry: string } {
  return {
    jarPath: Buffer.from(uri.query, "base64url").toString("utf8"),
    entry: uri.path.replace(/^\/+/, ""),
  };
}

function languageIdFor(scheme: "se-jar" | "se-decl", entry: string): string {
  if (scheme === "se-decl") return "java";
  const lower = entry.toLowerCase();
  if (lower.endsWith(".java")) return "java";
  if (lower.endsWith(".xml")) return "xml";
  return "plaintext";
}

async function showDocument(document: vscode.TextDocument, line?: number): Promise<void> {
  const editor = await vscode.window.showTextDocument(document);
  if (!line) return;
  const position = new vscode.Position(line - 1, 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position));
}
