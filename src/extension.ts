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
import { readPersistedJars, writePersistedJars } from "./jar/persistIndex";
import { classEntryToSourceEntry } from "./jar/sourcePath";
import { ALL_GROUP_CAP, CONTENT_DEBOUNCE_MS, EMPTY_HINT, FILE_INDEX_DEBOUNCE_MS, FILE_TEXT_CAP, JAR_TEXT_CAP, REBUILD_DEBOUNCE_MS, TAB_CAP } from "./limits";
import { decideOpen } from "./open/decideOpen";
import { COMMAND_BADGE, FileBadge, fileBadge } from "./panel/fileBadge";
import { createPanelNonce, panelHtml } from "./panel/panelHtml";
import { FileQueryInput, parseFileQuery } from "./query/fileQuery";
import { highlightRanges } from "./rank/rankHits";
import { coordinate, GroupedResults, ResultGroup } from "./search/coordinator";
import { shouldPublish } from "./search/shouldPublish";
import { FileHit, FileSearchResult, IndexedEntry, WasmFileSearch } from "./search/wasmFileSearch";
import { IndexStatus, statusText } from "./status/statusText";
import { matchWorkspaceSymbols } from "./symbols/matchSymbols";
import { SearchHit, SearchQuery, SearchTab } from "./types";
import { contentRgArgs, fileRgArgs, parseRgFiles, searchContentFolders, toRgExclude } from "./workspace/rg";
import { FolderRoot, keyFor, makeEntries, shouldFullRebuild } from "./workspace/fileIndex";
import { matchFiles } from "./workspace/matchFiles";
import { pruneRecents, pushRecent } from "./workspace/recentFiles";

const RECENT_KEY = "searchEverywhere.recentFiles";

let current: vscode.WebviewPanel | undefined;
let panelReady = false;
let generation = 0;
let postedContentGeneration: number | undefined;
let contentTimer: NodeJS.Timeout | undefined;
let rebuildTimer: NodeJS.Timeout | undefined;
let dependencyJars: IndexedJar[] = [];
let fileSearch: WasmFileSearch | undefined;
let fileEntries: IndexedEntry[] = [];
let extensionContext: vscode.ExtensionContext | undefined;
let pendingFullRebuild: NodeJS.Timeout | undefined;
let deltaTimer: NodeJS.Timeout | undefined;
const pendingUpserts = new Set<string>();
const pendingDeletes = new Set<string>();
let storageDirectory: string | undefined;
let recentKeys: string[] = [];
let indexStatus = statusText({ hasFolder: false, updating: false, failed: false, hasPreviousIndex: false, unreadableCount: 0 });
let output: vscode.OutputChannel | undefined;
let initScriptPath = "";
let refreshRunning = false;
let refreshAgain = false;
let refreshTail: Promise<void> = Promise.resolve();
let lastPayload: { groups: unknown[]; status: string; hint: string } | undefined;

interface QuickSnapshot {
  generation: number;
  text: string;
  tab: SearchTab;
  files: ResultGroup;
  symbols: ResultGroup;
  commands: ResultGroup;
}

let quickFlight: { generation: number; text: string; tab: SearchTab; done: Promise<QuickSnapshot | undefined> } | undefined;

const lastHits = new Map<string, SearchHit>();

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Search Everywhere");
  extensionContext = context;
  initScriptPath = path.join(context.extensionPath, "src", "classpath", "gradle-classpath.init.gradle");
  storageDirectory = context.storageUri?.fsPath;
  context.subscriptions.push(output);
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("se-jar", { provideTextDocumentContent: jarText }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("se-decl", { provideTextDocumentContent: declarationText }));
  context.subscriptions.push(vscode.commands.registerCommand("searchEverywhere.show", () => openPanel(context)));
  context.subscriptions.push(vscode.commands.registerCommand("searchEverywhere.refreshDependencies", () => { void refreshDependencies(); }));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    scheduleFileIndex();
    void refreshDependencies();
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("files.exclude") || event.affectsConfiguration("search.exclude")) scheduleFileIndex();
  }));
  watchRebuildFiles(context);
  watchWorkspaceFiles(context);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
    const fsPath = editor?.document.uri.fsPath;
    if (!fsPath || editor.document.isUntitled) return;
    rememberOpened(fsPath);
  }));
  void bootFileSearch(context);
  void boot();
}

