# 文件搜索改用 OpenIdea 的匹配实现

日期：2026-11-02

## 目的

把 `search-everywhere` 插件的文件搜索对齐 OpenIdea 的 `find_files`：同一套排序、`目录/文件名` 查询、`文件名:行:列`、驼峰匹配、最近文件加分。排序代码只有一份，跑在 OpenIdea 仓库里，插件通过 WASM 调用它。

本文只改文件名搜索这一条路径。符号、命令、内容搜索的规则、面板布局和打开逻辑都不变。

## 范围

- 新建 `openidea/crates/ide-file-search`，存放与平台无关的文件匹配。桌面端的 `ide-index` 改为调用它，插件调用同一份代码编出的 WASM。
- 插件改为维护一份文件名单：全量重建、单个增删改、最近文件。
- 插件解析 `:行:列`，按后缀过滤（过滤在取前 K 之前），合并工作区与 JAR 结果。
- WASM 不可用时退回现有的 TypeScript 匹配。

以下不做：

- 不把符号索引、内容索引、JAR 解压搬进 WASM。
- 不引入后台线程、持久化数据库或文件读取到 WASM。
- 不改符号、命令、内容的匹配与排序。
- 不改限额数字：全部标签每组 8 条，文件标签 100 条。
- 不改命令 ID、键位、面板结构与中文文案。

## 与旧规格的差异

`2026-11-01-search-everywhere-design.md` 里「空查询不列出最近文件」这一条，对文件搜索失效：空查询在「全部」和「文件」标签列出最近打开的文件，最多 50 条。其他标签空查询仍为空。旧规格其余条款继续有效。

旧规格的三档（完全、前缀、包含）改为下面「排序」一节的档位与加分。文件行的匹配档不再由 `rankHits` 计算。

## 架构

```
openidea/crates/ide-file-search      ← 唯一的匹配实现（纯 Rust，无 IO）
        ├── ide-index 桌面端调用（rayon 并行扫描）
        └── wasm 目标 → 预编译产物 → 插件 vendor/wasm
```

`ide-file-search` 只接收「路径列表 + 查询 + 限额」，返回命中路径、匹配下标、分数。它不含读盘、线程、缓存和持久化。桌面端的并行扫描、`redb` 缓存、`ignore` 遍历留在 `ide-index`；WASM 目标改成单线程顺序扫描。

WASM 目标为 `wasm32-unknown-unknown`，绑定用 `wasm-bindgen`，JS 侧目标 `nodejs`（扩展宿主是 Node）。`rayon` 用 `#[cfg(not(target_arch = "wasm32"))]` 保留在 `ide-index`，不进入 `ide-file-search`。

产物提交在插件仓库 `vendor/wasm/`（`.wasm` 与加载器），由 `npm run build:wasm` 生成，指向本地 OpenIdea 检出。理由：安装扩展的用户没有 Rust 工具链，`.vsix` 必须自带二进制。升级 OpenIdea 时重跑该脚本并一起提交。

### 模块边界

| 模块 | 职责 |
| --- | --- |
| `ide-file-search` | 掩码预过滤、nucleo 打分、文件名/路径档、驼峰加分、最近文件加分、取前 K、返回匹配下标 |
| 插件 `src/search/wasmFileSearch.ts` | 加载 WASM、把名单与查询转成调用、错误捕获与退回开关 |
| 插件 `src/workspace/fileIndex.ts` | 维护名单：全量重建、单条增删、多根前缀 |
| 插件 `src/workspace/recentFiles.ts` | 50 条最近文件，写工作区存储，监听编辑器切换 |
| 插件 `src/query/fileQuery.ts` | 抽后缀词、解析 `:行:列`、把剩余文字交给 WASM |
| 插件 `src/extension.ts` | 组合上述模块，产出 `SearchHit`，其余不变 |

`wasmFileSearch` 与 `fileIndex`、`recentFiles` 不导入 `vscode`，可在 `node:test` 里直接测。

### WASM 接口

单向函数调用，返回值是 JSON 字符串，由 TypeScript 解析。不引入 `serde-wasm-bindgen`，保持绑定面最小。

