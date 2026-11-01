# Search Everywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个 VS Code 插件，双击 Shift 打开搜索面板，在工作区和 Maven/Gradle 传递依赖里搜索文件名、文件内容、符号和命令。

**Architecture:** WebviewPanel 只负责输入、四个标签和结果列表。纯函数模块负责查询解析、排序、限额和 JAR 声明；VS Code 宿主负责 ripgrep、命令、符号、进程和打开文档。依赖包是同一套搜索的范围扩展，不是第二个面板。任务 1–7 先让工作区搜索可运行，任务 8–15 把依赖索引进同一面板。

**Tech Stack:** TypeScript 5、Node 22+、VS Code 引擎 `^1.85.0`、`node:test`、`@vscode/ripgrep`。

## Global Constraints

- 插件显示名称是 `Search Everywhere`。命令标题、面板状态和空输入提示使用中文。文件名、代码和命令 ID 保持原样。
- 空输入提示原文：`输入关键词，用 .java 或 *.java,*.xml 按后缀过滤。`
- 命令 `searchEverywhere.show` 的标题是 `Search Everywhere: 搜索`。命令 `searchEverywhere.refreshDependencies` 的标题是 `Search Everywhere: 刷新依赖索引`。
- 激活事件是 `onStartupFinished` 和 `onCommand:searchEverywhere.show`。键位是 `shift shift`。
- 标签是全部、文件、符号、命令。全部每组最多 8 条；文件、符号、命令标签每组最多 100 条。
- 内容搜索停止输入 200 毫秒后开始。依赖索引在构建文件变化 1 秒后重建。一次依赖解析超时 3 分钟。
- 单个文本超过 1 MB，或一个 JAR 的文本超过 50 MB 时，类名和路径仍保留，文本只保留到上限，命中标记 `文本不完整`。
- Maven 取 compile、runtime、test。Gradle 取 `compileClasspath`、`runtimeClasspath`、`testCompileClasspath`。同一个 JAR 路径只索引一次。不下载 sources，不把脚本写入用户项目。
- `.java` 命中工作区和源码包里的 `.java`，也命中依赖类。`.class` 只命中类路径。有后缀时不返回命令。
- 不反编译方法体，不索引 `.class` 里的字符串，不修改用户项目，不做单独的依赖标签，空查询不列最近文件，不解析 Maven/Gradle 以外的构建工具。
- 状态原文：`依赖解析失败，仍使用上一份索引`、`依赖包暂不可搜`、`3 个依赖包无法读取`、`没有打开的文件夹`、`正在更新依赖索引`、`内容搜索失败`、`无法读取方法签名`。
- 输出通道名称是 `Search Everywhere`。
- 监听：`pom.xml`、`build.gradle`、`build.gradle.kts`、`settings.gradle`、`settings.gradle.kts`、`gradle.properties`、`gradle/libs.versions.toml`。
- 依赖文本在建索引时写入索引。查询只读索引，不在每次输入时解压 JAR，也不对依赖文本运行 ripgrep。工作区内容搜索仍使用 VS Code 自带的 ripgrep。匹配规则相同：同一行包含每一个搜索词，大小写不敏感。

---

## File structure

- `src/limits.ts` — 规格里的数字和中文原文。
- `src/types.ts` — `SearchQuery`、`SearchHit`、`SearchTab`。
- `src/query/parseQuery.ts` — 输入拆成搜索词和后缀。
- `src/rank/rankHits.ts` — 后缀过滤、匹配档和排序。
- `src/search/coordinator.ts` — 按标签调用提供者、限额、过期结果、内容失败。
- `src/workspace/matchFiles.ts` — 文件名命中。
- `src/workspace/rg.ts` — 组装并解析 ripgrep 参数。
- `src/symbols/matchSymbols.ts` — 工作区符号和依赖类名。
- `src/commands/matchCommands.ts` — 命令标题和 ID。
- `src/jar/classFile.ts` — class 文件解析。
- `src/jar/declaration.ts` — 只读声明文本。
- `src/jar/sourcePath.ts` — `.class` 到 `.java` 的路径和声明行。
- `src/jar/readZip.ts` — 读取 JAR。
- `src/jar/indexJar.ts` — 类名、文本上限和缓存键。
- `src/classpath/parseClasspath.ts` — Maven/Gradle 输出、sources 路径、工具选择、监听路径。
- `src/classpath/resolveProcess.ts` — 启动子进程和超时。
- `src/classpath/gradle-classpath.init.gradle` — Gradle init script。
- `src/open/decideOpen.ts` — 打开哪一种文档。
- `src/status/statusText.ts` — 状态句。
- `src/panel/panelHtml.ts`、`media/panel.js`、`media/panel.css` — 面板。
- `src/extension.ts` — 激活、面板、索引、打开和错误提示。
- `.vscode/launch.json` — 以扩展开发主机运行。

每个 `*.test.ts` 用 `node:test`，编译后从仓库根目录执行。纯模块不导入 `vscode`。

---

### Task 1: 项目骨架和查询解析

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/limits.ts`
- Create: `src/types.ts`
- Create: `src/query/parseQuery.ts`
- Test: `src/query/parseQuery.test.ts`
- Test: `src/limits.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `parseQuery(input: string): SearchQuery`
  - `SearchQuery = { terms: string[]; extensions: string[] }`
  - `SearchHit`，字段见本任务实现
  - `ALL_GROUP_CAP = 8`，`TAB_CAP = 100`，`CONTENT_DEBOUNCE_MS = 200`，`REBUILD_DEBOUNCE_MS = 1000`，`RESOLVE_TIMEOUT_MS = 180000`，`FILE_TEXT_CAP = 1048576`，`JAR_TEXT_CAP = 52428800`
  - `EMPTY_HINT = "输入关键词，用 .java 或 *.java,*.xml 按后缀过滤。"`

- [ ] **Step 1: Write the failing test**

`src/limits.test.ts`

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_GROUP_CAP, CONTENT_DEBOUNCE_MS, EMPTY_HINT, FILE_TEXT_CAP, JAR_TEXT_CAP, REBUILD_DEBOUNCE_MS, RESOLVE_TIMEOUT_MS, TAB_CAP } from "./limits";

test("spec limits", () => {
  assert.equal(ALL_GROUP_CAP, 8);
  assert.equal(TAB_CAP, 100);
  assert.equal(CONTENT_DEBOUNCE_MS, 200);
  assert.equal(REBUILD_DEBOUNCE_MS, 1000);
  assert.equal(RESOLVE_TIMEOUT_MS, 180000);
  assert.equal(FILE_TEXT_CAP, 1048576);
  assert.equal(JAR_TEXT_CAP, 52428800);
  assert.equal(EMPTY_HINT, "输入关键词，用 .java 或 *.java,*.xml 按后缀过滤。");
});
```

`src/query/parseQuery.test.ts`

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "./parseQuery";

test("User .java", () => {
  assert.deepEqual(parseQuery("User .java"), { terms: ["User"], extensions: [".java"] });
});

test("comma masks", () => {
  assert.deepEqual(parseQuery("*.java,*.xml"), { terms: [], extensions: [".java", ".xml"] });
  assert.deepEqual(parseQuery(".java,.xml"), { terms: [], extensions: [".java", ".xml"] });
});

test("User.java stays a term", () => {
  assert.deepEqual(parseQuery("User.java"), { terms: ["User.java"], extensions: [] });
});

test("extension case and empty input", () => {
  assert.deepEqual(parseQuery("  .JAVA  "), { terms: [], extensions: [".java"] });
  assert.deepEqual(parseQuery("   "), { terms: [], extensions: [] });
});

test("two terms share one mask", () => {
  assert.deepEqual(parseQuery("foo bar .java"), { terms: ["foo", "bar"], extensions: [".java"] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p . --pretty false && node --test out/limits.test.js out/query/parseQuery.test.js`

Expected: FAIL，`tsc` 报找不到 `./limits` 或 `./parseQuery`。

- [ ] **Step 3: Write minimal implementation**

`package.json`

```json
{
  "name": "search-everywhere",
  "displayName": "Search Everywhere",
  "publisher": "local",
  "version": "0.0.1",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished", "onCommand:searchEverywhere.show"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      { "command": "searchEverywhere.show", "title": "Search Everywhere: 搜索" },
      { "command": "searchEverywhere.refreshDependencies", "title": "Search Everywhere: 刷新依赖索引" }
    ],
    "keybindings": [
      { "command": "searchEverywhere.show", "key": "shift shift" }
    ]
  },
  "scripts": {
    "compile": "tsc -p .",
    "test": "tsc -p . --pretty false && node --test \"out/**/*.test.js\""
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/vscode": "^1.85.0",
    "typescript": "^5.6.3"
  },
  "dependencies": {
    "@vscode/ripgrep": "^1.15.9"
  }
}
```

`tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

`.gitignore`

```gitignore
out/
node_modules/
*.vsix
```

`src/limits.ts`

```typescript
export const ALL_GROUP_CAP = 8;
export const TAB_CAP = 100;
export const CONTENT_DEBOUNCE_MS = 200;
export const REBUILD_DEBOUNCE_MS = 1000;
export const RESOLVE_TIMEOUT_MS = 180000;
export const FILE_TEXT_CAP = 1048576;
export const JAR_TEXT_CAP = 52428800;
export const EMPTY_HINT = "输入关键词，用 .java 或 *.java,*.xml 按后缀过滤。";
```

`src/types.ts`

```typescript
export interface SearchQuery {
  terms: string[];
  extensions: string[];
}

export type HitKind = "file" | "content" | "symbol" | "command";
export type SearchTab = "all" | "files" | "symbols" | "commands";

export interface HitSource {
  type: "workspace" | "jar";
  jarPath?: string;
  jarName?: string;
}

export interface SearchHit {
  id: string;
  kind: HitKind;
  title: string;
  detail: string;
  source: HitSource;
  uri?: string;
  line?: number;
  preview?: string;
  extension: string;
  treatAsJava?: boolean;
  textTruncated?: boolean;
  stableIndex: number;
  entry?: string;
}
```

`src/query/parseQuery.ts`

```typescript
import { SearchQuery } from "../types";

const EXTENSION_TOKEN = /^(\*\.[A-Za-z0-9]+|\.[A-Za-z0-9]+)(,(\*\.[A-Za-z0-9]+|\.[A-Za-z0-9]+))*$/;

export function parseQuery(input: string): SearchQuery {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const terms: string[] = [];
  const extensions: string[] = [];
  for (const token of tokens) {
    if (!EXTENSION_TOKEN.test(token)) {
      terms.push(token);
      continue;
    }
    for (const part of token.split(",")) {
      const extension = (part.startsWith("*.") ? part.slice(1) : part).toLowerCase();
      if (!extensions.includes(extension)) extensions.push(extension);
    }
  }
  return { terms, extensions };
}
```

Run `npm install` once from the repository root.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p . --pretty false && node --test out/limits.test.js out/query/parseQuery.test.js`

Expected: PASS，6 个测试通过。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore src/limits.ts src/limits.test.ts src/types.ts src/query/parseQuery.ts src/query/parseQuery.test.ts
git commit -m "$(cat <<'EOF'
Add the search query parser.

