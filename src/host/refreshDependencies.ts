import { gradleArgs, mavenArgs, parseGradleJars, parseMavenClasspath, siblingSourcesJar } from "../classpath/parseClasspath";
import { resolveFailed, runTool, ToolResult } from "../classpath/resolveProcess";
import { IndexedJar, indexJarEntries, PathRecord, sameJarIdentity, sameSourcesIdentity, SourcesIdentity } from "../jar/indexJar";
import { readZip } from "../jar/readZip";
import { RESOLVE_TIMEOUT_MS } from "../limits";

const GRADLE_FILES = ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"];

export interface RefreshInput {
  workspaceRoots: string[];
  buildFiles?: string[];
  previous: IndexedJar[];
  run: typeof runTool;
  readFile: (filePath: string) => Buffer | undefined | Promise<Buffer | undefined>;
  stat: (filePath: string) => { mtimeMs: number; size: number } | undefined;
  exists: (filePath: string) => boolean;
  which: (command: string) => boolean;
  initScriptPath: string;
  fileTextCap: number;
  jarTextCap: number;
}

export interface RefreshOutcome {
  jars: IndexedJar[];
  failed: boolean;
  hasPreviousIndex: boolean;
  unreadableCount: number;
  log: string;
}

interface ResolvedRoot {
  root: string;
  failed: boolean;
  jarPaths: string[];
  coversChildren: boolean;
}

export async function refreshDependencyIndex(input: RefreshInput): Promise<RefreshOutcome> {
  const logs: string[] = [];
  const dirs = moduleDirectories(input);
  const resolvedRoots: ResolvedRoot[] = [];
  const reactors: string[] = [];
  for (const root of dirs) {
    if (reactors.some(parent => isDescendant(parent, root))) continue;
    const hasDescendant = dirs.some(other => isDescendant(root, other));
    const resolved = await resolveRoot(root, input, hasDescendant);
    logs.push(...resolved.logs);
    resolvedRoots.push({ root, failed: resolved.failed, jarPaths: resolved.jarPaths, coversChildren: resolved.coversChildren });
    if (resolved.coversChildren) reactors.push(root);
  }
  const pathRoots = new Map<string, string[]>();
  for (const resolved of resolvedRoots) {
    if (resolved.failed && resolved.jarPaths.length === 0) continue;
    for (const jarPath of resolved.jarPaths) {
      const roots = pathRoots.get(jarPath) ?? [];
      if (!roots.includes(resolved.root)) roots.push(resolved.root);
      pathRoots.set(jarPath, roots);
    }
  }
  const failed = resolvedRoots.some(item => item.failed);
  if (pathRoots.size === 0 && failed) {
    return outcome(input.previous, true, input.previous.length > 0, 0, logs);
  }
  const failedRoots = new Set(resolvedRoots.filter(item => item.failed && item.jarPaths.length === 0).map(item => item.root));
  const jars: IndexedJar[] = [];
  let unreadableCount = 0;
  for (const jarPath of classpathJars([...pathRoots.keys()])) {
    const indexed = await readIndexedJar(jarPath, input, logs);
    if (indexed) {
      jars.push({ ...indexed.jar, moduleRoots: pathRoots.get(jarPath) ?? [] });
      unreadableCount += indexed.unreadableSources;
    } else unreadableCount += 1;
  }
  const kept = input.previous.filter(jar =>
    (jar.moduleRoots ?? []).some(root => failedRoots.has(root)) && !pathRoots.has(jar.jarPath));
  const keptOld = kept.length > 0;
  return outcome([...jars, ...kept], keptOld, keptOld || input.previous.length > 0, unreadableCount, logs);
}

function outcome(jars: IndexedJar[], failed: boolean, hasPreviousIndex: boolean, unreadableCount: number, logs: string[]): RefreshOutcome {
  return { jars, failed, hasPreviousIndex, unreadableCount, log: logs.join("\n") };
}