| 导出 | 说明 |
| --- | --- |
| `set_workspace_files(json)` | 整份替换工作区名单。元素为 `{ key, rel, library }` |
| `upsert_files(json)` | 增改若干条目 |
| `remove_files(json)` | 删除若干 key |
| `set_recents(json)` | 50 条 key，最新的在前 |
| `find_files(query, limit, extensions)` | 返回 `{ hits: [{ key, rel, score, indices }], total }` |
| `list_by_extension(extensions, limit)` | 只有后缀、没有搜索文字时用；按名单顺序列出该后缀条目，不看最近文件 |

`extensions` 为空表示不过滤；否则只保留后缀命中的条目（依赖类按 `.java` 处理，与现在一致）。过滤在打分循环内完成，因此 `limit` 个名额总是由合规条目填满。

`total` 是合规且命中的条目数，用来判断「还有更多」。`indices` 是字符下标，指向 `rel`。

## 查询

文件搜索先按旧规则抽走后缀词（`.java`、`*.java,*.xml`），再把剩下的文字交给 `find_files`。WASM 内部的规整与 OpenIdea 相同：

- 反斜杠改斜杠，去掉全部空白：`User Service` 与 `UserService` 是同一次查询。
- 去掉开头的 `./` 和 `/`。
- 末尾的 `:行`、`:行:列` 不参与匹配。插件在调用 WASM 前切出，WASM 只看到路径文字；作为兜底，`find_files` 也会剥掉同样的后缀。行、列从 1 起算，转成 0 起，写入本次所有文件命中的 `hit.line`。`Button.tsx:12` 按 `Button.tsx` 搜索并打开到第 12 行。
- 含 `/` 时按最后一个 `/` 切开：前段匹配目录，后段匹配文件名。以 `/` 结尾则只匹配目录。`ui/btn` 命中「目录含 `ui`、文件名含 `btn`」的文件。
- 只有后缀、没有搜索文字：不做模糊匹配，列出该后缀的条目，不看最近文件。
- 搜索文字与后缀都为空：文件组只列最近文件。

`User.java` 整词仍是一个搜索词，不是后缀过滤，和现在一致。

## 排序

常量与 OpenIdea 共用，插件不另存一份：

- `TIER_NAME` 把文件名命中整体抬到路径命中之上。
- 文件名精确、去扩展名后精确、文件名前缀三档，大小写完全一致再加一档。
- nucleo 的模糊分；驼峰、分隔符后的词首、首字符对齐另有加分。
- 最近文件加分 `RECENT_MAX - 排名 × 12`，按 key 在最近列表中的位次。

结果先按总分降序；同分时相对路径短的在前，再按路径字符串排序。工作区与 JAR 各在自己的名单里取前 K，合并后再截到 `limit`；分数相同时工作区在前。

因此 `US` 同时命中 `UserService.java` 与 `userservice.java`，驼峰那条靠前——与现在「大写必须对上驼峰、否则不命中」不同，这是本次要引入的行为。`OCo` 命中 `OrderController.java` 与 `OtherCollection.ts`。

## 最近文件

- 最多 50 条，存于工作区存储的 `searchEverywhere.recentFiles`，最新的在前。
- 来源：当前编辑器切换、从搜索结果打开文件。未保存的编辑器不记录。
- 记录名单里的 key（`文件夹名/相对路径`），不是展示用的短路径。
- 查询时丢弃已不在名单里的 key，并把它从存储里顺手删掉。
- 空查询按最近顺序列出，最多 `ALL_GROUP_CAP` 或 `TAB_CAP` 条。

## 索引更新

### 工作区名单

全量重建沿用现在的 ripgrep `--files`，尊重 `files.exclude`、`search.exclude`、`.gitignore`。触发时机：首次启动、切换工作区文件夹、改 exclude 配置、改 `.gitignore` 或 `.git/info/exclude`。这些事件等 300 毫秒合并成一次；重建完成前搜索继续用上一份名单，完成后整份换入。

单个创建、删除、重命名不扫整棵树：

- 删除立刻 `remove_files`。
- 新建与改名后的路径用一次 `rg --files --` 加这几个路径确认；有输出就 `upsert_files`，没有输出说明被忽略，丢弃。
- 300 毫秒窗口内积压超过 50 个路径时，改为全量重建。
- 文件内容变化不更新名单。

多根工作区用 `文件夹名/相对路径` 作为 key 与展示路径；只有一个文件夹时展示路径与现在相同。

### 依赖名单