Lock the spec limits and split extension masks from search terms.

EOF
)"
```

---

### Task 2: 后缀过滤和排序

**Files:**
- Create: `src/rank/rankHits.ts`
- Test: `src/rank/rankHits.test.ts`

**Interfaces:**
- Consumes: `SearchHit`、`SearchQuery`（`src/types.ts`）。
- Produces:
  - `matchesExtension(hit: SearchHit, extensions: string[]): boolean`
  - `rankHits(hits: SearchHit[], query: SearchQuery): SearchHit[]`

- [ ] **Step 1: Write the failing test**

`src/rank/rankHits.test.ts`

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankHits } from "./rankHits";
import { SearchHit } from "../types";

function hit(partial: Partial<SearchHit> & Pick<SearchHit, "id" | "kind" | "title">): SearchHit {
  return {
    detail: partial.title,
    source: { type: "workspace" },
    extension: ".java",
    stableIndex: 0,
    ...partial,
  };
}

test("exact file name beats prefix", () => {
  const ranked = rankHits([
    hit({ id: "prefix", kind: "file", title: "UserService.java", stableIndex: 0 }),
    hit({ id: "exact", kind: "file", title: "User.java", stableIndex: 1 }),
  ], { terms: ["User"], extensions: [] });
  assert.deepEqual(ranked.map(item => item.id), ["exact", "prefix"]);
});

test("workspace beats jar at the same tier", () => {
  const ranked = rankHits([
    hit({ id: "jar", kind: "file", title: "User.java", source: { type: "jar", jarName: "a.jar" }, stableIndex: 0 }),
    hit({ id: "ws", kind: "file", title: "User.java", stableIndex: 1 }),
  ], { terms: ["User"], extensions: [] });
  assert.deepEqual(ranked.map(item => item.id), ["ws", "jar"]);
});

test("java filter keeps source files and dependency classes", () => {
  const ranked = rankHits([
    hit({ id: "xml", kind: "file", title: "User.xml", extension: ".xml" }),
    hit({ id: "class", kind: "symbol", title: "User", extension: ".class", treatAsJava: true, source: { type: "jar" } }),
    hit({ id: "java", kind: "file", title: "User.java", extension: ".java" }),
  ], { terms: ["User"], extensions: [".java"] });
  assert.deepEqual(ranked.map(item => item.id), ["java", "class"]);
});

test("class filter matches class paths only", () => {
  const ranked = rankHits([
    hit({ id: "java", kind: "file", title: "User.java", extension: ".java" }),
    hit({ id: "class", kind: "symbol", title: "User", extension: ".class", treatAsJava: true }),
  ], { terms: ["User"], extensions: [".class"] });
  assert.deepEqual(ranked.map(item => item.id), ["class"]);
});

test("extension filter removes commands", () => {
  const ranked = rankHits([
    hit({ id: "cmd", kind: "command", title: "User", extension: "", detail: "user.command" }),
  ], { terms: ["User"], extensions: [".java"] });
  assert.deepEqual(ranked, []);
});

test("multiple terms have no exact tier", () => {
  const ranked = rankHits([
    hit({ id: "joined", kind: "file", title: "UserService.java", detail: "src/UserService.java" }),
  ], { terms: ["User", "Service"], extensions: [] });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, "joined");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p . --pretty false && node --test out/rank/rankHits.test.js`

Expected: FAIL，找不到 `./rankHits`。

- [ ] **Step 3: Write minimal implementation**

`src/rank/rankHits.ts`

```typescript
import { SearchHit, SearchQuery } from "../types";

export function matchesExtension(hit: SearchHit, extensions: string[]): boolean {
  if (hit.kind === "command") return extensions.length === 0;
  if (extensions.length === 0) return true;
  if (extensions.includes(hit.extension)) return true;
  return Boolean(hit.treatAsJava && extensions.includes(".java"));
}

function stripExt(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 ? fileName : fileName.slice(0, dot);
}

function tierFor(hit: SearchHit, query: SearchQuery): 0 | 1 | 2 | undefined {
  if (!matchesExtension(hit, query.extensions)) return undefined;
  const terms = query.terms.map(term => term.toLowerCase());
  if (terms.length === 0) return 2;
  if (hit.kind === "content") {
    const preview = (hit.preview ?? "").toLowerCase();
    return terms.every(term => preview.includes(term)) ? 2 : undefined;
  }
  const fields = [hit.title, stripExt(hit.title), hit.detail].map(value => value.toLowerCase());
  if (terms.length === 1) {
    const term = terms[0];
    if (hit.kind === "file" || hit.kind === "symbol") {
      if (hit.title.toLowerCase() === term || stripExt(hit.title).toLowerCase() === term) return 0;
      if (stripExt(hit.title).toLowerCase().startsWith(term)) return 1;
    } else if (fields.some(field => field === term)) return 0;
    else if (fields.some(field => field.startsWith(term))) return 1;
  }
  return terms.every(term => fields.some(field => field.includes(term))) ? 2 : undefined;
}

export function rankHits(hits: SearchHit[], query: SearchQuery): SearchHit[] {
  return hits
    .map(hit => ({ hit, tier: tierFor(hit, query) }))
    .filter((item): item is { hit: SearchHit; tier: 0 | 1 | 2 } => item.tier !== undefined)
    .sort((a, b) => a.tier - b.tier
      || (a.hit.source.type === "workspace" ? 0 : 1) - (b.hit.source.type === "workspace" ? 0 : 1)
      || a.hit.stableIndex - b.hit.stableIndex)
    .map(item => item.hit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p . --pretty false && node --test out/rank/rankHits.test.js`

Expected: PASS，6 个测试通过。

- [ ] **Step 5: Commit**

```bash
git add src/rank/rankHits.ts src/rank/rankHits.test.ts
git commit -m "$(cat <<'EOF'
Rank search hits by match tier and origin.

Keep Java dependency classes in a .java filter and drop commands when an extension mask is present.

EOF
)"
```

---

### Task 3: 搜索协调器

**Files:**
- Create: `src/search/coordinator.ts`
- Test: `src/search/coordinator.test.ts`

**Interfaces:**
- Consumes: `rankHits(hits, query)`、`SearchHit`、`SearchQuery`、`SearchTab`、`ALL_GROUP_CAP`、`TAB_CAP`。
- Produces:
  - `SearchProvider = { search(query: SearchQuery): Promise<SearchHit[]> }`
  - `GroupedResults = { stale: boolean; files: ResultGroup; symbols: ResultGroup; commands: ResultGroup; content: ResultGroup; contentFailed: boolean }`
  - `ResultGroup = { hits: SearchHit[]; truncated: boolean }`
  - `coordinate(input: CoordinateInput): Promise<GroupedResults>`
  - `emptyResults(stale?: boolean): GroupedResults`

`CoordinateInput` 字段：`query`、`tab`、`includeContent`、`providers`、`isStale(): boolean`。

- [ ] **Step 1: Write the failing test**

`src/search/coordinator.test.ts`

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { coordinate } from "./coordinator";
import { SearchHit, SearchProvider, SearchQuery } from "../types";

function file(id: string, index: number): SearchHit {
  return { id, kind: "file", title: `F${id}.java`, detail: `src/F${id}.java`, source: { type: "workspace" }, extension: ".java", stableIndex: index };
}

function provider(hits: SearchHit[] | Error): SearchProvider {
  return { search: async () => { if (hits instanceof Error) throw hits; return hits; } };
}

const query: SearchQuery = { terms: ["F"], extensions: [] };

test("empty input does not call providers", async () => {
  const bomb: SearchProvider = { search: async () => { throw new Error("called"); } };
  const result = await coordinate({
    query: { terms: [], extensions: [] },
    tab: "all",
    includeContent: true,
    isStale: () => false,
    providers: { files: bomb, symbols: bomb, commands: bomb, content: bomb },
  });
  assert.equal(result.files.hits.length, 0);
  assert.equal(result.stale, false);
});

test("all tab caps each group at 8", async () => {
  const files = Array.from({ length: 9 }, (_, index) => file(String(index), index));
  const result = await coordinate({
    query, tab: "all", includeContent: false, isStale: () => false,
    providers: { files: provider(files), symbols: provider([]), commands: provider([]), content: provider([]) },
  });
  assert.equal(result.files.hits.length, 8);
  assert.equal(result.files.truncated, true);
});

test("files tab caps at 100 and keeps workspace content first", async () => {
  const content: SearchHit[] = [
    { id: "jar", kind: "content", title: "A.java", detail: "jar", source: { type: "jar", jarName: "a.jar" }, extension: ".java", preview: "F", stableIndex: 0 },
    { id: "ws", kind: "content", title: "A.java", detail: "src/A.java", source: { type: "workspace" }, extension: ".java", preview: "F", stableIndex: 1 },
  ];
  const result = await coordinate({
    query, tab: "files", includeContent: true, isStale: () => false,
    providers: { files: provider([]), symbols: provider([]), commands: provider([]), content: provider(content) },
  });
  assert.deepEqual(result.content.hits.map(item => item.id), ["ws", "jar"]);
});

test("content failure keeps file hits", async () => {
  const result = await coordinate({
    query, tab: "all", includeContent: true, isStale: () => false,
    providers: { files: provider([file("1", 0)]), symbols: provider([]), commands: provider([]), content: provider(new Error("rg")) },
  });
  assert.equal(result.files.hits.length, 1);
  assert.equal(result.contentFailed, true);
  assert.equal(result.content.hits.length, 0);
});

test("extension mask skips the command provider", async () => {
  let called = false;
  const commands: SearchProvider = { search: async () => { called = true; return []; } };
  await coordinate({
    query: { terms: ["User"], extensions: [".java"] },
    tab: "all", includeContent: false, isStale: () => false,
    providers: { files: provider([]), symbols: provider([]), commands, content: provider([]) },
  });
  assert.equal(called, false);
});

