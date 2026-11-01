import { gradleArgs, mavenArgs, parseGradleJars, parseMavenClasspath, siblingSourcesJar } from "../classpath/parseClasspath";
import { resolveFailed, runTool, ToolResult } from "../classpath/resolveProcess";
import { IndexedJar, indexJarEntries, sameJarIdentity } from "../jar/indexJar";
import { readZip } from "../jar/readZip";
import { RESOLVE_TIMEOUT_MS } from "../limits";

const GRADLE_FILES = ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"];

export interface RefreshInput {
  workspaceRoots: string[];
  previous: IndexedJar[];
  run: typeof runTool;
  readFile: (filePath: string) => Buffer | undefined;
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

export async function refreshDependencyIndex(input: RefreshInput): Promise<RefreshOutcome> {
  const logs: string[] = [];
  const jarPaths: string[] = [];
  let failed = false;
  for (const root of input.workspaceRoots) {
    const resolved = await resolveRoot(root, input);
    logs.push(...resolved.logs);
    if (resolved.failed) failed = true;
    else jarPaths.push(...resolved.jarPaths);
  }
  if (failed) {
    return outcome(input.previous, true, input.previous.length > 0, 0, logs);
  }
  const jars: IndexedJar[] = [];
  let unreadableCount = 0;
  for (const jarPath of classpathJars(jarPaths)) {
    const indexed = readIndexedJar(jarPath, input, logs);
    if (indexed) jars.push(indexed);
    else unreadableCount += 1;
  }
  return outcome(jars, false, input.previous.length > 0, unreadableCount, logs);
}

function outcome(jars: IndexedJar[], failed: boolean, hasPreviousIndex: boolean, unreadableCount: number, logs: string[]): RefreshOutcome {
  return { jars, failed, hasPreviousIndex, unreadableCount, log: logs.join("\n") };
}

async function resolveRoot(root: string, input: RefreshInput): Promise<{ failed: boolean; jarPaths: string[]; logs: string[] }> {
  const logs: string[] = [];
  const jarPaths: string[] = [];
  let failed = false;
  if (input.exists(rootFile(root, "pom.xml"))) {
    const command = toolCommand(root, "mvnw", "mvn", input);
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
      }
    }
  }
  if (GRADLE_FILES.some(name => input.exists(rootFile(root, name)))) {
    const command = toolCommand(root, "gradlew", "gradle", input);
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
      }
    }
  }
  return { failed, jarPaths, logs };
}

function toolCommand(root: string, wrapperName: string, command: string, input: RefreshInput): string | undefined {
  const wrapper = rootFile(root, wrapperName);
  if (input.exists(wrapper)) return wrapper;
  if (input.which(command)) return command;
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

function readIndexedJar(jarPath: string, input: RefreshInput, logs: string[]): IndexedJar | undefined {
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
  const cached = input.previous.find(jar => sameJarIdentity(jar, identity));
  if (cached) return cached;
  try {
    const bytes = input.readFile(jarPath);
    if (!bytes) throw new Error("unable to read");
    const indexed = indexJarEntries({
      ...identity,
      entries: readZip(bytes),
      fileTextCap: input.fileTextCap,
      jarTextCap: input.jarTextCap,
    });
    return attachSources(indexed, input, logs);
  } catch (error) {
    logs.push(`${jarPath}: ${errorMessage(error)}`);
    return undefined;
  }
}

function attachSources(indexed: IndexedJar, input: RefreshInput, logs: string[]): IndexedJar {
  const sourcesPath = siblingSourcesJar(indexed.jarPath);
  if (!sourcesPath || !input.exists(sourcesPath)) return indexed;
  const stat = input.stat(sourcesPath);
  if (!stat) return indexed;
  try {
    const bytes = input.readFile(sourcesPath);
    if (!bytes) throw new Error("unable to read");
    const sources = indexJarEntries({
      jarPath: sourcesPath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      entries: readZip(bytes),
      fileTextCap: input.fileTextCap,
      jarTextCap: input.jarTextCap,
    });
    return { ...indexed, texts: [...indexed.texts, ...sources.texts] };
  } catch (error) {
    logs.push(`${sourcesPath}: ${errorMessage(error)}`);
    return indexed;
  }
}

function rootFile(root: string, name: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${name}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