async function resolveRoot(root: string, input: RefreshInput, hasDescendant: boolean): Promise<{ failed: boolean; jarPaths: string[]; logs: string[]; coversChildren: boolean }> {
  const logs: string[] = [];
  const jarPaths: string[] = [];
  let failed = false;
  let coversChildren = false;
  if (input.exists(rootFile(root, "pom.xml"))) {
    const command = toolCommand(root, "mvn", input);
    if (!command) {
      failed = true;
      logs.push(`${root}: mvn not found`);
    } else {
      const result = await runBuild(root, command, mavenArgs(), input, logs);
      if (!result || resolveFailed(result)) {
        failed = true;
        if (result) logs.push(toolFailure(root, command, result));
      } else {
        jarPaths.push(...parseMavenClasspath(result.stdout));
        if (hasDescendant && await isMavenReactor(root, input)) coversChildren = true;
      }
    }
  }
  if (GRADLE_FILES.some(name => input.exists(rootFile(root, name)))) {
    const command = toolCommand(root, "gradle", input);
    if (!command) {
      failed = true;
      logs.push(`${root}: gradle not found`);
    } else {
      const result = await runBuild(root, command, gradleArgs(input.initScriptPath), input, logs);
      if (!result || resolveFailed(result)) {
        failed = true;
        if (result) logs.push(toolFailure(root, command, result));
      } else {
        jarPaths.push(...parseGradleJars(result.stdout));
        if (hasDescendant && await isGradleReactor(root, input)) coversChildren = true;
      }
    }
  }
  return { failed, jarPaths, logs, coversChildren };
}

function toolCommand(root: string, tool: "mvn" | "gradle", input: RefreshInput): string | undefined {
  const names = tool === "mvn"
    ? (process.platform === "win32" ? ["mvnw.cmd", "mvnw"] : ["mvnw", "mvnw.cmd"])
    : (process.platform === "win32" ? ["gradlew.bat", "gradlew"] : ["gradlew", "gradlew.bat"]);
  for (const name of names) {
    const wrapper = rootFile(root, name);
    if (input.exists(wrapper)) return wrapper;
  }
  if (input.which(tool)) return tool;
  return undefined;
}

async function runBuild(root: string, command: string, args: string[], input: RefreshInput, logs: string[]): Promise<ToolResult | undefined> {
  try {
    return await input.run({ cwd: root, command, args, timeoutMs: RESOLVE_TIMEOUT_MS });
  } catch (error) {
    logs.push(`${root}: ${command} failed: ${errorMessage(error)}`);
    return undefined;
  }
}

function toolFailure(root: string, command: string, result: ToolResult): string {
  if (result.timedOut) return `${root}: ${command} timed out`;
  const detail = result.stderr.trim();
  return detail ? `${root}: ${command} failed: ${detail}` : `${root}: ${command} failed`;
}

function classpathJars(paths: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const jarPath of paths) {
    if (seen.has(jarPath)) continue;
    seen.add(jarPath);
    unique.push(jarPath);
  }
  return unique.filter(jarPath => !unique.some(other => siblingSourcesJar(other) === jarPath));
}

async function readIndexedJar(jarPath: string, input: RefreshInput, logs: string[]): Promise<{ jar: IndexedJar; unreadableSources: number } | undefined> {
  if (!input.exists(jarPath)) {
    logs.push(`${jarPath}: not found`);
    return undefined;
  }
  const stat = input.stat(jarPath);
  if (!stat) {
    logs.push(`${jarPath}: unable to stat`);
    return undefined;
  }
  const identity = { jarPath, mtimeMs: stat.mtimeMs, size: stat.size };
  const sources = sourcesIdentityOf(jarPath, input);
  const cached = input.previous.find(jar => sameJarIdentity(jar, identity) && sameSourcesIdentity(jar.sources, sources));
  if (cached) return { jar: cached, unreadableSources: cached.unreadableSources ?? 0 };
  try {
    const bytes = await input.readFile(jarPath);
    if (!bytes) throw new Error("unable to read");
    const indexed = indexJarEntries({
      ...identity,
      entries: readZip(bytes),
      fileTextCap: input.fileTextCap,
      jarTextCap: input.jarTextCap,
    });
    return await attachSources(indexed, input, logs, sources);
  } catch (error) {
    logs.push(`${jarPath}: ${errorMessage(error)}`);
    return undefined;
  }
}