export function deactivate(): void {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  if (contentTimer) clearTimeout(contentTimer);
  if (pendingFullRebuild) clearTimeout(pendingFullRebuild);
  if (deltaTimer) clearTimeout(deltaTimer);
  generation += 1;
  current?.dispose();
}

async function bootFileSearch(context: vscode.ExtensionContext): Promise<void> {
  fileSearch = await WasmFileSearch.load(path.join(context.extensionPath, "vendor", "wasm"), (message) => appendLog(message));
  recentKeys = pruneRecents(context.workspaceState.get<string[]>(RECENT_KEY) ?? [], new Set());
  fileSearch?.setRecents(recentKeys);
  scheduleFileIndex();
}

/** Records an opened editor as recent, when its file is in the index. */
function rememberOpened(fsPath: string): void {
  const key = keyForPath(fsPath);
  if (!key) return;
  recentKeys = pushRecent(recentKeys, key);
  fileSearch?.setRecents(recentKeys);
  void extensionContext?.workspaceState.update(RECENT_KEY, recentKeys);
}

async function boot(): Promise<void> {
  dependencyJars = await readPersistedJars(storageDirectory);
  await refreshDependencies();
}

function folderRoots(): FolderRoot[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({ name: folder.name, fsPath: folder.uri.fsPath }));
}

/** Index key for an absolute path, or undefined when the path is outside every folder. */
function keyForPath(fsPath: string): string | undefined {
  const folders = folderRoots();
  const folder = folders.find((root) => fsPath.startsWith(root.fsPath));
  if (!folder) return undefined;
  const relativePath = fsPath.slice(folder.fsPath.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");
  if (!relativePath) return undefined;
  return keyFor(folder, relativePath, folders.length <= 1);
}

function watchWorkspaceFiles(context: vscode.ExtensionContext): void {
  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate((uri) => scheduleFileDelta(uri.fsPath, false)),
    watcher.onDidDelete((uri) => scheduleFileDelta(uri.fsPath, true)),
    watcher.onDidChange((uri) => {
      const normalized = uri.path.replace(/\\/g, "/");
      if (normalized.endsWith("/.gitignore") || normalized.endsWith("/.git/info/exclude")) scheduleFileIndex();
    }),
    vscode.workspace.onDidRenameFiles((event) => {
      for (const file of event.files) {
        scheduleFileDelta(file.oldUri.fsPath, true);
        scheduleFileDelta(file.newUri.fsPath, false);
      }
    }),
  );
}

/** Coalesces the events that change the whole file list into one rescan. */
function scheduleFileIndex(): void {
  if (pendingFullRebuild) clearTimeout(pendingFullRebuild);
  pendingFullRebuild = setTimeout(() => {
    pendingFullRebuild = undefined;
    void rebuildFileIndex();
  }, FILE_INDEX_DEBOUNCE_MS);
}

function scheduleFileDelta(fsPath: string, removed: boolean): void {
  const key = keyForPath(fsPath);
  if (!key) return;
  if (removed) {
    pendingDeletes.add(key);
    pendingUpserts.delete(key);
  } else {
    pendingUpserts.add(key);
    pendingDeletes.delete(key);
  }
  if (shouldFullRebuild(pendingUpserts.size + pendingDeletes.size)) {
    pendingUpserts.clear();
    pendingDeletes.clear();
    scheduleFileIndex();
    return;
  }
  if (deltaTimer) clearTimeout(deltaTimer);
  deltaTimer = setTimeout(() => {
    deltaTimer = undefined;
    void flushFileDeltas();
  }, FILE_INDEX_DEBOUNCE_MS);
}