重建时机不变（启动时读上次索引，构建文件变化 1 秒后解析）。解析完成后把每个 JAR 的类、文本、路径条目整份换入库名单（`library: true`）。同一 JAR 内重复条目只留一条；不同 JAR 的相同路径都保留。命中 `文本不完整` 的标记留在插件侧，不参与打分。

## 失败时

WASM 在激活时加载一次。加载失败或某次调用抛错时：

- 写输出通道 `Search Everywhere`，本次会话的文件搜索改用现有 `matchFiles` + `rankHits`。
- `:行:列` 与最近文件列表仍然生效。最近文件进入普通打分，不加 `RECENT_MAX` 分；空查询仍按最近顺序列出，此时不走打分段，因此退回路径也保留这个行为。
- 符号、命令、内容搜索不受影响。
- 名单换入失败时保留上一份，不清空。
- 退回后大仓库仍可能先按索引顺序截断再排序，这是已知退化，输出通道里写明一次。

没有打开文件夹时行为不变：只提供命令搜索，状态为「没有打开的文件夹」。

## 高亮与打开

文件行的高亮改用 WASM 返回的 `indices`，落在展示路径上。符号、命令、内容继续用 `highlightRanges`。

打开逻辑不变：工作区文件走原 URI，JAR 条目走 `se-jar` 只读文档，行号沿用 `hit.line`。`decideOpen` 不改。

## 限额

沿用现有数字，新增三个：

| 名称 | 值 |
| --- | --- |
| `RECENT_LIMIT` | 50 |
| `FILE_INDEX_DEBOUNCE_MS` | 300 |
| `FILE_BATCH_LIMIT` | 50 |

## 测试

`ide-file-search`（Rust，`cargo test`）锁住这些结果：

- 文件名命中排在只有路径命中的文件之前。
- `ui/btn` 按目录＋文件名命中；`src/order/` 只按目录。
- `Button.tsx:12` 与 `Button.tsx:12:5` 剥掉位置后命中同一个文件。
- `OCo`、`OrCo`、`ordcon` 都能命中 `OrderController`。
- `US` 同时命中驼峰与非驼峰文件名，驼峰在前。
- 相对路径短的在前；最近文件加分后能超过更短的路径。
- 空查询返回最近文件顺序。
- 后缀过滤在取前 K 之前生效：前 100 个命中里全部是目标后缀。
- `indices` 指向相对路径中的正确字符。

桌面端 `ide-index` 的现有排序测试在改为调用新 crate 后必须继续通过（`file_ranking_is_idea_like`、`shorter_paths_win_ties_and_recent_files_boost` 等）。

插件（`node:test`，不启动 VS Code）：

- `fileQuery`：后缀与搜索词拆分、`:行`、`:行:列`、Windows 路径、空输入。
- `fileIndex`：全量重建换入、删除立刻生效、批量创建超过 50 条转全量、单文件夹与多文件夹的 key 形态。
- `recentFiles`：去重、满 50 条挤掉最旧、丢弃已删除的 key。
- `wasmFileSearch`：WASM 缺失或抛错时退回 `matchFiles`，且行号仍写入 `hit.line`；工作区与 JAR 同分时工作区在前。

手工确认（扩展开发主机）：

- 双击 Shift 打开面板；空输入看到最近文件；打开几个文件后顺序变化。
- `ui/btn`、`Button.tsx:12` 打开到正确位置。
- 改 `.gitignore` 后名单在约 1 秒内更新。
- 删掉 `vendor/wasm` 后文件搜索仍可用，输出通道出现退回记录。
- 多根工作区里同名的文件可区分。

## 实施顺序

1. 在 OpenIdea 建 `ide-file-search`，把 `matching.rs` 的文件部分与 `char_mask`、`Needle` 搬进去；`ide-index` 改为调用；桌面端测试通过。
2. 给该 crate 加 `wasm-bindgen` 导出与 JSON 协议；`wasm-pack build --target nodejs` 产出可加载模块。
3. 插件加 `vendor/wasm/`、`wasmFileSearch`、`fileQuery`，文件搜索改走 WASM，保留 `matchFiles` 作为退回路径。
4. 插件加 `fileIndex`：全量重建、单条增删、批量阈值；替换现有的 `workspaceFiles` 与 `scheduleFileIndex`。
5. 插件加 `recentFiles` 与空查询列表。
6. 高亮改用 `indices`，更新测试与文档。