function sourcesIdentityOf(jarPath: string, input: RefreshInput): SourcesIdentity | undefined {
  const sourcesPath = siblingSourcesJar(jarPath);
  if (!sourcesPath || !input.exists(sourcesPath)) return undefined;
  const stat = input.stat(sourcesPath);
  if (!stat) return undefined;
  return { jarPath: sourcesPath, mtimeMs: stat.mtimeMs, size: stat.size };
}

async function attachSources(indexed: IndexedJar, input: RefreshInput, logs: string[], sources: SourcesIdentity | undefined): Promise<{ jar: IndexedJar; unreadableSources: number }> {
  if (!sources) return { jar: { ...indexed, unreadableSources: 0 }, unreadableSources: 0 };
  try {
    const bytes = await input.readFile(sources.jarPath);
    if (!bytes) throw new Error("unable to read");
    const parsed = indexJarEntries({
      jarPath: sources.jarPath,
      mtimeMs: sources.mtimeMs,
      size: sources.size,
      entries: readZip(bytes),
      fileTextCap: input.fileTextCap,
      jarTextCap: input.jarTextCap,
    });
    return {
      jar: {
        ...indexed,
        texts: [...indexed.texts, ...parsed.texts],
        paths: mergePaths(indexed.paths, parsed.paths),
        sources,
        unreadableSources: 0,
      },
      unreadableSources: 0,
    };
  } catch (error) {
    logs.push(`${sources.jarPath}: ${errorMessage(error)}`);
    return { jar: { ...indexed, sources, unreadableSources: 1 }, unreadableSources: 1 };
  }
}

function mergePaths(left: PathRecord[], right: PathRecord[]): PathRecord[] {
  const byEntry = new Map<string, PathRecord>();
  for (const item of [...left, ...right]) {
    const existing = byEntry.get(item.entry);
    if (existing) existing.truncated = existing.truncated || item.truncated;
    else byEntry.set(item.entry, { entry: item.entry, truncated: item.truncated });
  }
  return [...byEntry.values()];
}

async function isMavenReactor(root: string, input: RefreshInput): Promise<boolean> {
  const bytes = await input.readFile(rootFile(root, "pom.xml"));
  const text = bytes ? bytes.toString("utf8") : "";
  return /<modules\b[^>]*>[\s\S]*<module\b/i.test(text);
}

async function isGradleReactor(root: string, input: RefreshInput): Promise<boolean> {
  for (const name of GRADLE_FILES) {
    const filePath = rootFile(root, name);
    if (!input.exists(filePath)) continue;
    const bytes = await input.readFile(filePath);
    if (bytes && /\ballprojects\b/.test(bytes.toString("utf8"))) return true;
  }
  return false;
}

function moduleDirectories(input: RefreshInput): string[] {
  if (!input.buildFiles) return [...input.workspaceRoots];
  const dirs: string[] = [];
  const seen = new Set<string>();
  for (const filePath of input.buildFiles) {
    const dir = filePath.replace(/[\\/][^\\/]+$/, "");
    const key = normalizeDir(dir);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    dirs.push(dir);
  }
  dirs.sort((left, right) => normalizeDir(left).split("/").length - normalizeDir(right).split("/").length || normalizeDir(left).localeCompare(normalizeDir(right)));
  return dirs;
}

function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isDescendant(parent: string, dir: string): boolean {
  const root = normalizeDir(parent);
  const child = normalizeDir(dir);
  return child.startsWith(`${root}/`);
}

function rootFile(root: string, name: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${name}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