async function rebuildFileIndex(): Promise<void> {
  const folders = folderRoots();
  const filesByFolder = new Map<string, string[]>();
  for (const folder of folders) {
    try {
      filesByFolder.set(folder.fsPath, parseRgFiles(await runRg(fileRgArgs(excludeGlobs()), folder.fsPath)));
    } catch {
      continue;
    }
  }
  fileEntries = makeEntries(folders, filesByFolder);
  pendingUpserts.clear();
  pendingDeletes.clear();
  fileSearch?.setFiles(fileEntries);
  const pruned = pruneRecents(recentKeys, new Set(fileEntries.map((entry) => entry.key)));
  if (pruned.length !== recentKeys.length) {
    recentKeys = pruned;
    void extensionContext?.workspaceState.update(RECENT_KEY, recentKeys);
  }
  fileSearch?.setRecents(recentKeys);
}

async function flushFileDeltas(): Promise<void> {
  if (pendingDeletes.size > 0) {
    const keys = [...pendingDeletes];
    pendingDeletes.clear();
    fileEntries = fileEntries.filter((entry) => !keys.includes(entry.key));
    fileSearch?.removeFiles(keys);
  }
  if (pendingUpserts.size === 0) return;
  const keys = [...pendingUpserts];
  pendingUpserts.clear();
  const folders = folderRoots();
  const single = folders.length <= 1;
  const confirmed: IndexedEntry[] = [];
  for (const key of keys) {
    const folder = single ? folders[0] : folders.find((root) => key.startsWith(`${root.name}/`));
    if (!folder) continue;
    const relativePath = single ? key : key.slice(folder.name.length + 1);
    let listed: string[];
    try {
      listed = parseRgFiles(await runRg([
        "--files", "--hidden", "--glob", "!.git/**",
        ...excludeGlobs().flatMap((glob) => ["--glob", glob]),
        "--", relativePath,
      ], folder.fsPath));
    } catch {
      continue;
    }
    if (!listed.includes(relativePath)) continue;
    confirmed.push({ key, rel: key, library: false });
  }
  if (confirmed.length === 0) return;
  const confirmedKeys = new Set(confirmed.map((entry) => entry.key));
  fileEntries = [...fileEntries.filter((entry) => !confirmedKeys.has(entry.key)), ...confirmed];
  fileSearch?.upsertFiles(confirmed);
}

function folderUri(folder: vscode.Uri, relativePath: string): string {
  return vscode.Uri.joinPath(folder, ...relativePath.split("/").filter(Boolean)).toString();
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
    const buildFiles = await findBuildFiles();
    const outcome = await refreshDependencyIndex({
      workspaceRoots: roots,
      ...(buildFiles ? { buildFiles } : {}),
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
    try {
      await writePersistedJars(storageDirectory, dependencyJars);
    } catch (error) {
      appendLog(String(error));
    }
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

async function findBuildFiles(): Promise<string[] | undefined> {
  try {
    const found = await vscode.workspace.findFiles("**/{pom.xml,build.gradle,build.gradle.kts,settings.gradle,settings.gradle.kts}");
    return found.map(uri => uri.fsPath);
  } catch {
    return undefined;
  }
}

async function readFileBuffer(filePath: string): Promise<Buffer | undefined> {
  try { return await fs.promises.readFile(filePath); }
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
  panelReady = false;
  current = vscode.window.createWebviewPanel("searchEverywhere", "Search Everywhere", vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")] });
  const nonce = createPanelNonce();
  const scriptUri = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "panel.js"));
  const styleUri = current.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "panel.css"));
  current.webview.html = panelHtml({ scriptUri: String(scriptUri), styleUri: String(styleUri), cspSource: current.webview.cspSource, nonce });
  current.onDidDispose(() => {
    generation += 1;
    if (contentTimer) clearTimeout(contentTimer);
    contentTimer = undefined;
    panelReady = false;
    current = undefined;
  });
  current.webview.onDidReceiveMessage(async (message) => {
    if (message.type === "ready") {
      panelReady = true;
      postStatus();
      return;
    }
    if (message.type === "close") current?.dispose();
    if (message.type === "query") schedule(message.text, message.tab);
    if (message.type === "open") await openHit(message.id);
  });
}