test("stale generation is flagged", async () => {
  const result = await coordinate({
    query, tab: "all", includeContent: false, isStale: () => true,
    providers: { files: provider([file("1", 0)]), symbols: provider([]), commands: provider([]), content: provider([]) },
  });
  assert.equal(result.stale, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p . --pretty false && node --test out/search/coordinator.test.js`

Expected: FAIL，找不到 `./coordinator`。

- [ ] **Step 3: Write minimal implementation**

`src/search/coordinator.ts`

```typescript
import { ALL_GROUP_CAP, TAB_CAP } from "../limits";
import { rankHits } from "../rank/rankHits";
import { SearchHit, SearchQuery, SearchTab } from "../types";

export interface SearchProvider { search(query: SearchQuery): Promise<SearchHit[]>; }
export interface ResultGroup { hits: SearchHit[]; truncated: boolean; }
export interface GroupedResults {
  stale: boolean;
  files: ResultGroup;
  symbols: ResultGroup;
  commands: ResultGroup;
  content: ResultGroup;
  contentFailed: boolean;
}
export interface CoordinateInput {
  query: SearchQuery;
  tab: SearchTab;
  includeContent: boolean;
  providers: { files: SearchProvider; symbols: SearchProvider; commands: SearchProvider; content: SearchProvider };
  isStale(): boolean;
}

function group(hits: SearchHit[], limit: number): ResultGroup {
  return { hits: hits.slice(0, limit), truncated: hits.length > limit };
}

export function emptyResults(stale = false): GroupedResults {
  const empty = { hits: [], truncated: false };
  return { stale, files: empty, symbols: empty, commands: empty, content: empty, contentFailed: false };
}

export async function coordinate(input: CoordinateInput): Promise<GroupedResults> {
  const { query, tab } = input;
  if (query.terms.length === 0 && query.extensions.length === 0) return emptyResults(false);
  const limit = tab === "all" ? ALL_GROUP_CAP : TAB_CAP;
  const wantFiles = tab === "all" || tab === "files";
  const wantSymbols = tab === "all" || tab === "symbols";
  const wantCommands = (tab === "all" || tab === "commands") && query.extensions.length === 0 && query.terms.length > 0;
  const wantContent = input.includeContent && query.terms.length > 0 && (tab === "all" || tab === "files");
  const files = wantFiles ? await input.providers.files.search(query) : [];
  const symbols = wantSymbols ? await input.providers.symbols.search(query) : [];
  const commands = wantCommands ? await input.providers.commands.search(query) : [];
  let content: SearchHit[] = [];
  let contentFailed = false;
  if (wantContent) {
    try { content = await input.providers.content.search(query); }
    catch { contentFailed = true; }
  }
  if (input.isStale()) return emptyResults(true);
  return {
    stale: false,
    files: group(rankHits(files, query), limit),
    symbols: group(rankHits(symbols, query), limit),
    commands: group(rankHits(commands, query), limit),
    content: group(rankHits(content, query), limit),
    contentFailed,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p . --pretty false && node --test out/search/coordinator.test.js`

Expected: PASS，6 个测试通过。

- [ ] **Step 5: Commit**

```bash
git add src/search/coordinator.ts src/search/coordinator.test.ts
git commit -m "$(cat <<'EOF'
Coordinate providers into capped result groups.

Drop stale responses and keep filename hits when content search fails.

EOF
)"
```

---

### Task 4: 工作区文件名和 ripgrep 文件列表

**Files:**
- Create: `src/workspace/matchFiles.ts`
- Create: `src/workspace/rg.ts`
- Test: `src/workspace/matchFiles.test.ts`
- Test: `src/workspace/rg.test.ts`

**Interfaces:**
- Consumes: `SearchHit`、`SearchQuery`、`rankHits`。
- Produces:
  - `matchFiles(files: IndexedFile[], query: SearchQuery): SearchHit[]`
  - `IndexedFile = { relativePath: string; uri: string }`
  - `toRgExclude(pattern: string): string`
  - `parseRgFiles(stdout: string): string[]`
  - `parseRgMatches(stdout: string, limit: number): RgMatch[]`
  - `RgMatch = { path: string; line: number; preview: string }`
  - `contentRgArgs(query: SearchQuery, excludeGlobs: string[]): string[]`

- [ ] **Step 1: Write the failing test**

`src/workspace/matchFiles.test.ts`

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchFiles } from "./matchFiles";

test("extension-only query lists file names and skips content fields", () => {
  const hits = matchFiles([
    { relativePath: "src/User.java", uri: "file:///src/User.java" },
    { relativePath: "src/App.xml", uri: "file:///src/App.xml" },
  ], { terms: [], extensions: [".java"] });
  assert.deepEqual(hits.map(hit => hit.title), ["User.java"]);
  assert.equal(hits[0].kind, "file");
  assert.equal(hits[0].line, undefined);
});
```

`src/workspace/rg.test.ts`

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { contentRgArgs, parseRgMatches, toRgExclude } from "./rg";

test("exclude patterns become ripgrep globs", () => {
  assert.equal(toRgExclude("**/node_modules"), "!**/node_modules");
  assert.equal(toRgExclude("target"), "!**/target");
});

test("content args require every term and the extension glob", () => {
  const args = contentRgArgs({ terms: ["User", "Service"], extensions: [".java"] }, ["!**/target"]);
  assert.ok(args.includes("-i"));
  assert.ok(args.includes("*.java"));
  assert.ok(args.includes("(?=.*User)(?=.*Service).*"));
  assert.ok(args.includes("!**/target"));
});

test("parse ripgrep lines and stop at the limit", () => {
  const parsed = parseRgMatches("src/User.java:3:class User\nsrc/Other.java:4:class User\n", 1);
  assert.deepEqual(parsed, [{ path: "src/User.java", line: 3, preview: "class User" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p . --pretty false && node --test out/workspace/matchFiles.test.js out/workspace/rg.test.js`

Expected: FAIL，找不到模块。

- [ ] **Step 3: Write minimal implementation**

`src/workspace/matchFiles.ts`

```typescript
import { rankHits } from "../rank/rankHits";
import { SearchHit, SearchQuery } from "../types";

export interface IndexedFile { relativePath: string; uri: string; }

export function matchFiles(files: IndexedFile[], query: SearchQuery): SearchHit[] {
  const hits: SearchHit[] = files.map((file, stableIndex) => {
    const title = file.relativePath.split("/").pop() ?? file.relativePath;
    const dot = title.lastIndexOf(".");
    return {
      id: `file:${file.uri}`,
      kind: "file",
      title,
      detail: file.relativePath,
      source: { type: "workspace" },
      uri: file.uri,
      extension: dot <= 0 ? "" : title.slice(dot).toLowerCase(),
      stableIndex,
    };
  });
  return rankHits(hits, query);
}
```

`src/workspace/rg.ts`

```typescript
import { SearchQuery } from "../types";

export interface RgMatch { path: string; line: number; preview: string; }

export function toRgExclude(pattern: string): string {
  const body = pattern.startsWith("**/") ? pattern : `**/${pattern.replace(/^!/, "")}`;
  return body.startsWith("!") ? body : `!${body}`;
}

export function parseRgFiles(stdout: string): string[] {
  return stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

export function parseRgMatches(stdout: string, limit: number): RgMatch[] {
  const matches: RgMatch[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const found = /^(.*?):(\d+):(.*)$/.exec(raw);
    if (!found) continue;
    matches.push({ path: found[1], line: Number(found[2]), preview: found[3] });
    if (matches.length === limit) break;
  }
  return matches;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function contentRgArgs(query: SearchQuery, excludeGlobs: string[]): string[] {
  const pattern = query.terms.map(term => `(?=.*${escapeRegex(term)})`).join("") + ".*";
  const globs = [
    ...excludeGlobs.flatMap(glob => ["--glob", glob]),
    ...query.extensions.flatMap(extension => ["--glob", `*${extension}`]),
  ];
  return ["-n", "-i", "--no-heading", "--glob", "!.git/**", ...globs, pattern];
}

export function fileRgArgs(excludeGlobs: string[]): string[] {
  return ["--files", "--hidden", "--glob", "!.git/**", "--iglob", "!.git/**", ...excludeGlobs.flatMap(glob => ["--glob", glob])];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p . --pretty false && node --test out/workspace/matchFiles.test.js out/workspace/rg.test.js`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/workspace/matchFiles.ts src/workspace/matchFiles.test.ts src/workspace/rg.ts src/workspace/rg.test.ts
git commit -m "$(cat <<'EOF'
Match workspace file names and build ripgrep arguments.

Extension-only queries list names without running a content search.

EOF
)"
```

---

### Task 5: 符号和命令匹配

**Files:**
- Create: `src/symbols/matchSymbols.ts`
- Create: `src/commands/matchCommands.ts`
- Test: `src/symbols/matchSymbols.test.ts`
- Test: `src/commands/matchCommands.test.ts`

**Interfaces:**
- Consumes: `SearchHit`、`SearchQuery`、`rankHits`。
- Produces:
  - `matchWorkspaceSymbols(symbols: WorkspaceSymbolInput[], query: SearchQuery): SearchHit[]`
  - `matchDependencyClasses(classes: DependencyClassInput[], query: SearchQuery): SearchHit[]`
  - `matchCommands(commands: CommandInput[], query: SearchQuery): SearchHit[]`
  - `WorkspaceSymbolInput = { name: string; detail: string; uri: string; line: number; extension: string }`
  - `DependencyClassInput = { simpleName: string; detail: string; jarPath: string; jarName: string; entry: string }`
  - `CommandInput = { id: string; title?: string }`

- [ ] **Step 1: Write the failing test**

`src/symbols/matchSymbols.test.ts`

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchDependencyClasses, matchWorkspaceSymbols } from "./matchSymbols";

test("extension-only query skips workspace symbols and keeps dependency classes", () => {
  const query = { terms: [], extensions: [".java"] };
  const workspace = matchWorkspaceSymbols([
    { name: "User", detail: "src/User.java", uri: "file:///src/User.java", line: 1, extension: ".java" },
  ], query);
  const classes = matchDependencyClasses([
    { simpleName: "User", detail: "com.example.User", jarPath: "/repo/a.jar", jarName: "a.jar", entry: "com/example/User.class" },
  ], query);
  assert.equal(workspace.length, 0);
  assert.equal(classes.length, 1);
  assert.equal(classes[0].treatAsJava, true);
  assert.equal(classes[0].source.jarName, "a.jar");
});
```

`src/commands/matchCommands.test.ts`

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchCommands } from "./matchCommands";

test("missing title displays the command id", () => {
  const hits = matchCommands([{ id: "workbench.action.quickOpen" }], { terms: ["quickOpen"], extensions: [] });
  assert.equal(hits[0].title, "workbench.action.quickOpen");
  assert.equal(hits[0].detail, "workbench.action.quickOpen");
});

test("no terms produce no commands", () => {
  assert.deepEqual(matchCommands([{ id: "a", title: "A" }], { terms: [], extensions: [".java"] }), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p . --pretty false && node --test out/symbols/matchSymbols.test.js out/commands/matchCommands.test.js`

Expected: FAIL，找不到模块。

- [ ] **Step 3: Write minimal implementation**

`src/symbols/matchSymbols.ts`

```typescript
import { rankHits } from "../rank/rankHits";
import { SearchHit, SearchQuery } from "../types";

export interface WorkspaceSymbolInput { name: string; detail: string; uri: string; line: number; extension: string; }
export interface DependencyClassInput { simpleName: string; detail: string; jarPath: string; jarName: string; entry: string; }

export function matchWorkspaceSymbols(symbols: WorkspaceSymbolInput[], query: SearchQuery): SearchHit[] {
  if (query.terms.length === 0) return [];
  const hits: SearchHit[] = symbols.map((symbol, stableIndex) => ({
    id: `symbol:${symbol.uri}:${symbol.line}:${symbol.name}`,
    kind: "symbol",
    title: symbol.name,
    detail: symbol.detail,
    source: { type: "workspace" },
    uri: symbol.uri,
    line: symbol.line,
    extension: symbol.extension,
    stableIndex,
  }));
  return rankHits(hits, query);
}

export function matchDependencyClasses(classes: DependencyClassInput[], query: SearchQuery): SearchHit[] {
  const hits: SearchHit[] = classes.map((item, stableIndex) => ({
    id: `jar-class:${item.jarPath}!${item.entry}`,
    kind: "symbol",
    title: item.simpleName,
    detail: item.detail,
    source: { type: "jar", jarPath: item.jarPath, jarName: item.jarName },
    extension: ".class",
    treatAsJava: true,
    stableIndex,
    entry: item.entry,
  }));
  return rankHits(hits, query);
}
```

`src/commands/matchCommands.ts`

```typescript
import { rankHits } from "../rank/rankHits";
import { SearchHit, SearchQuery } from "../types";

export interface CommandInput { id: string; title?: string; }

export function matchCommands(commands: CommandInput[], query: SearchQuery): SearchHit[] {
  if (query.terms.length === 0) return [];
  const hits: SearchHit[] = commands.map((command, stableIndex) => ({
    id: `command:${command.id}`,
    kind: "command",
    title: command.title && command.title.length > 0 ? command.title : command.id,
    detail: command.id,
    source: { type: "workspace" },
    extension: "",
    stableIndex,
  }));
  return rankHits(hits, query);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p . --pretty false && node --test out/symbols/matchSymbols.test.js out/commands/matchCommands.test.js`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/symbols/matchSymbols.ts src/symbols/matchSymbols.test.ts src/commands/matchCommands.ts src/commands/matchCommands.test.ts
git commit -m "$(cat <<'EOF'
Match symbols and commands with the shared ranker.

Extension-only queries list dependency classes and hide commands.

EOF
)"
```

---

### Task 6: 搜索面板

**Files:**
- Create: `src/panel/panelHtml.ts`
- Create: `media/panel.js`
- Create: `media/panel.css`
- Create: `.vscode/launch.json`
- Create: `src/extension.ts`
- Test: `src/panel/panelHtml.test.ts`
- Test: `src/extensionManifest.test.ts`

**Interfaces:**
- Consumes: `EMPTY_HINT`、`GroupedResults`、`SearchTab`、`coordinate`、`parseQuery`、`CONTENT_DEBOUNCE_MS`。
- Produces: `panelHtml(options: { scriptUri: string; styleUri: string; cspSource: string; nonce: string }): string`。面板消息 `{ type: "query", text: string, tab: SearchTab }`、`{ type: "open", id: string }`、`{ type: "close" }`。宿主消息 `{ type: "results", payload: PanelPayload }`。

`PanelPayload` 字段：`groups: { title: string; hits: PanelHit[]; note: string }[]`、`status: string`、`hint: string`。`PanelHit` 字段：`id`、`title`、`detail`、`sourceLabel`、`preview`、`line`、`textTruncated`。

- [ ] **Step 1: Write the failing test**

`src/panel/panelHtml.test.ts`

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { panelHtml } from "./panelHtml";
import { EMPTY_HINT } from "../limits";

test("panel contains four tabs and the empty hint", () => {
  const html = panelHtml({ scriptUri: "script.js", styleUri: "panel.css", cspSource: "csp", nonce: "n" });
  for (const label of ["全部", "文件", "符号", "命令", EMPTY_HINT]) assert.ok(html.includes(label));
  assert.ok(html.includes("nonce=\"n\""));
});
```

`src/extensionManifest.test.ts`

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("manifest registers both commands and double shift", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.deepEqual(pkg.activationEvents, ["onStartupFinished", "onCommand:searchEverywhere.show"]);
  assert.equal(pkg.contributes.commands[0].title, "Search Everywhere: 搜索");
  assert.equal(pkg.contributes.commands[1].title, "Search Everywhere: 刷新依赖索引");
  assert.equal(pkg.contributes.keybindings[0].key, "shift shift");
  assert.equal(pkg.displayName, "Search Everywhere");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p . --pretty false && node --test out/panel/panelHtml.test.js out/extensionManifest.test.js`

Expected: `panelHtml.test.js` FAIL，找不到模块。清单测试在 `package.json` 已存在时可以通过；若清单测试已通过，只要求面板测试失败。

- [ ] **Step 3: Write minimal implementation**

`src/panel/panelHtml.ts`

```typescript
import { EMPTY_HINT } from "../limits";

export function panelHtml(options: { scriptUri: string; styleUri: string; cspSource: string; nonce: string }): string {
  const nonce = options.nonce;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${options.cspSource}; script-src 'nonce-${nonce}';" />
<link rel="stylesheet" href="${options.styleUri}" />
</head>
<body>
<div class="tabs">
  <button type="button" data-tab="all" class="active">全部</button>
  <button type="button" data-tab="files">文件</button>
  <button type="button" data-tab="symbols">符号</button>
  <button type="button" data-tab="commands">命令</button>
</div>
<input id="q" type="text" aria-label="搜索" />
<p id="hint">${EMPTY_HINT}</p>
<p id="status"></p>
<div id="results"></div>
<script nonce="${nonce}" src="${options.scriptUri}"></script>
</body>
</html>`;
}
```

`media/panel.css`

```css
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 12px; }
.tabs { display: flex; gap: 8px; }
.tabs button { background: transparent; color: inherit; border: 0; border-bottom: 2px solid transparent; padding: 6px 8px; }
.tabs button.active { border-bottom-color: var(--vscode-focusBorder); }
input { width: 100%; box-sizing: border-box; margin: 12px 0; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); }
.hit, .note, h2 { padding: 4px 8px; }
.hit.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.meta { opacity: 0.75; }
```

`media/panel.js`

```javascript
(function () {
  const vscode = acquireVsCodeApi();
  const input = document.getElementById("q");
  const hint = document.getElementById("hint");
  const status = document.getElementById("status");
  const results = document.getElementById("results");
  const tabs = Array.from(document.querySelectorAll("[data-tab]"));
  let tab = "all";
  let selectable = [];
  let selected = 0;

  function postQuery() {
    vscode.postMessage({ type: "query", text: input.value, tab });
  }

  tabs.forEach((button) => {
    button.addEventListener("click", () => {
      tab = button.dataset.tab;
      tabs.forEach((item) => item.classList.toggle("active", item === button));
      postQuery();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selected = Math.min(selected + 1, Math.max(selectable.length - 1, 0));
      paint();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selected = Math.max(selected - 1, 0);
      paint();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = selectable[selected];
      if (hit) vscode.postMessage({ type: "open", id: hit.id });
    } else if (event.key === "Escape") {
      event.preventDefault();
      vscode.postMessage({ type: "close" });
    } else if (event.key === "Tab") {
      event.preventDefault();
      const order = ["all", "files", "symbols", "commands"];
      const index = order.indexOf(tab);
      const next = event.shiftKey ? (index + 3) % 4 : (index + 1) % 4;
      tab = order[next];
      tabs.forEach((item) => item.classList.toggle("active", item.dataset.tab === tab));
      postQuery();
    }
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "results") return;
    status.textContent = message.payload.status || "";
    hint.hidden = input.value.trim().length > 0;
    selectable = [];
    results.replaceChildren();
    for (const group of message.payload.groups) {
      if (group.hits.length === 0 && !group.note) continue;
      const heading = document.createElement("h2");
      heading.textContent = group.title;
      results.appendChild(heading);
      for (const hit of group.hits) {
        const index = selectable.push(hit) - 1;
        const row = document.createElement("div");
        row.className = "hit";
        row.dataset.index = String(index);
        const preview = hit.preview ? `:${hit.line} ${hit.preview}` : "";
        const truncated = hit.textTruncated ? " 文本不完整" : "";
        row.innerHTML = `<div>${hit.title}${truncated}</div><div class="meta">${hit.sourceLabel} ${hit.detail}${preview}</div>`;
        row.addEventListener("click", () => vscode.postMessage({ type: "open", id: hit.id }));
        results.appendChild(row);
      }
      if (group.note) {
        const note = document.createElement("div");
        note.className = "note";
        note.textContent = group.note;
        results.appendChild(note);
      }
    }
    selected = 0;
    paint();
  });

  function paint() {
    results.querySelectorAll(".hit").forEach((row) => {
      row.classList.toggle("selected", Number(row.dataset.index) === selected);
    });
  }

  input.addEventListener("input", postQuery);
  input.focus();
}());
```

`src/extension.ts` 在本任务先接上工作区搜索。依赖解析留到任务 15，本任务的符号提供者只调用工作区符号，类名列表传空数组。内容搜索在 200 毫秒后第二次调用 `coordinate`，`includeContent: true`。

```typescript
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
```

`.vscode/launch.json`

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/out/**/*.js"]
    }
  ]
}
```

`readCommands` 在本任务先只用 `contributes.commands` 的标题。任务 14 再并入 `vscode.commands.getCommands(true)` 里没有标题的 ID。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p . --pretty false && node --test out/panel/panelHtml.test.js out/extensionManifest.test.js`

Expected: PASS。`extension.ts` 能通过 `tsc`。

- [ ] **Step 5: Commit**

```bash
git add src/panel/panelHtml.ts src/panel/panelHtml.test.ts src/extensionManifest.test.ts src/extension.ts media/panel.js media/panel.css .vscode/launch.json
git commit -m "$(cat <<'EOF'
Open a search panel for workspace files, symbols, and commands.

Debounce content search and keep the four result groups in one webview.

EOF
)"
```

---

### Task 7: 用夹具跑通工作区 ripgrep

**Files:**
- Create: `src/workspace/rgSpawn.test.ts`

**Interfaces:**
- Consumes: `rgPath`、`fileRgArgs`、`contentRgArgs`、`parseRgFiles`、`parseRgMatches`、`TAB_CAP`。
- Produces: 无新导出。这个任务证明真实 ripgrep 遵守 `.gitignore`，并且一行必须同时包含所有搜索词。

- [ ] **Step 1: Write the failing test**

`src/workspace/rgSpawn.test.ts`

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { rgPath } from "@vscode/ripgrep";
import { contentRgArgs, fileRgArgs, parseRgFiles, parseRgMatches } from "./rg";
import { TAB_CAP } from "../limits";

test("ripgrep hides gitignored files and ANDs terms", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "se-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, ".gitignore"), "*.log\n");
  fs.writeFileSync(path.join(root, "src", "User.java"), "class UserService {}\n");
  fs.writeFileSync(path.join(root, "src", "skip.log"), "User Service\n");
  spawnSync("git", ["init"], { cwd: root });
  const listed = parseRgFiles(spawnSync(rgPath, fileRgArgs([]), { cwd: root, encoding: "utf8" }).stdout);
  assert.ok(listed.includes("src/User.java"));
  assert.ok(!listed.some(file => file.endsWith(".log")));
  const matches = parseRgMatches(spawnSync(rgPath, contentRgArgs({ terms: ["User", "Service"], extensions: [".java"] }, []), { cwd: root, encoding: "utf8" }).stdout, TAB_CAP);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].path, "src/User.java");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p . --pretty false && node --test out/workspace/rgSpawn.test.js`

Expected: 在实现文件列表参数之前，若 `fileRgArgs` 已在任务 4 导出，这个测试应当直接 PASS。若 FAIL，错误会指出缺少导出或 gitignore 未生效。不要放宽断言去迎合失败。

- [ ] **Step 3: Write minimal implementation**

任务 4 的 `fileRgArgs` 已经包含 `--files`、`--hidden` 和 `!.git/**`。ripgrep 默认遵守 `.gitignore`。若测试失败，只修正 `fileRgArgs` 或 `contentRgArgs`，让断言成立，不要改测试期望。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p . --pretty false && node --test out/workspace/rgSpawn.test.js`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/workspace/rgSpawn.test.ts src/workspace/rg.ts
git commit -m "$(cat <<'EOF'
Prove workspace ripgrep honors gitignore and term conjunction.

EOF
)"
```

如果 `rg.ts` 没有变化，只提交测试文件。

---

### Task 8: class 声明

**Files:**
- Create: `src/jar/classFile.ts`
- Create: `src/jar/declaration.ts`
- Test: `src/jar/declaration.test.ts`

**Interfaces:**
- Consumes: 无外部搜索类型。
- Produces:
  - `parseClassFile(bytes: Buffer): ClassInfo`
  - `ClassInfo = { access: number; thisName: string; superName?: string; interfaces: string[]; methods: ClassMethod[]; hasRecord: boolean }`
  - `ClassMethod = { access: number; name: string; descriptor: string; signature?: string }`
  - `formatDeclaration(info: ClassInfo): string`
  - 解析失败由调用方捕获。`formatDeclaration` 不输出方法体和字段。

夹具是 `javac 17` 编译的 `com.example.Hello`，实现 `Runnable`，含泛型方法 `names`。Base64 如下，测试里原样使用：

```text
yv66vgAAAD0AFgoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWBwAIAQARY29tL2V4YW1wbGUvSGVsbG8HAAoBABJqYXZhL2xhbmcvUnVubmFibGUBAARDb2RlAQAPTGluZU51bWJlclRhYmxlAQAFZ3JlZXQBACYoTGphdmEvbGFuZy9TdHJpbmc7KUxqYXZhL2xhbmcvU3RyaW5nOwEABW5hbWVzAQAiKExqYXZhL3V0aWwvTGlzdDspTGphdmEvdXRpbC9MaXN0OwEACVNpZ25hdHVyZQEASihMamF2YS91dGlsL0xpc3Q8TGphdmEvbGFuZy9TdHJpbmc7PjspTGphdmEvdXRpbC9MaXN0PExqYXZhL2xhbmcvU3RyaW5nOz47AQADcnVuAQAKU291cmNlRmlsZQEACkhlbGxvLmphdmEAIQAHAAIAAQAJAAAABAABAAUABgABAAsAAAAdAAEAAQAAAAUqtwABsQAAAAEADAAAAAYAAQAAAAYAAQANAA4AAQALAAAAGgABAAIAAAACK7AAAAABAAwAAAAGAAEAAAAHAAEADwAQAAIACwAAABoAAQACAAAAAiuwAAAAAQAMAAAABgABAAAACAARAAAAAgASAAEAEwAGAAEACwAAABkAAAABAAAAAbEAAAABAAwAAAAGAAEAAAAJAAEAFAAAAAIAFQ==
```

- [ ] **Step 1: Write the failing test**

`src/jar/declaration.test.ts`

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClassFile } from "./classFile";
import { formatDeclaration } from "./declaration";

const HELLO_CLASS = "yv66vgAAAD0AFgoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWBwAIAQARY29tL2V4YW1wbGUvSGVsbG8HAAoBABJqYXZhL2xhbmcvUnVubmFibGUBAARDb2RlAQAPTGluZU51bWJlclRhYmxlAQAFZ3JlZXQBACYoTGphdmEvbGFuZy9TdHJpbmc7KUxqYXZhL2xhbmcvU3RyaW5nOwEABW5hbWVzAQAiKExqYXZhL3V0aWwvTGlzdDspTGphdmEvdXRpbC9MaXN0OwEACVNpZ25hdHVyZQEASihMamF2YS91dGlsL0xpc3Q8TGphdmEvbGFuZy9TdHJpbmc7PjspTGphdmEvdXRpbC9MaXN0PExqYXZhL2xhbmcvU3RyaW5nOz47AQADcnVuAQAKU291cmNlRmlsZQEACkhlbGxvLmphdmEAIQAHAAIAAQAJAAAABAABAAUABgABAAsAAAAdAAEAAQAAAAUqtwABsQAAAAEADAAAAAYAAQAAAAYAAQANAA4AAQALAAAAGgABAAIAAAACK7AAAAABAAwAAAAGAAEAAAAHAAEADwAQAAIACwAAABoAAQACAAAAAiuwAAAAAQAMAAAABgABAAAACAARAAAAAgASAAEAEwAGAAEACwAAABkAAAABAAAAAbEAAAABAAwAAAAGAAEAAAAJAAEAFAAAAAIAFQ==";

test("declaration shows generic signatures and no method bodies", () => {
  const text = formatDeclaration(parseClassFile(Buffer.from(HELLO_CLASS, "base64")));
  assert.match(text, /^package com\.example;/);
  assert.match(text, /public class Hello implements java\.lang\.Runnable/);
  assert.match(text, /public java\.lang\.String greet\(java\.lang\.String\);/);
  assert.match(text, /public java\.util\.List<java\.lang\.String> names\(java\.util\.List<java\.lang\.String>\);/);
  assert.equal(text.includes("java.lang.Object"), false);
  assert.equal(text.includes("invoke"), false);
  assert.equal(text.includes("field"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p . --pretty false && node --test out/jar/declaration.test.js`

Expected: FAIL，找不到 `./classFile` 或 `./declaration`。

- [ ] **Step 3: Write minimal implementation**

`src/jar/classFile.ts` 和 `src/jar/declaration.ts` 按下面两份源码写入。`<init>` 不写返回类型，显示为简单类名。`java.lang.Object` 和 `java.lang.Enum` 不写进 `extends`。

```typescript
export interface ClassMethod { access: number; name: string; descriptor: string; signature?: string; }
export interface ClassInfo { access: number; thisName: string; superName?: string; interfaces: string[]; methods: ClassMethod[]; hasRecord: boolean; }

export function parseClassFile(buf: Buffer): ClassInfo {
  let o = 0;
  const u1 = () => buf[o++];
  const u2 = () => { const v = buf.readUInt16BE(o); o += 2; return v; };
  const u4 = () => { const v = buf.readUInt32BE(o); o += 4; return v; };
  if (u4() !== 0xcafebabe) throw new Error("bad magic");
  u2(); u2();
  const cpCount = u2();
  const cp: ({ s?: string; a?: number } | null)[] = [null];
  for (let i = 1; i < cpCount; i++) {
    const tag = u1();
    if (tag === 1) {
      const len = u2();
      cp[i] = { s: buf.subarray(o, o + len).toString("utf8") };
      o += len;
    } else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) cp[i] = { a: u2() };
    else if (tag === 3 || tag === 4) { u4(); cp[i] = {}; }
    else if (tag === 5 || tag === 6) { u4(); u4(); cp[i] = {}; cp[++i] = null; }
    else if (tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 17 || tag === 18) { cp[i] = { a: u2() }; u2(); }
    else if (tag === 15) { u1(); u2(); cp[i] = {}; }
    else throw new Error(`unknown tag ${tag}`);
  }
  const utf = (i: number) => cp[i]?.s ?? "";
  const className = (i: number) => utf(cp[i]?.a ?? 0);
  const access = u2();
  const thisName = className(u2());
  const superIndex = u2();
  const superName = superIndex === 0 ? undefined : className(superIndex);
  const interfaces: string[] = [];
  for (let i = 0, n = u2(); i < n; i++) interfaces.push(className(u2()));
  const members = (keep: boolean): ClassMethod[] => {
    const found: ClassMethod[] = [];
    for (let i = 0, n = u2(); i < n; i++) {
      const mAccess = u2();
      const name = utf(u2());
      const descriptor = utf(u2());
      let signature: string | undefined;
      for (let a = 0, ac = u2(); a < ac; a++) {
        const an = utf(u2());
        const len = u4();
        if (an === "Signature") signature = utf(u2());
        else o += len;
      }
      if (keep && (mAccess & 0x1000) === 0 && (mAccess & 0x0040) === 0 && name !== "<clinit>") found.push({ access: mAccess, name, descriptor, signature });
    }
    return found;
  };
  members(false);
  const methods = members(true);
  let hasRecord = false;
  for (let a = 0, n = u2(); a < n; a++) {
    const an = utf(u2());
    const len = u4();
    if (an === "Record") hasRecord = true;
    o += len;
  }
  return { access, thisName, superName, interfaces, methods, hasRecord };
}
```

```typescript
import { ClassInfo, ClassMethod } from "./classFile";

const BASE: Record<string, string> = { B: "byte", C: "char", D: "double", F: "float", I: "int", J: "long", S: "short", Z: "boolean" };

function parseType(sig: string, i: number): [string, number] {
  const c = sig[i];
  if (BASE[c]) return [BASE[c], i + 1];
  if (c === "T") { const end = sig.indexOf(";", i); return [sig.slice(i + 1, end), end + 1]; }
  if (c === "[") { const [inner, n] = parseType(sig, i + 1); return [`${inner}[]`, n]; }
  if (c !== "L") throw new Error("bad signature");
  let j = i + 1;
  let name = "";
  while (sig[j] !== "<" && sig[j] !== ";") { name += sig[j] === "/" ? "." : sig[j]; j++; }
  let args = "";
  if (sig[j] === "<") {
    j++;
    const parts: string[] = [];
    while (sig[j] !== ">") {
      if (sig[j] === "*") { parts.push("?"); j++; continue; }
      if (sig[j] === "+" || sig[j] === "-") {
        const [t, n] = parseType(sig, j + 1);
        parts.push(`? ${sig[j] === "+" ? "extends" : "super"} ${t}`);
        j = n;
        continue;
      }
      const [t, n] = parseType(sig, j);
      parts.push(t);
      j = n;
    }
    args = `<${parts.join(", ")}>`;
    j++;
  }
  if (sig[j] !== ";") throw new Error("bad signature");
  return [name + args, j + 1];
}

function parseMethodType(sig: string): { params: string[]; ret: string } {
  let i = 0;
  if (sig[0] === "<") {
    let depth = 0;
    for (; i < sig.length; i++) {
      if (sig[i] === "<") depth++;
      else if (sig[i] === ">") { depth--; if (depth === 0) { i++; break; } }
    }
  }
  i++;
  const params: string[] = [];
  while (sig[i] !== ")") { const [t, n] = parseType(sig, i); params.push(t); i = n; }
  i++;
  if (sig[i] === "V") return { params, ret: "void" };
  const [ret] = parseType(sig, i);
  return { params, ret };
}

function methodLine(method: ClassMethod, simple: string): string {
  const types = method.signature ? tryParse(method.signature) ?? parseMethodType(method.descriptor) : parseMethodType(method.descriptor);
  const flags = method.access;
  const mods = [flags & 0x0001 ? "public" : "", flags & 0x0004 ? "protected" : "", flags & 0x0002 ? "private" : "", flags & 0x0008 ? "static" : "", flags & 0x0010 ? "final" : "", flags & 0x0400 ? "abstract" : ""].filter(Boolean);
  const prefix = mods.length ? `${mods.join(" ")} ` : "";
  if (method.name === "<init>") return `    ${prefix}${simple}(${types.params.join(", ")});`;
  return `    ${prefix}${types.ret} ${method.name}(${types.params.join(", ")});`;
}

function tryParse(sig: string): { params: string[]; ret: string } | undefined {
  try { return parseMethodType(sig); } catch { return undefined; }
}

export function formatDeclaration(info: ClassInfo): string {
  const chunks = info.thisName.split("/");
  const rawSimple = chunks.pop() ?? info.thisName;
  const simple = rawSimple.split("$").pop() ?? rawSimple;
  const pkg = chunks.join(".");
  const dotted = (name: string) => name.replaceAll("/", ".");
  let kind = "class";
  if (info.access & 0x2000) kind = "@interface";
  else if (info.access & 0x0200) kind = "interface";
  else if (info.access & 0x4000) kind = "enum";
  else if (info.hasRecord) kind = "record";
  const visibility = info.access & 0x0001 ? "public " : "";
  const superName = info.superName ? dotted(info.superName) : undefined;
  const omitSuper = !superName || superName === "java.lang.Object" || superName === "java.lang.Enum";
  const iface = info.interfaces.map(dotted);
  const isIface = kind === "interface" || kind === "@interface";
  let header = `${visibility}${kind} ${simple}`;
  if (!isIface && !omitSuper) header += ` extends ${superName}`;
  if (isIface && iface.length) header += ` extends ${iface.join(", ")}`;
  if (!isIface && iface.length) header += ` implements ${iface.join(", ")}`;
  const lines = pkg ? [`package ${pkg};`, "", header] : [header];
  for (const method of info.methods) lines.push(methodLine(method, simple));
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p . --pretty false && node --test out/jar/declaration.test.js`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/jar/classFile.ts src/jar/declaration.ts src/jar/declaration.test.ts
git commit -m "$(cat <<'EOF'
Format class declarations from bytecode signatures.

Show generic method signatures without method bodies or fields.

EOF
)"
```

---

### Task 9: 源码路径和声明行

**Files:**
- Create: `src/jar/sourcePath.ts`
- Test: `src/jar/sourcePath.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `classEntryToSourceEntry(classEntry: string): string`
  - `classNameFromEntry(classEntry: string): { simpleName: string; binaryName: string }`
  - `findDeclarationLine(source: string, simpleName: string): number | undefined`

- [ ] **Step 1: Write the failing test**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { classEntryToSourceEntry, classNameFromEntry, findDeclarationLine } from "./sourcePath";

test("inner class maps to the outer source file", () => {
  assert.equal(classEntryToSourceEntry("com/foo/Outer$Inner.class"), "com/foo/Outer.java");
  assert.deepEqual(classNameFromEntry("com/foo/Outer$Inner.class"), { simpleName: "Inner", binaryName: "com.foo.Outer$Inner" });
});

test("finds the first matching declaration", () => {
  const source = "public class Outer {\n  class Inner {}\n}\n";
  assert.equal(findDeclarationLine(source, "Inner"), 2);
  assert.equal(findDeclarationLine(source, "Missing"), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p . --pretty false && node --test out/jar/sourcePath.test.js`

Expected: FAIL，找不到 `./sourcePath`。

- [ ] **Step 3: Write minimal implementation**

```typescript
export function classEntryToSourceEntry(classEntry: string): string {
  const withoutExt = classEntry.replace(/\.class$/, "");
  return `${withoutExt.split("$")[0]}.java`;
}

export function classNameFromEntry(classEntry: string): { simpleName: string; binaryName: string } {
  const binaryName = classEntry.replace(/\.class$/, "").replaceAll("/", ".");
  const tail = binaryName.split("$").pop() ?? binaryName;
  const simpleName = tail.split(".").pop() ?? tail;
  return { simpleName, binaryName };
}

export function findDeclarationLine(source: string, simpleName: string): number | undefined {
  const escaped = simpleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:@interface|class|interface|enum|record)\\s+${escaped}\\b`);
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex(line => pattern.test(line));
  return index < 0 ? undefined : index + 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p . --pretty false && node --test out/jar/sourcePath.test.js`

Expected: PASS。`Inner` 在第 2 行。

- [ ] **Step 5: Commit**

```bash
git add src/jar/sourcePath.ts src/jar/sourcePath.test.ts
git commit -m "$(cat <<'EOF'
Map class entries onto their Java source declarations.

Inner classes open the outer compilation unit and then the matching declaration.

EOF
)"
```

---

### Task 10: JAR 读取和文本上限

**Files:**
- Create: `src/jar/readZip.ts`
- Create: `src/jar/indexJar.ts`
- Test: `src/jar/indexJar.test.ts`

**Interfaces:**
- Consumes: `parseClassFile`、`formatDeclaration`、`classNameFromEntry`、`FILE_TEXT_CAP`、`JAR_TEXT_CAP`。
- Produces:
  - `readZip(bytes: Buffer): ZipEntry[]`，`ZipEntry = { name: string; data: Buffer }`
  - `indexJarEntries(input: IndexJarInput): IndexedJar`
  - `sameJarIdentity(left: JarIdentity, right: JarIdentity): boolean`
  - `JarIdentity = { jarPath: string; mtimeMs: number; size: number }`
  - `IndexedJar` 含 `classes`、`texts`、`paths`。`classes` 项含 `entry`、`simpleName`、`binaryName`、`declaration`、`signaturesFailed`。`texts` 项含 `entry`、`text`、`truncated`。

`indexJarEntries` 接收 `fileTextCap` 和 `jarTextCap`，生产调用传入 `FILE_TEXT_CAP` 和 `JAR_TEXT_CAP`。

- [ ] **Step 1: Write the failing test**

测试自己写一个只含 stored 和 deflate 条目的 ZIP，不依赖系统 `jar` 命令。用任务 8 的 `HELLO_CLASS` base64 作为 `.class` 条目。再放一个 `meta/app.xml`，内容是 `<app>User</app>`。

断言：

- `classes[0].simpleName === "Hello"`
- `classes[0].declaration` 包含 `greet`
- `texts` 里有 `meta/app.xml`，且 `truncated === false`
- 传入 `fileTextCap: 4` 时，该 xml 没有文本，`paths` 仍包含它，并且对应记录 `truncated === true`
- 损坏的 class 字节 `Buffer.from("not a class")` 仍得到由路径 `com/example/Broken.class` 推出的 `simpleName === "Broken"`，`signaturesFailed === true`，声明文本包含 `无法读取方法签名`
- `sameJarIdentity` 在路径、mtime、size 都相同的时候为 true，size 变化后为 false

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p . --pretty false && node --test out/jar/indexJar.test.js`

Expected: FAIL，找不到 `./indexJar`。

- [ ] **Step 3: Write minimal implementation**

`src/jar/readZip.ts` 从文件尾向前找 `0x06054b50`。中央目录偏移为 `0xffffffff` 时抛 `Error("zip64")`。每个条目读取方法、压缩大小、文件名和本地头偏移。名字以 `/` 结尾的跳过。方法 8 用 `zlib.inflateRawSync`，方法 0 拷贝字节。

`src/jar/indexJar.ts`

```typescript
import { formatDeclaration, parseClassFile } from "./classFile";
import { classNameFromEntry } from "./sourcePath";

export interface JarIdentity { jarPath: string; mtimeMs: number; size: number; }
export interface ClassRecord { entry: string; simpleName: string; binaryName: string; declaration: string; signaturesFailed: boolean; }
export interface TextRecord { entry: string; text: string; truncated: boolean; }
export interface IndexedJar extends JarIdentity { classes: ClassRecord[]; texts: TextRecord[]; paths: { entry: string; truncated: boolean }[]; }

export function sameJarIdentity(left: JarIdentity, right: JarIdentity): boolean {
  return left.jarPath === right.jarPath && left.mtimeMs === right.mtimeMs && left.size === right.size;
}

export function indexJarEntries(input: { jarPath: string; mtimeMs: number; size: number; entries: { name: string; data: Buffer }[]; fileTextCap: number; jarTextCap: number }): IndexedJar {
  const classes: ClassRecord[] = [];
  const texts: TextRecord[] = [];
  const paths: { entry: string; truncated: boolean }[] = [];
  let used = 0;
  for (const entry of input.entries) {
    if (entry.name.endsWith("/")) continue;
    if (entry.name.endsWith(".class")) {
      try {
        const info = parseClassFile(entry.data);
        const name = classNameFromEntry(entry.name);
        classes.push({ entry: entry.name, ...name, declaration: formatDeclaration(info), signaturesFailed: false });
      } catch {
        const name = classNameFromEntry(entry.name);
        const pkg = name.binaryName.includes(".") ? name.binaryName.slice(0, name.binaryName.lastIndexOf(".")) : "";
        classes.push({ entry: entry.name, ...name, declaration: `${pkg ? `package ${pkg};\n\n` : ""}${name.simpleName}\n无法读取方法签名`, signaturesFailed: true });
      }
      paths.push({ entry: entry.name, truncated: false });
      continue;
    }
    const binary = entry.data.includes(0);
    if (binary) { paths.push({ entry: entry.name, truncated: false }); continue; }
    if (entry.data.length > input.fileTextCap || used >= input.jarTextCap) {
      paths.push({ entry: entry.name, truncated: true });
      continue;
    }
    const room = input.jarTextCap - used;
    const text = entry.data.subarray(0, room).toString("utf8");
    const truncated = text.length < entry.data.length;
    texts.push({ entry: entry.name, text, truncated });
    paths.push({ entry: entry.name, truncated });
    used += Buffer.byteLength(text);
  }
  return { jarPath: input.jarPath, mtimeMs: input.mtimeMs, size: input.size, classes, texts, paths };
}
```

损坏 class 的声明必须包含 `无法读取方法签名`。`.class` 的常量池字符串不会进入 `texts`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p . --pretty false && node --test out/jar/indexJar.test.js`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/jar/readZip.ts src/jar/indexJar.ts src/jar/indexJar.test.ts
git commit -m "$(cat <<'EOF'
Index class names and text entries inside JARs.

Keep path matches when class parsing or text caps fail.

EOF
)"
```

---

### Task 11: Classpath 解析规则

**Files:**
- Create: `src/classpath/parseClasspath.ts`
- Create: `src/classpath/gradle-classpath.init.gradle`
- Create: `src/classpath/resolveProcess.ts`
- Test: `src/classpath/parseClasspath.test.ts`
- Test: `src/classpath/resolveProcess.test.ts`

**Interfaces:**
- Consumes: `RESOLVE_TIMEOUT_MS`。
- Produces:
  - `parseMavenClasspath(output: string): string[]`
  - `parseGradleJars(output: string): string[]`
  - `mavenArgs(): string[]`
  - `gradleArgs(initScriptPath: string): string[]`
  - `siblingSourcesJar(jarPath: string): string | undefined`
  - `isRebuildPath(filePath: string): boolean`
  - `runTool(input: { cwd: string; command: string; args: string[]; timeoutMs: number }): Promise<{ timedOut: boolean; code: number | null; stdout: string; stderr: string }>`
  - `resolveFailed(result: { timedOut: boolean; code: number | null }): boolean`

- [ ] **Step 1: Write the failing test**

`src/classpath/parseClasspath.test.ts`

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { gradleArgs, isRebuildPath, mavenArgs, parseGradleJars, parseMavenClasspath, siblingSourcesJar } from "./parseClasspath";

test("parses classpath fixtures", () => {
  assert.deepEqual(parseMavenClasspath("/repo/a.jar|/repo/b.jar\n\n/repo/a.jar"), ["/repo/a.jar", "/repo/b.jar"]);
  assert.deepEqual(parseGradleJars("JAR\t/cache/a.jar\nERR\t:app\tcompileClasspath\tmissing\n"), ["/cache/a.jar"]);
  assert.ok(mavenArgs().includes("-DincludeScope=test"));
  assert.ok(mavenArgs().includes("-Dmdep.pathSeparator=|"));
  assert.deepEqual(gradleArgs("/ext/init.gradle"), ["-q", "-I", "/ext/init.gradle", "projects"]);
  assert.equal(siblingSourcesJar("/repo/gson-2.10.1.jar"), "/repo/gson-2.10.1-sources.jar");
  assert.equal(siblingSourcesJar("/repo/gson-2.10.1-sources.jar"), undefined);
  assert.equal(isRebuildPath("/app/gradle/libs.versions.toml"), true);
  assert.equal(isRebuildPath("/app/settings.gradle.kts"), true);
  assert.equal(isRebuildPath("/app/pom.xml"), true);
  assert.equal(isRebuildPath("/app/src/Main.java"), false);
});
```

`src/classpath/resolveProcess.test.ts`：

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFailed, runTool } from "./resolveProcess";

test("timeout marks the run failed", async () => {
  const result = await runTool({ cwd: process.cwd(), command: process.execPath, args: ["-e", "setTimeout(() => {}, 10000)"], timeoutMs: 200 });
  assert.equal(result.timedOut, true);
  assert.equal(resolveFailed(result), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p . --pretty false && node --test out/classpath/parseClasspath.test.js out/classpath/resolveProcess.test.js`

Expected: FAIL，找不到模块。

- [ ] **Step 3: Write minimal implementation**

`src/classpath/parseClasspath.ts`

```typescript
const REBUILD_NAMES = new Set(["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "gradle.properties"]);

export function parseMavenClasspath(output: string): string[] {
  const jars: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    for (const part of line.split("|")) {
      const trimmed = part.trim();
      if (trimmed.endsWith(".jar") && !jars.includes(trimmed)) jars.push(trimmed);
    }
  }
  return jars;
}

export function parseGradleJars(output: string): string[] {
  const jars: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith("JAR\t")) continue;
    const trimmed = line.slice(4).trim();
    if (!jars.includes(trimmed)) jars.push(trimmed);
  }
  return jars;
}

export function mavenArgs(): string[] {
  return ["-B", "-q", "dependency:build-classpath", "-DincludeScope=test", "-Dmdep.pathSeparator=|"];
}

export function gradleArgs(initScriptPath: string): string[] {
  return ["-q", "-I", initScriptPath, "projects"];
}

export function siblingSourcesJar(jarPath: string): string | undefined {
  if (!jarPath.endsWith(".jar") || jarPath.endsWith("-sources.jar")) return undefined;
  return `${jarPath.slice(0, -4)}-sources.jar`;
}

export function isRebuildPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.endsWith("/gradle/libs.versions.toml")) return true;
  return REBUILD_NAMES.has(normalized.split("/").pop() ?? "");
}
```

`src/classpath/resolveProcess.ts`

```typescript
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
```

`src/classpath/gradle-classpath.init.gradle`

```gradle
gradle.projectsEvaluated {
    rootProject.allprojects { project ->
        ["compileClasspath", "runtimeClasspath", "testCompileClasspath"].each { name ->
            def configuration = project.configurations.findByName(name)
            if (configuration != null && configuration.isCanBeResolved()) {
                try {
                    configuration.incoming.artifactView({ view ->
                        view.lenient(true)
                    }).files.each { file ->
                        if (file.name.endsWith(".jar")) {
                            println("JAR\t" + file.absolutePath)
                        }
                    }
                } catch (Exception error) {
                    println("ERR\t" + project.path + "\t" + name + "\t" + error.message)
                }
            }
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p . --pretty false && node --test out/classpath/parseClasspath.test.js out/classpath/resolveProcess.test.js`

Expected: PASS。超时测试大约 200 毫秒结束。

- [ ] **Step 5: Commit**

```bash
git add src/classpath/parseClasspath.ts src/classpath/parseClasspath.test.ts src/classpath/gradle-classpath.init.gradle src/classpath/resolveProcess.ts src/classpath/resolveProcess.test.ts
git commit -m "$(cat <<'EOF'
Parse Maven and Gradle classpaths without writing into the project.

Sibling sources jars and the build-file watch list follow the spec.

EOF
)"
```

---

### Task 12: 打开决定和状态句

**Files:**
- Create: `src/open/decideOpen.ts`
- Create: `src/status/statusText.ts`
- Test: `src/open/decideOpen.test.ts`
- Test: `src/status/statusText.test.ts`

**Interfaces:**
- Consumes: `SearchHit`、`findDeclarationLine`、`classEntryToSourceEntry`。
- Produces:
  - `decideOpen(input: DecideOpenInput): OpenPlan`
  - `OpenPlan = { type: "workspace"; uri: string; line?: number } | { type: "jar-text"; jarPath: string; entry: string; line?: number } | { type: "declaration"; jarPath: string; entry: string } | { type: "command"; commandId: string }`
  - `statusText(state: IndexStatus): string`
  - `IndexStatus = { hasFolder: boolean; updating: boolean; failed: boolean; hasPreviousIndex: boolean; unreadableCount: number }`

- [ ] **Step 1: Write the failing test**

`src/open/decideOpen.test.ts` 和 `src/status/statusText.test.ts` 使用下面的断言。工作区命中需要 `kind: "content"`、`uri: "file:///src/A.java"`、`line: 4`。依赖类命中的 `entry` 是 `com/foo/Outer$Inner.class`，`sourceText` 是 `"public class Outer {\n  class Inner {}\n"`。

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideOpen } from "./decideOpen";
import { SearchHit } from "../types";

function base(partial: Partial<SearchHit>): SearchHit {
  return { id: "1", kind: "file", title: "A", detail: "A", source: { type: "workspace" }, extension: ".java", stableIndex: 0, ...partial };
}

test("open decisions", () => {
  assert.deepEqual(decideOpen({ hit: base({ kind: "content", uri: "file:///src/A.java", line: 4 }) }), { type: "workspace", uri: "file:///src/A.java", line: 4 });
  assert.deepEqual(decideOpen({
    hit: base({ kind: "symbol", title: "Inner", source: { type: "jar", jarPath: "/a.jar" }, entry: "com/foo/Outer$Inner.class" }),
    sourcesJarPath: "/a-sources.jar",
    sourceText: "public class Outer {\n  class Inner {}\n",
  }), { type: "jar-text", jarPath: "/a-sources.jar", entry: "com/foo/Outer.java", line: 2 });
  assert.deepEqual(decideOpen({ hit: base({ kind: "symbol", source: { type: "jar", jarPath: "/a.jar" }, entry: "com/foo/User.class" }) }), { type: "declaration", jarPath: "/a.jar", entry: "com/foo/User.class" });
  assert.deepEqual(decideOpen({ hit: base({ kind: "command", detail: "workbench.action.quickOpen" }) }), { type: "command", commandId: "workbench.action.quickOpen" });
});
```

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { statusText } from "./statusText";

const idle = { hasFolder: true, updating: false, failed: false, hasPreviousIndex: false, unreadableCount: 0 };

test("status priority", () => {
  assert.equal(statusText({ ...idle, hasFolder: false, failed: true }), "没有打开的文件夹");
  assert.equal(statusText({ ...idle, updating: true }), "正在更新依赖索引");
  assert.equal(statusText({ ...idle, failed: true, hasPreviousIndex: true }), "依赖解析失败，仍使用上一份索引");
  assert.equal(statusText({ ...idle, failed: true }), "依赖包暂不可搜");
  assert.equal(statusText({ ...idle, unreadableCount: 3 }), "3 个依赖包无法读取");
  assert.equal(statusText(idle), "");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p . --pretty false && node --test out/open/decideOpen.test.js out/status/statusText.test.js`

Expected: FAIL，找不到模块。

- [ ] **Step 3: Write minimal implementation**

`src/open/decideOpen.ts`

```typescript
import { classEntryToSourceEntry, findDeclarationLine } from "../jar/sourcePath";
import { SearchHit } from "../types";

export type OpenPlan =
  | { type: "workspace"; uri: string; line?: number }
  | { type: "jar-text"; jarPath: string; entry: string; line?: number }
  | { type: "declaration"; jarPath: string; entry: string }
  | { type: "command"; commandId: string };

export function decideOpen(input: { hit: SearchHit; sourcesJarPath?: string; sourceText?: string }): OpenPlan {
  const hit = input.hit;
  if (hit.kind === "command") return { type: "command", commandId: hit.detail };
  if (hit.source.type === "workspace") return { type: "workspace", uri: hit.uri ?? "", line: hit.line };
  if (hit.kind === "content" && hit.entry) return { type: "jar-text", jarPath: input.sourcesJarPath ?? hit.source.jarPath ?? "", entry: hit.entry, line: hit.line };
  if (input.sourceText && input.sourcesJarPath && hit.entry) {
    const line = findDeclarationLine(input.sourceText, hit.title);
    return { type: "jar-text", jarPath: input.sourcesJarPath, entry: classEntryToSourceEntry(hit.entry), ...(line === undefined ? {} : { line }) };
  }
  return { type: "declaration", jarPath: hit.source.jarPath ?? "", entry: hit.entry ?? "" };
}
```

`src/status/statusText.ts`

```typescript
export interface IndexStatus { hasFolder: boolean; updating: boolean; failed: boolean; hasPreviousIndex: boolean; unreadableCount: number; }

export function statusText(state: IndexStatus): string {
  if (!state.hasFolder) return "没有打开的文件夹";
  if (state.updating) return "正在更新依赖索引";
  if (state.failed && state.hasPreviousIndex) return "依赖解析失败，仍使用上一份索引";
  if (state.failed) return "依赖包暂不可搜";
  if (state.unreadableCount > 0) return `${state.unreadableCount} 个依赖包无法读取`;
  return "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p . --pretty false && node --test out/open/decideOpen.test.js out/status/statusText.test.js`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/open/decideOpen.ts src/open/decideOpen.test.ts src/status/statusText.ts src/status/statusText.test.ts
git commit -m "$(cat <<'EOF'
Decide how a hit opens and which status line to show.

Source jars win over class declarations, and status text follows a fixed priority.

EOF
)"
```

---

### Task 13: 把依赖索引接进现有提供者

**Files:**
- Modify: `src/extension.ts`
- Create: `src/host/dependencySearch.ts`
- Test: `src/host/dependencySearch.test.ts`

**Interfaces:**
- Consumes: `IndexedJar`、`matchFiles`、`matchDependencyClasses`、`rankHits`、`contentRgArgs`、`parseRgMatches`、`TAB_CAP`。
- Produces:
  - `dependencyFileHits(jars: IndexedJar[], query: SearchQuery): SearchHit[]`
  - `dependencySymbolHits(jars: IndexedJar[], query: SearchQuery): SearchHit[]`
  - `dependencyContentRecords(jars: IndexedJar[]): { jarPath: string; jarName: string; entry: string; text: string; truncated: boolean }[]`

命中 `id` 使用 `jar-file:${jarPath}!${entry}`、`jar-class:${jarPath}!${entry}`、`jar-content:${jarPath}!${entry}:${line}`。`extension` 来自条目后缀。`.class` 的符号命中设置 `treatAsJava: true`。文本被截断的命中设置 `textTruncated: true`。

- [ ] **Step 1: Write the failing test**

用一个内存中的 `IndexedJar`：一个 `com/example/User.class`，一个未截断的 `meta/app.xml` 文本 `<app>User</app>`。查询 `{ terms: ["User"], extensions: [] }` 同时得到符号命中和内容命中。查询 `{ terms: [], extensions: [".xml"] }` 只得到 xml 文件名命中。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p . --pretty false && node --test out/host/dependencySearch.test.js`

Expected: FAIL，找不到模块。

- [ ] **Step 3: Write minimal implementation**

`src/host/dependencySearch.ts` 导出 `dependencyFileHits`、`dependencySymbolHits`、`dependencyContentHits`。文件名命中来自 `classes`、`texts` 和 `paths`，`kind` 是 `"file"`，标题是条目最后一段，detail 是条目路径。符号命中只来自 `classes`，`treatAsJava: true`，`extension: ".class"`，标题是 `simpleName`，detail 是 `binaryName`，id 是 `jar-class:${jarPath}!${entry}`。内容命中扫描 `texts[].text` 的每一行；搜索词都要出现在同一行，大小写不敏感；没有搜索词时返回空数组。`textTruncated` 取自 `TextRecord.truncated`。三个函数最后都调用 `rankHits`。

在 `src/extension.ts` 增加 `let dependencyJars: IndexedJar[] = []`。`searchFiles` 返回工作区命中再接上 `dependencyFileHits`。`searchSymbols` 在搜索词为空时不调用工作区符号提供者，但仍返回 `dependencySymbolHits`。`searchContent` 返回工作区 ripgrep 命中再接上 `dependencyContentHits`。任务 14 之前 `dependencyJars` 保持空数组。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p . --pretty false && node --test out/host/dependencySearch.test.js && npx tsc -p . --pretty false`

Expected: PASS，并且 `extension.ts` 仍能编译。

- [ ] **Step 5: Commit**

```bash
git add src/host/dependencySearch.ts src/host/dependencySearch.test.ts src/extension.ts
git commit -m "$(cat <<'EOF'
Feed dependency entries through the same file, symbol, and content hits.

An empty dependency index leaves workspace search unchanged.

EOF
)"
```

---

### Task 14: 依赖刷新、打开文档和错误通道

**Files:**
- Modify: `src/extension.ts`
- Create: `src/host/refreshDependencies.ts`
- Test: `src/host/refreshDependencies.test.ts`

**Interfaces:**
- Consumes: `runTool`、`resolveFailed`、`mavenArgs`、`gradleArgs`、`parseMavenClasspath`、`parseGradleJars`、`siblingSourcesJar`、`readZip`、`indexJarEntries`、`sameJarIdentity`、`isRebuildPath`、`decideOpen`、`statusText`、`RESOLVE_TIMEOUT_MS`、`FILE_TEXT_CAP`、`JAR_TEXT_CAP`、`REBUILD_DEBOUNCE_MS`。
- Produces:
  - `refreshDependencyIndex(input: RefreshInput): Promise<RefreshOutcome>`
  - `RefreshOutcome = { jars: IndexedJar[]; failed: boolean; hasPreviousIndex: boolean; unreadableCount: number; log: string }`

`RefreshInput` 包含 `workspaceRoots: string[]`、`previous: IndexedJar[]`、`run: typeof runTool`、`readFile: (path: string) => Buffer | undefined`、`stat: (path: string) => { mtimeMs: number; size: number } | undefined`、`exists: (path: string) => boolean`、`which: (command: string) => boolean`、`initScriptPath: string`。测试注入这些函数，不启动 Maven 或 Gradle。

- [ ] **Step 1: Write the failing test**

用假的 `run` 返回 Maven 输出 `/repo/a.jar|/missing.jar`。`exists("/repo/a.jar")` 为 true，`exists("/missing.jar")` 为 false。`exists("/repo/a-sources.jar")` 为 true。`stat` 对 `/repo/a.jar` 返回稳定的 mtime 和 size。`readFile("/repo/a.jar")` 返回任务 10 能读取的 ZIP。

断言第一次刷新：`failed === false`，`jars.length === 1`，`unreadableCount === 1`。

第二次用同一 `stat` 再刷新，`readFile` 计数不再增加。

把 `run` 改成 `{ timedOut: true, code: null, stdout: "", stderr: "" }` 且已有 previous 时，`failed === true`，返回的 `jars` 仍是 previous。

`which("mvn") === false` 且没有 `mvnw` 时，`failed === true`，`log` 包含 `mvn`。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p . --pretty false && node --test out/host/refreshDependencies.test.js`

Expected: FAIL，找不到模块。

- [ ] **Step 3: Write minimal implementation**

`refreshDependencyIndex` 对每个工作区根目录：

- 根目录有 `mvnw` 就用它，否则 `which("mvn")` 为真时用 `mvn`。Gradle 对 `gradlew` 和 `gradle` 用同一规则。
- 有 `pom.xml` 才运行 Maven。有 `build.gradle`、`build.gradle.kts` 或 `settings.gradle` 才运行 Gradle。
- 工具不存在且该根目录需要它时，记失败日志，不抛出异常。
- `resolveFailed` 时保留 `previous`，`failed = true`。
- JAR 不存在或 `readZip` / `indexJarEntries` 抛错时 `unreadableCount += 1`，日志写入 JAR 路径和错误消息，继续处理下一个。
- `sameJarIdentity` 为真时复用 previous 里的 `IndexedJar`，不调用 `readFile`。
- sources JAR 只在 `siblingSourcesJar` 指向的文件存在时读取，并把它的 `.java` 和文本并入对应二进制 JAR 的 `texts`。不把 sources JAR 当成第二个类索引。

`src/extension.ts` 在激活后调用刷新，不阻塞面板打开。`searchEverywhere.refreshDependencies` 调用同一函数。文件监听使用 `isRebuildPath`，`REBUILD_DEBOUNCE_MS` 毫秒内多次变化只刷新一次。刷新期间状态使用 `statusText({ hasFolder: true, updating: true, failed: false, hasPreviousIndex: outcome.jars.length > 0, unreadableCount: 0 })`。`searchFiles` 和 `searchContent` 遍历每一个 `workspaceFolders`，不能只查第一个文件夹。

打开命中时调用 `decideOpen`。`jar-text` 和 `declaration` 用 `vscode.workspace.registerTextDocumentContentProvider`。scheme 分别是 `se-jar` 和 `se-decl`。两种文档都不注册写回 JAR 的保存逻辑。`.java` 的 language id 是 `java`，`.xml` 是 `xml`，其余文本是 `plaintext`。打开前关闭面板。失败时 `showErrorMessage`，面板保持关闭。

创建输出通道 `Search Everywhere`，写入 `RefreshOutcome.log`。

没有 `workspaceFolders` 时不刷新，状态使用 `statusText` 的无文件夹句子。命令搜索仍可用。

`readCommands` 改为先放 `contributes.commands` 的标题，再把 `vscode.commands.getCommands(true)` 返回而标题表里没有的 ID 追加进去。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS，包含本任务和此前全部单元测试。

- [ ] **Step 5: Commit**

```bash
git add src/host/refreshDependencies.ts src/host/refreshDependencies.test.ts src/extension.ts
git commit -m "$(cat <<'EOF'
Refresh the dependency index and open jar-backed documents.

Failed resolves keep the previous index, and unreadable jars are counted without stopping the rest.

EOF
)"
```

---

### Task 15: 手工确认规格里不能用单元测试代替的行为

**Files:**
- Modify: 无，除非手工确认发现前一任务的偏差。修偏差时补一个失败测试，再改实现。

**Interfaces:**
- Consumes: 任务 14 的可运行扩展。
- Produces: 无新接口。

- [ ] **Step 1: 启动扩展开发主机**

在 VS Code 中打开本仓库，选择 `Run Extension`。新窗口里打开一个含多模块 `pom.xml` 或 Gradle 构建的 Java 工作区。

- [ ] **Step 2: 核对面板**

双击 Shift。预期打开一个编辑器组里的 Search Everywhere 面板，而不是第二个面板。输入为空时看到 `输入关键词，用 .java 或 *.java,*.xml 按后缀过滤。`

输入 `User .java`。全部标签按文件名、符号、命令、内容的顺序显示，每组最多 8 条。写了后缀后没有命令结果。Tab 和 Shift+Tab 在四个标签间切换，Esc 关闭。

- [ ] **Step 3: 核对打开和依赖**

回车打开工作区文件时跳到命中行，面板关闭。依赖类有 sources 时打开 `.java`；内部类打开外部类文件。只有 `.class` 时看到包名、类头和方法签名，没有方法体。

构建工具不在 PATH 且项目没有 wrapper 时，工作区搜索仍可用，状态是 `依赖包暂不可搜` 或 `依赖解析失败，仍使用上一份索引`。输出通道 `Search Everywhere` 能看到解析日志。

- [ ] **Step 4: 记录偏差**

某一条不符合 `docs/superpowers/specs/2026-11-01-search-everywhere-design.md` 时，先补单元测试锁住该行为，再改对应模块。不要在这一步放宽规格。

- [ ] **Step 5: Commit**

只有步骤 4 产生了代码改动才提交。提交说明写偏差的原因，不写“手工测试通过”。

---

## Spec coverage

- 查询解析、后缀、空输入：任务 1、6。
- 排序、`.java` / `.class`、命令被后缀排除：任务 2、3、5。
- 分组限额、内容失败、过期结果：任务 3、6。
- 工作区文件名、gitignore、ripgrep 内容：任务 4、6、7。
- 符号和命令：任务 5、6、14。
- 双击 Shift、四个标签、200 毫秒内容搜索：任务 6。
- class 声明和泛型签名：任务 8。
- 内部类源码路径：任务 9、12。
- JAR 文本、1 MB、50 MB、损坏 class：任务 10。
- Maven、Gradle、sources、监听文件、3 分钟超时：任务 11、14。
- 打开规则和状态句：任务 12、14。
- 依赖命中进入同一面板：任务 13、14。
- 输出通道、刷新命令、无文件夹：任务 14。
- 多模块真实项目和双击 Shift 是否被编辑器送达：任务 15。