function schedule(text: string, tab: SearchTab): void {
  const currentGeneration = ++generation;
  if (contentTimer) clearTimeout(contentTimer);
  const done = publish(text, tab, currentGeneration, false);
  quickFlight = { generation: currentGeneration, text, tab, done };
  contentTimer = setTimeout(() => {
    contentTimer = undefined;
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

async function publish(text: string, tab: SearchTab, currentGeneration: number, includeContent: boolean): Promise<QuickSnapshot | undefined> {
  const query = parseFileQuery(text, folderRoots().map((root) => root.fsPath));
  const empty = query.terms.length === 0 && query.extensions.length === 0;
  if (empty && recentKeys.length === 0) {
    if (currentDecision(currentGeneration, includeContent)) {
      post({ groups: [], status: workspaceStatus(), hint: EMPTY_HINT });
      noteContentPosted(includeContent, currentGeneration);
    }
    return undefined;
  }
  const flight = quickFlight;
  const prior = includeContent && flight && flight.generation === currentGeneration && flight.text === text && flight.tab === tab
    ? await flight.done
    : undefined;
  if (currentGeneration !== generation) return undefined;
  const limit = (tab === "all" ? ALL_GROUP_CAP : TAB_CAP) + 1;
  const result = await coordinate({
    query, tab, includeContent, isStale: () => currentGeneration !== generation,
    ...(prior ? { prior: { files: prior.files, symbols: prior.symbols, commands: prior.commands } } : {}),
    providers: {
      files: { search: (value) => searchFiles(value, limit) },
      symbols: { search: (value) => searchSymbols(value, limit) },
      commands: { search: async (value) => matchCommands(await readCommands(), value) },
      content: { search: (value) => searchContent(value) },
    },
  });
  if (result.stale || !currentDecision(currentGeneration, includeContent)) return undefined;
  remember(result);
  post(toPayload(result, tab, query.terms));
  noteContentPosted(includeContent, currentGeneration);
  if (includeContent) return undefined;
  return { generation: currentGeneration, text, tab, files: result.files, symbols: result.symbols, commands: result.commands };
}

function post(payload: { groups: unknown[]; status: string; hint: string }): void {
  lastPayload = payload;
  if (!panelReady || !current) return;
  current.webview.postMessage({ type: "results", payload });
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

async function searchFiles(query: SearchQuery, limit: number) {
  const fileQuery: FileQueryInput = "text" in query ? (query as FileQueryInput) : fileQueryOf(query);
  const dependency = dependencyFileHits(dependencyJars, fileQuery, limit);
  if (fileQuery.terms.length === 0 && fileQuery.extensions.length > 0) {
    const listed = fileSearch?.available
      ? fileSearch.listByExtension(fileQuery.extensions, limit)
      : fallbackList(fileQuery, limit);
    return [...toWorkspaceHits(listed, fileQuery), ...dependency];
  }
  // A bare empty query lists recent files; the matcher ranks them by recency.
  const found = fileSearch?.available
    ? fileSearch.find(fileQuery.text, limit, fileQuery.extensions)
    : fallbackFind(fileQuery, limit);
  return [...toWorkspaceHits(found, fileQuery), ...dependency];
}

function fileQueryOf(query: SearchQuery): FileQueryInput {
  return { ...query, text: query.terms.join(" ") };
}

/** Last-resort path when the wasm module is missing or threw. */
function fallbackFind(query: FileQueryInput, limit: number): FileSearchResult {
  const files = fileEntries.map((entry) => ({ relativePath: entry.rel, uri: uriFor(entry.rel) }));
  const hits = matchFiles(files, query, limit);
  return { hits: hits.map(toFallbackHit), total: hits.length };
}

function fallbackList(query: FileQueryInput, limit: number): FileSearchResult {
  const files = fileEntries.map((entry) => ({ relativePath: entry.rel, uri: uriFor(entry.rel) }));
  const hits = matchFiles(files, query, limit);
  return { hits: hits.map(toFallbackHit), total: hits.length };
}

function toFallbackHit(hit: SearchHit): FileHit {
  return { key: hit.detail, rel: hit.detail, score: 0, indices: [] };
}

function uriFor(rel: string): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length <= 1) return folders[0] ? folderUri(folders[0].uri, rel) : "";
  const [name, ...rest] = rel.split("/");
  const folder = folders.find((item) => item.name === name);
  return folder ? folderUri(folder.uri, rest.join("/")) : "";
}

function toWorkspaceHits(result: FileSearchResult, query: FileQueryInput): SearchHit[] {
  return result.hits.map((hit, index) => {
    const title = hit.rel.split("/").pop() ?? hit.rel;
    const dot = title.lastIndexOf(".");
    return {
      id: `file:${hit.key}`,
      kind: "file" as const,
      title,
      detail: hit.rel,
      source: { type: "workspace" as const },
      uri: uriFor(hit.rel),
      extension: dot <= 0 ? "" : title.slice(dot).toLowerCase(),
      stableIndex: index,
      ...(query.line === undefined ? {} : { line: query.line }),
      ...(hit.indices.length === 0 ? {} : { titleRanges: rangesInTitle(hit.rel, hit.indices) }),
    };
  });
}

/** Char indices into `rel` mapped onto the title (the part after the last `/`). */
function rangesInTitle(rel: string, indices: number[]): Array<[number, number]> {
  const nameStart = rel.lastIndexOf("/") + 1;
  const ranges: Array<[number, number]> = [];
  for (const index of indices) {
    if (index < nameStart) continue;
    const start = index - nameStart;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === start) last[1] = start + 1;
    else ranges.push([start, start + 1]);
  }
  return ranges;
}

async function searchContent(query: SearchQuery) {
  const folders = vscode.workspace.workspaceFolders ?? [];
  return searchContentFolders(
    folders.map(folder => ({ key: folder.uri.toString(), fsPath: folder.uri.fsPath })),
    (folder) => runRg(contentRgArgs(query, excludeGlobs()), folder.fsPath),
    TAB_CAP,
    dependencyContentHits(dependencyJars, query),
    (folderKey, match, stableIndex) => {
      const folder = folders.find(item => item.uri.toString() === folderKey);
      return {
        id: `content:${folder?.uri.fsPath ?? folderKey}:${match.path}:${match.line}`,
        kind: "content" as const,
        title: match.path.split("/").pop() ?? match.path,
        detail: match.path,
        source: { type: "workspace" as const },
        uri: folder ? folderUri(folder.uri, match.path) : undefined,
        line: match.line,
        preview: match.preview,
        extension: extensionOf(match.path),
        stableIndex,
      };
    },
  );
}

async function searchSymbols(query: SearchQuery, limit: number) {
  const dependencyHits = dependencySymbolHits(dependencyJars, query, limit);
  if (query.terms.length === 0) return dependencyHits;
  const symbolQuery = query.terms.map(term => term.startsWith("@") ? term.slice(1) : term).filter(term => term.length > 0).join(" ");
  if (symbolQuery.length === 0) return dependencyHits;
  const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>("vscode.executeWorkspaceSymbolProvider", symbolQuery);
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

function toPayload(result: GroupedResults, tab: SearchTab, terms: string[]) {
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
        // Workspace results need no origin label; the file path is the origin.
        sourceLabel: hit.source.type === "jar" ? hit.source.jarName ?? "JAR" : "",
        badge: badgeFor(hit),
        preview: hit.preview ?? "",
        line: hit.line ?? 0,
        textTruncated: Boolean(hit.textTruncated),
        titleRanges: hit.titleRanges ?? highlightRanges(hit.title, terms),
        detailRanges: highlightRanges(hit.detail, terms),
        previewRanges: highlightRanges(hit.preview ?? "", terms),
      })),
    };
  });
  return { groups, status: workspaceStatus(), hint: EMPTY_HINT };
}

function badgeFor(hit: SearchHit): FileBadge | undefined {
  if (hit.kind === "command") return COMMAND_BADGE;
  return fileBadge(hit.extension);
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
      rememberOpened(vscode.Uri.parse(plan.uri).fsPath);
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
