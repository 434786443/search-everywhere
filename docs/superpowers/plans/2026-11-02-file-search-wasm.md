# File Search via OpenIdea WASM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `search-everywhere` 插件的文件名搜索换成 OpenIdea 的 `find_files` 实现，通过 WASM 在扩展宿主里调用，排序、`目录/文件名`、`文件名:行:列`、驼峰和最近文件与 OpenIdea 一致。

**Architecture:** OpenIdea 里新建纯 Rust crate `ide-file-search`（无 IO、无线程），桌面端 `ide-index` 与插件的 WASM 共用这一份匹配代码。插件只负责列文件、增量维护名单、解析后缀与 `:行:列`、合并工作区与 JAR 结果；WASM 不可用时退回现有 `matchFiles`。

**Tech Stack:** Rust 2024 edition（`wasm-bindgen`、`nucleo-matcher`）、TypeScript 5、Node 22+、`node:test`、VS Code 引擎 `^1.85.0`、`@vscode/ripgrep`。

## Global Constraints

- 规格文档：`docs/superpowers/specs/2026-11-02-file-search-wasm-design.md`（本计划的唯一事实来源）。
- 只改文件名搜索。符号、命令、内容搜索的匹配与排序、面板布局、打开逻辑、命令 ID、键位、中文文案都不改。
- 限额不变：全部标签每组 8 条（`ALL_GROUP_CAP`），文件标签 100 条（`TAB_CAP`）。新增 `RECENT_LIMIT = 50`、`FILE_INDEX_DEBOUNCE_MS = 300`、`FILE_BATCH_LIMIT = 50`。
- 分数常量与 OpenIdea 共用，插件不复制一份：`TIER_NAME = 1 << 20`、`EXACT = 4000`、`EXACT_STEM = 3000`、`PREFIX = 600`、`CASE_EXACT = 200`、`HUMP = 12`、`FIRST_AT_START = 40`、`RECENT_MAX = 900`。
- 最近文件存键 `searchEverywhere.recentFiles`，最多 50 条，最新的在前。
- 依赖条目的 `.class` 在后缀过滤里按 `.java` 处理，与现有 `matchesExtension` 一致。
- 退回时写输出通道 `Search Everywhere`，每次会话只写一次。
- 插件纯模块（`src/query/`、`src/workspace/`、`src/search/`）不导入 `vscode`，测试用 `node:test` 且不启动 VS Code。
- Rust 侧 `cargo test` 必须与桌面端原有排序测试同时通过；`ide-index` 的公开 API 不变。
- 提交信息用英文祈使句，一次任务一次提交。

---

## File structure

OpenIdea（`/Users/benghiong/Documents/Code/openidea`）：

- Create `crates/ide-file-search/Cargo.toml` — 纯匹配 crate，依赖 `nucleo-matcher`、`serde`、`serde_json`；WASM 目标加 `wasm-bindgen`。
- Create `crates/ide-file-search/src/lib.rs` — 名单结构 `FileSet`，以及 `find_files` / `list_by_extension` 的纯函数入口。
- Create `crates/ide-file-search/src/mask.rs` — `char_mask`（从 `ide-index/src/data.rs` 移入）。
- Create `crates/ide-file-search/src/query.rs` — `normalize_file_query`、`FileQuery`、`Needle`（从 `ide-index/src/matching.rs` 移入）。
- Create `crates/ide-file-search/src/score.rs` — `TIER_NAME` 等常量、`hump_bonus`、`base_file_score`、`file_indices`。
- Create `crates/ide-file-search/src/wasm.rs` — `wasm-bindgen` 导出与 JSON 协议，仅 `target_arch = "wasm32"` 编译。
- Create `crates/ide-file-search/tests/ranking.rs` — 规格里列出的排序断言。
- Modify `crates/ide-index/Cargo.toml` — 加 `ide-file-search` 依赖。
- Modify `crates/ide-index/src/matching.rs` — 删除已移走的文件匹配部分，改为调用 `ide_file_search`；符号部分保留。
- Modify `crates/ide-index/src/data.rs` — `char_mask` 改为 re-export。
- Modify `Cargo.toml`（workspace）— 注册 `ide-file-search` 成员。

插件（`/Users/benghiong/Documents/Code/vscode-plugin`）：

- Create `scripts/build-wasm.ts` — 调 `wasm-pack build`，产物复制到 `vendor/wasm/`。
- Create `vendor/wasm/` — 提交的 `.wasm` 与 JS 加载器（由 Task 3 生成）。
- Create `src/search/wasmFileSearch.ts` — 加载 WASM、名单同步、查询、退回开关。
- Create `src/workspace/fileIndex.ts` — 名单维护：全量重建、单条增删、批量阈值、多根 key。
- Create `src/workspace/recentFiles.ts` — 50 条最近文件与编辑器监听（纯逻辑部分）。
- Create `src/query/fileQuery.ts` — 抽后缀、解析 `:行:列`。
- Modify `src/extension.ts` — 接线，替换 `workspaceFiles` / `scheduleFileIndex` / `searchFiles`，高亮改用 `indices`。
- Modify `src/limits.ts` — 三个新常量。
- Modify `src/types.ts` — `SearchHit.titleRanges`、`detailRanges`。
- Modify `src/workspace/matchFiles.ts` — 保留为退回路径，签名不变。
- Create `src/search/wasmFileSearch.test.ts`、`src/workspace/fileIndex.test.ts`、`src/workspace/recentFiles.test.ts`、`src/query/fileQuery.test.ts`。

---

### Task 0: 安装 Rust 与 WASM 工具链

**Files:** 无仓库文件改动。

**Interfaces:**
- Consumes: 无。
- Produces: 可用的 `cargo`、`rustc`、`wasm-pack`，以及 `wasm32-unknown-unknown` target。

- [ ] **Step 1: 确认工具链确实缺失**

Run: `command -v cargo rustc wasm-pack`
Expected: 三者都无输出（本机当前状态）。

- [ ] **Step 2: 安装 rustup 与 stable 工具链**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
source "$HOME/.cargo/env"
```

Run: `cargo --version`
Expected: `cargo 1.9x.0` 或更高。

- [ ] **Step 3: 安装 wasm target 与 wasm-pack**

```bash
rustup target add wasm32-unknown-unknown
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
```

Run: `wasm-pack --version && rustup target list --installed`
Expected: `wasm-pack 0.1x.x`，且列表包含 `wasm32-unknown-unknown`。

- [ ] **Step 4: 确认 OpenIdea 桌面端基线可编译**

Run: `cd /Users/benghiong/Documents/Code/openidea && cargo test -p ide-index --lib`
Expected: 全部通过。这是 Task 1 的对照基线；若已失败，先修好再继续。

---

### Task 1: 抽出 `ide-file-search`，桌面端改为调用

**Files:**
- Create: `openidea/crates/ide-file-search/Cargo.toml`
- Create: `openidea/crates/ide-file-search/src/lib.rs`
- Create: `openidea/crates/ide-file-search/src/mask.rs`
- Create: `openidea/crates/ide-file-search/src/query.rs`
- Create: `openidea/crates/ide-file-search/src/score.rs`
- Create: `openidea/crates/ide-file-search/tests/ranking.rs`
- Modify: `openidea/Cargo.toml`（workspace members 与 workspace.dependencies）
- Modify: `openidea/crates/ide-index/Cargo.toml`
- Modify: `openidea/crates/ide-index/src/matching.rs`
- Modify: `openidea/crates/ide-index/src/data.rs`

**Interfaces:**
- Consumes: 无（本任务定义契约）。
- Produces:
  - `pub struct FileSet`，含 `push(key: &str, rel: &str, library: bool)`、`clear()`、`replace_all(entries: Vec<Entry>)`。
  - `pub struct Entry { pub key: String, pub rel: String, pub library: bool }`
  - `pub struct FileHit { pub key: String, pub rel: String, pub score: u32, pub indices: Vec<u32> }`
  - `pub fn find_files(set: &FileSet, recents: &[String], query: &str, limit: usize, extensions: &[String]) -> (Vec<FileHit>, usize)`
  - `pub fn list_by_extension(set: &FileSet, extensions: &[String], limit: usize) -> (Vec<FileHit>, usize)`
  - `pub fn normalize_file_query(q: &str) -> String`

- [ ] **Step 1: 写失败的排序测试**

Create `openidea/crates/ide-file-search/tests/ranking.rs`:

```rust
use ide_file_search::{find_files, list_by_extension, Entry, FileSet};

fn set(paths: &[&str]) -> FileSet {
    let mut s = FileSet::default();
    for p in paths {
        s.push(p, p, false);
    }
    s
}

fn rels(hits: &[ide_file_search::FileHit]) -> Vec<String> {
    hits.iter().map(|h| h.rel.clone()).collect()
}

#[test]
fn file_name_matches_beat_directory_matches() {
    let s = set(&["docs/maintenance.md", "src/main.rs"]);
    let (hits, _) = find_files(&s, &[], "main", 10, &[]);
    assert_eq!(rels(&hits), vec!["src/main.rs", "docs/maintenance.md"]);
}

#[test]
fn path_query_splits_dir_and_name() {
    let s = set(&["src/ui/Button.tsx", "ui/other.txt", "src/order/Order.java"]);
    let (hits, _) = find_files(&s, &[], "ui/btn", 10, &[]);
    assert_eq!(rels(&hits), vec!["src/ui/Button.tsx"]);
    let (dirs, _) = find_files(&s, &[], "src/order/", 10, &[]);
    assert!(dirs.iter().all(|h| h.rel.starts_with("src/order/")));
}

#[test]
fn position_suffix_is_stripped() {
    let s = set(&["src/ui/Button.tsx"]);
    let (hits, _) = find_files(&s, &[], "Button.tsx:12", 10, &[]);
    assert_eq!(rels(&hits), vec!["src/ui/Button.tsx"]);
    let (hits, _) = find_files(&s, &[], "Button.tsx:12:5", 10, &[]);
    assert_eq!(rels(&hits), vec!["src/ui/Button.tsx"]);
}

#[test]
fn camel_hump_matches() {
    let s = set(&["src/order/OrderController.java", "src/other/OtherCollection.ts"]);
    for q in ["OCo", "OrCo", "ordcon"] {
        let (hits, _) = find_files(&s, &[], q, 10, &[]);
        assert_eq!(rels(&hits)[0], "src/order/OrderController.java", "query {q}");
    }
}

#[test]
fn upper_case_query_also_matches_flat_names() {
    let s = set(&["userservice.java", "UserService.java"]);
    let (hits, _) = find_files(&s, &[], "US", 10, &[]);
    assert_eq!(rels(&hits).len(), 2);
    assert_eq!(rels(&hits)[0], "UserService.java");
}

#[test]
fn shorter_paths_win_ties_and_recent_files_boost() {
    let s = set(&["a/b/c/util.rs", "x/util.rs", "y/util.rs"]);
    let (hits, _) = find_files(&s, &[], "util", 10, &[]);
    assert_eq!(rels(&hits), vec!["x/util.rs", "y/util.rs", "a/b/c/util.rs"]);
    let recents = vec!["a/b/c/util.rs".to_owned()];
    let (hits, _) = find_files(&s, &recents, "util", 10, &[]);
    assert_eq!(rels(&hits)[0], "a/b/c/util.rs");
}

#[test]
fn empty_query_lists_recent_files() {
    let s = set(&["a/b/c/util.rs", "x/util.rs"]);
    let recents = vec!["a/b/c/util.rs".to_owned()];
    let (hits, _) = find_files(&s, &recents, "", 10, &[]);
    assert_eq!(rels(&hits), vec!["a/b/c/util.rs"]);
}

#[test]
fn extension_filter_applies_before_the_limit() {
    let mut paths: Vec<String> = (0..200).map(|i| format!("src/gen{}.java", i)).collect();
    paths.extend((0..5).map(|i| format!("src/lib{}.xml", i)));
    let owned: Vec<&str> = paths.iter().map(String::as_str).collect();
    let s = set(&owned);
    let (hits, total) = find_files(&s, &[], "src", 100, &[".xml".to_owned()]);
    assert_eq!(hits.len(), 5);
    assert_eq!(total, 5);
    assert!(hits.iter().all(|h| h.rel.ends_with(".xml")));
}

#[test]
fn extension_only_query_lists_without_recents() {
    let s = set(&["src/A.java", "src/B.xml"]);
    let recents = vec!["src/A.java".to_owned()];
    let (hits, _) = list_by_extension(&s, &[".xml".to_owned()], 10);
    assert_eq!(rels(&hits), vec!["src/B.xml"]);
    let _ = &recents;
}

#[test]
fn indices_point_into_the_relative_path() {
    let s = set(&["src/ui/Button.tsx"]);
    let (hits, _) = find_files(&s, &[], "btn", 1, &[]);
    let shown: String = hits[0].indices.iter().map(|&i| hits[0].rel.chars().nth(i as usize).unwrap()).collect();
    assert_eq!(shown.to_lowercase(), "btn");
}
```

- [ ] **Step 2: 建 crate 并确认测试失败**

Create `openidea/crates/ide-file-search/Cargo.toml`:

```toml
[package]
name = "ide-file-search"
description = "Fuzzy file matching shared by the desktop index and the wasm build"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
nucleo-matcher.workspace = true
serde.workspace = true

[target.'cfg(target_arch = "wasm32")'.dependencies]
wasm-bindgen = "0.2"
serde_json = "1"
```

Create `openidea/crates/ide-file-search/src/lib.rs` with only a placeholder so the crate compiles:

```rust
//! Fuzzy file matching shared by the desktop index and the wasm build.

pub struct FileSet;

#[derive(Clone, Debug)]
pub struct Entry {
    pub key: String,
    pub rel: String,
    pub library: bool,
}

#[derive(Clone, Debug)]
pub struct FileHit {
    pub key: String,
    pub rel: String,
    pub score: u32,
    pub indices: Vec<u32>,
}

pub fn normalize_file_query(q: &str) -> String {
    q.to_owned()
}

pub fn find_files(_: &FileSet, _: &[String], _: &str, _: usize, _: &[String]) -> (Vec<FileHit>, usize) {
    (Vec::new(), 0)
}

pub fn list_by_extension(_: &FileSet, _: &[String], _: usize) -> (Vec<FileHit>, usize) {
    (Vec::new(), 0)
}
```

Modify `openidea/Cargo.toml`:

```toml
members = ["crates/*", "src-tauri"]
```

（`crates/*` 已覆盖新 crate，无需改 members；只在 `[workspace.package]` 之后确认无需新增条目。）

Run: `cd /Users/benghiong/Documents/Code/openidea && cargo test -p ide-file-search`
Expected: 编译通过，`ranking.rs` 里除 `indices_point_into_the_relative_path` 外的用例全部 FAIL（`assert_eq!` 左右不等或空结果）。

- [ ] **Step 3: 搬入掩码与查询规整**

Create `openidea/crates/ide-file-search/src/mask.rs`，内容从 `crates/ide-index/src/data.rs:10-34` 原样移入，改为 `pub`：

```rust
//! Bit set of the (lower-cased) ASCII letters/digits/punctuation present in a
//! string; a cheap pre-filter before fuzzy matching (query mask ⊆ haystack mask).

pub fn char_mask(s: &str) -> u64 {
    let mut m = 0u64;
    for b in s.bytes() {
        m |= mask_bit(b);
    }
    m
}

#[inline]
pub fn mask_bit(b: u8) -> u64 {
    match b.to_ascii_lowercase() {
        c @ b'a'..=b'z' => 1 << (c - b'a'),
        c @ b'0'..=b'9' => 1 << (26 + c - b'0'),
        b'_' => 1 << 36,
        b'-' => 1 << 37,
        b'.' => 1 << 38,
        b'/' => 1 << 39,
        b'$' => 1 << 40,
        b':' => 1 << 41,
        b'~' => 1 << 42,
        b'#' => 1 << 43,
        b if b >= 0x80 => 1 << 63,
        _ => 0,
    }
}
```

Create `openidea/crates/ide-file-search/src/query.rs`，从 `crates/ide-index/src/matching.rs:35-61` 与 `:158-173` 移入 `Needle` 与 `normalize_file_query`，两者改为 `pub`：

```rust
//! Query normalization for the file matcher.

use nucleo_matcher::Utf32String;

use crate::mask::char_mask;

/// `Foo.kt:12:3` -> `Foo.kt`; `\` -> `/`; strips leading `./` and `/`.
pub fn normalize_file_query(q: &str) -> String {
    let mut q = q.trim().replace('\\', "/");
    while let Some((head, tail)) = q.rsplit_once(':')
        && !tail.is_empty()
        && tail.bytes().all(|b| b.is_ascii_digit())
    {
        q = head.to_owned();
    }
    let q = q.trim_start_matches("./").trim_start_matches('/');
    q.chars().filter(|c| !c.is_whitespace()).collect()
}

pub struct Needle {
    /// Lower-cased query text.
    pub lower: String,
    pub original: String,
    pub utf32: Utf32String,
    pub mask: u64,
}

impl Needle {
    pub fn new(s: &str) -> Self {
        let lower = s.to_lowercase();
        Self { mask: char_mask(&lower), utf32: Utf32String::from(lower.as_str()), lower, original: s.to_owned() }
    }

    pub fn is_empty(&self) -> bool {
        self.lower.is_empty()
    }
}

pub enum FileQuery {
    Name(Needle),
    Path { dir: Needle, name: Needle },
}

impl FileQuery {
    pub fn parse(q: &str) -> Self {
        match q.rsplit_once('/') {
            Some((dir, name)) => FileQuery::Path { dir: Needle::new(dir), name: Needle::new(name) },
            None => FileQuery::Name(Needle::new(q)),
        }
    }
}
```

- [ ] **Step 4: 搬入打分逻辑并实现名单**

Create `openidea/crates/ide-file-search/src/score.rs`，从 `crates/ide-index/src/matching.rs:16-28`、`:85-101`、`:256-311` 移入常量、`hump_bonus`、`base_file_score`、`file_indices`。把 `FileEntry` 换成 crate 内的 `EntryView`，去掉 `path` 字段：

```rust
//! Scoring constants and per-candidate scoring, shared by desktop and wasm.

use nucleo_matcher::{Config, Matcher};

use crate::mask::char_mask;
use crate::query::{FileQuery, Needle};

pub const TIER_NAME: u32 = 1 << 20;
pub const EXACT: u32 = 4000;
pub const EXACT_STEM: u32 = 3000;
pub const PREFIX: u32 = 600;
pub const CASE_EXACT: u32 = 200;
pub const HUMP: u32 = 12;
pub const FIRST_AT_START: u32 = 40;
pub const RECENT_MAX: u32 = 900;

pub fn matcher() -> Matcher {
    Matcher::new(Config::DEFAULT.match_paths())
}

/// One candidate as the scorer sees it: `/`-separated relative path, plus the
/// byte offset of the file name inside it.
pub struct EntryView<'a> {
    pub rel: &'a str,
    pub name_start: usize,
}

impl<'a> EntryView<'a> {
    pub fn new(rel: &'a str) -> Self {
        Self { rel, name_start: rel.rfind('/').map_or(0, |i| i + 1) }
    }

    pub fn name(&self) -> &'a str {
        &self.rel[self.name_start..]
    }

    pub fn dir(&self) -> &'a str {
        &self.rel[..self.name_start]
    }

    pub fn name_mask(&self) -> u64 {
        char_mask(self.name())
    }

    pub fn rel_mask(&self) -> u64 {
        char_mask(self.rel)
    }
}

/// Word starts in `s` (char indices): start, after a separator, lower→Upper, letter→digit.
pub fn hump_bonus(s: &str, indices: &[u32]) -> u32 {
    if indices.is_empty() {
        return 0;
    }
    let chars: Vec<char> = s.chars().collect();
    let is_start = |i: usize| {
        if i == 0 {
            return true;
        }
        let (p, c) = (chars[i - 1], chars[i]);
        !p.is_alphanumeric() || (p.is_lowercase() && c.is_uppercase()) || (!p.is_ascii_digit() && c.is_ascii_digit())
    };
    let humps = indices.iter().filter(|&&i| (i as usize) < chars.len() && is_start(i as usize)).count() as u32;
    let first = if is_start(indices[0] as usize) { FIRST_AT_START } else { 0 };
    humps * HUMP + first
}

impl Needle {
    /// Exact / prefix boosts against a candidate name.
    pub fn name_boost(&self, name: &str) -> u32 {
        let (q, n) = (self.lower.as_bytes(), name.as_bytes());
        let mut b = 0;
        if n.eq_ignore_ascii_case(q) {
            b += EXACT;
        } else if let Some(dot) = name.find('.')
            && name.as_bytes()[..dot].eq_ignore_ascii_case(q)
        {
            b += EXACT_STEM;
        } else if n.len() >= q.len() && n[..q.len()].eq_ignore_ascii_case(q) {
            b += PREFIX;
        }
        if b > 0 && name.as_bytes().starts_with(self.original.as_bytes()) {
            b += CASE_EXACT;
        }
        b
    }
}

pub fn base_file_score(m: &mut Matcher, q: &FileQuery, e: &EntryView<'_>, buf: &mut Vec<char>) -> Option<u32> {
    match q {
        FileQuery::Name(n) => {
            if n.mask & e.name_mask() == n.mask
                && let Some(s) = n.score(m, e.name(), buf)
            {
                return Some(TIER_NAME + s * 4 + n.name_boost(e.name()));
            }
            if n.mask & e.rel_mask() == n.mask {
                return n.score(m, e.rel, buf);
            }
            None
        }
        FileQuery::Path { dir, name } => {
            let name_score = if name.is_empty() {
                0
            } else {
                if name.mask & e.name_mask() != name.mask {
                    return None;
                }
                name.score(m, e.name(), buf)? * 4 + name.name_boost(e.name())
            };
            let dir_str = e.dir();
            if dir.mask & char_mask(dir_str) != dir.mask {
                return None;
            }
            let dir_score = dir.score(m, dir_str, buf)?;
            Some(TIER_NAME + name_score + dir_score)
        }
    }
}

pub fn file_indices(m: &mut Matcher, q: &FileQuery, e: &EntryView<'_>, buf: &mut Vec<char>) -> Option<Vec<u32>> {
    let name_start_chars = e.rel[..e.name_start].chars().count() as u32;
    let mut idx = Vec::new();
    match q {
        FileQuery::Name(n) => {
            if n.indices(m, e.name(), buf, &mut idx).is_some() {
                return Some(idx.into_iter().map(|i| i + name_start_chars).collect());
            }
            n.indices(m, e.rel, buf, &mut idx)?;
            Some(idx)
        }
        FileQuery::Path { dir, name } => {
            dir.indices(m, e.dir(), buf, &mut idx)?;
            let mut out = idx.clone();
            if !name.is_empty() {
                name.indices(m, e.name(), buf, &mut idx)?;
                out.extend(idx.iter().map(|i| i + name_start_chars));
            }
            Some(out)
        }
    }
}
```

在 `query.rs` 的 `Needle` 上补 `score` 与 `indices`（从 `matching.rs:53-62` 移入）：

```rust
use nucleo_matcher::{Matcher, Utf32Str};

impl Needle {
    pub fn score(&self, m: &mut Matcher, hay: &str, buf: &mut Vec<char>) -> Option<u32> {
        m.fuzzy_match(Utf32Str::new(hay, buf), self.utf32.slice(..)).map(u32::from)
    }

    pub fn indices(&self, m: &mut Matcher, hay: &str, buf: &mut Vec<char>, out: &mut Vec<u32>) -> Option<u32> {
        out.clear();
        let s = m.fuzzy_indices(Utf32Str::new(hay, buf), self.utf32.slice(..), out).map(u32::from);
        out.sort_unstable();
        out.dedup();
        s
    }
}
```

Implement `FileSet` and the two entry points in `lib.rs`:

```rust
mod mask;
mod query;
mod score;

#[cfg(target_arch = "wasm32")]
mod wasm;

pub use mask::char_mask;
pub use query::{normalize_file_query, FileQuery, Needle};
pub use score::{hump_bonus, RECENT_MAX, TIER_NAME};

use std::collections::HashMap;

use query::FileQuery as Fq;
use score::{base_file_score, file_indices, hump_bonus as hump, matcher, EntryView, RECENT_MAX as RECENT};

#[derive(Clone, Debug)]
pub struct Entry {
    pub key: String,
    pub rel: String,
    pub library: bool,
}

#[derive(Clone, Debug)]
pub struct FileHit {
    pub key: String,
    pub rel: String,
    pub score: u32,
    pub indices: Vec<u32>,
}

#[derive(Default)]
pub struct FileSet {
    entries: Vec<Entry>,
    slots: HashMap<String, usize>,
}

impl FileSet {
    pub fn push(&mut self, key: &str, rel: &str, library: bool) {
        self.upsert(Entry { key: key.to_owned(), rel: rel.to_owned(), library });
    }

    pub fn upsert(&mut self, entry: Entry) {
        if let Some(&slot) = self.slots.get(&entry.key) {
            self.entries[slot] = entry;
            return;
        }
        self.slots.insert(entry.key.clone(), self.entries.len());
        self.entries.push(entry);
    }

    pub fn remove(&mut self, key: &str) -> bool {
        let Some(slot) = self.slots.remove(key) else { return false };
        self.entries.swap_remove(slot);
        if let Some(moved) = self.entries.get(slot) {
            self.slots.insert(moved.key.clone(), slot);
        }
        true
    }

    pub fn replace_all(&mut self, entries: Vec<Entry>) {
        self.slots = entries.iter().enumerate().map(|(i, e)| (e.key.clone(), i)).collect();
        self.entries = entries;
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.slots.clear();
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.entries.iter().map(|e| e.key.as_str())
    }
}

fn extension_of(rel: &str) -> String {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    match name.rfind('.') {
        Some(dot) if dot > 0 => name[dot..].to_lowercase(),
        _ => String::new(),
    }
}

fn keeps(entry: &Entry, extensions: &[String]) -> bool {
    if extensions.is_empty() {
        return true;
    }
    let ext = extension_of(&entry.rel);
    if extensions.iter().any(|e| *e == ext) {
        return true;
    }
    entry.library && ext == ".class" && extensions.iter().any(|e| e == ".java")
}

fn recent_bonus(recents: &[String], key: &str) -> u32 {
    recents.iter().position(|k| k == key).map_or(0, |r| RECENT.saturating_sub(r as u32 * 12))
}

pub fn find_files(set: &FileSet, recents: &[String], query: &str, limit: usize, extensions: &[String]) -> (Vec<FileHit>, usize) {
    if limit == 0 {
        return (Vec::new(), 0);
    }
    let q = normalize_file_query(query);
    if q.is_empty() {
        let hits: Vec<FileHit> = recents
            .iter()
            .filter_map(|key| set.slots.get(key))
            .map(|&slot| &set.entries[slot])
            .filter(|e| keeps(e, extensions))
            .enumerate()
            .map(|(i, e)| FileHit {
                key: e.key.clone(),
                rel: e.rel.clone(),
                score: (RECENT_MAX.saturating_sub(i as u32)).max(1),
                indices: Vec::new(),
            })
            .collect();
        let total = hits.len();
        return (hits.into_iter().take(limit).collect(), total);
    }
    let fq = Fq::parse(&q);
    let mut m = matcher();
    let mut buf = Vec::new();
    let mut cands: Vec<(u32, usize)> = Vec::new();
    for (slot, entry) in set.entries.iter().enumerate() {
        if !keeps(entry, extensions) {
            continue;
        }
        let view = EntryView::new(&entry.rel);
        if let Some(score) = base_file_score(&mut m, &fq, &view, &mut buf) {
            cands.push((score, slot));
        }
    }
    let total = cands.len();
    cands.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    let keep = limit.saturating_mul(4).saturating_add(64);
    cands.truncate(keep.min(total));
    let mut out: Vec<FileHit> = Vec::with_capacity(cands.len());
    for (base, slot) in cands {
        let entry = &set.entries[slot];
        let view = EntryView::new(&entry.rel);
        let Some(indices) = file_indices(&mut m, &fq, &view, &mut buf) else { continue };
        let display = match &fq {
            Fq::Name(_) if base >= TIER_NAME => {
                let name_start = entry.rel[..view.name_start].chars().count() as u32;
                let name_idx: Vec<u32> = indices.iter().map(|i| i.saturating_sub(name_start)).collect();
                hump(view.name(), &name_idx)
            }
            _ => hump(&entry.rel, &indices),
        };
        out.push(FileHit {
            key: entry.key.clone(),
            rel: entry.rel.clone(),
            score: base + display + recent_bonus(recents, &entry.key),
            indices,
        });
    }
    out.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.rel.len().cmp(&b.rel.len()))
            .then_with(|| a.rel.cmp(&b.rel))
    });
    out.truncate(limit);
    (out, total)
}

pub fn list_by_extension(set: &FileSet, extensions: &[String], limit: usize) -> (Vec<FileHit>, usize) {
    let mut hits: Vec<FileHit> = set
        .entries
        .iter()
        .filter(|e| keeps(e, extensions))
        .map(|e| FileHit { key: e.key.clone(), rel: e.rel.clone(), score: 0, indices: Vec::new() })
        .collect();
    hits.sort_by(|a, b| a.rel.len().cmp(&b.rel.len()).then_with(|| a.rel.cmp(&b.rel)));
    let total = hits.len();
    hits.truncate(limit);
    (hits, total)
}
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `cd /Users/benghiong/Documents/Code/openidea && cargo test -p ide-file-search`
Expected: `ranking.rs` 全部 PASS，`cargo test` 显示 0 failed。

- [ ] **Step 6: 让 `ide-index` 改调新 crate**

Modify `openidea/crates/ide-index/Cargo.toml`，在 `[dependencies]` 加一行：

```toml
ide-file-search.workspace = true
```

Modify `openidea/Cargo.toml` 的 `[workspace.dependencies]`，在 `ide-index = { path = "crates/ide-index" }` 之后加：

```toml
ide-file-search = { path = "crates/ide-file-search" }
```

Modify `openidea/crates/ide-index/src/matching.rs`：删除 `TIER_NAME`、`EXACT`、`EXACT_STEM`、`PREFIX`、`CASE_EXACT`、`HUMP`、`FIRST_AT_START`、`RECENT_MAX`、`Needle`、`hump_bonus`、`normalize_file_query`、`FileQuery`、`base_file_score`、`file_indices`、`find_files`，保留 `MATCHER`/`with_matcher`、`Cand`、`keep_best`、`scan`、`Recents`、`symbol_score`、`split_symbol_query`、`find_symbols`、`symbols_named`。在文件头补：

```rust
use ide_file_search::{base_file_score as shared_base_score, file_indices as shared_file_indices, hump_bonus as shared_hump_bonus, normalize_file_query as shared_normalize, FileQuery as SharedFileQuery, Needle as SharedNeedle};

fn normalize_file_query(q: &str) -> String {
    shared_normalize(q)
}

fn hump_bonus(s: &str, indices: &[u32]) -> u32 {
    shared_hump_bonus(s, indices)
}
```

`find_files` 改为薄封装：把 `IndexData` 的 `FileEntry` 投影成 `ide_file_search::FileSet` 再调用共享实现，再把 `FileHit` 映射回 `FileMatch`。保留现有测试断言（`file_ranking_is_idea_like`、`shorter_paths_win_ties_and_recent_files_boost`）不改：

```rust
pub(crate) fn find_files(data: &IndexData, recents: &Recents, query: &str, limit: usize) -> Vec<FileMatch> {
    if limit == 0 {
        return Vec::new();
    }
    let mut set = ide_file_search::FileSet::default();
    for e in data.files.iter().flatten() {
        set.push(e.path.to_string_lossy().as_ref(), &e.rel, false);
    }
    let recent_keys: Vec<String> = recents
        .paths
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    let (hits, _) = ide_file_search::find_files(&set, &recent_keys, query, limit, &[]);
    hits.into_iter()
        .filter_map(|h| {
            let path = std::path::PathBuf::from(&h.key);
            let e = data.get(&path)?;
            Some(FileMatch {
                path: e.path.clone().into(),
                rel_path: h.rel,
                score: h.score,
                indices: h.indices,
            })
        })
        .collect()
}
```

> 注：这个封装每查询重建一次 `FileSet`，桌面端大仓库会退化。因此在 Step 7 必须把 `FileSet` 缓存进 `IndexData`。

- [ ] **Step 7: 把 `FileSet` 缓存进索引，避免每次查询重建**

Modify `openidea/crates/ide-index/src/data.rs`：给 `IndexData` 加字段与同步方法，`insert` / `remove` 里同步维护：

```rust
pub(crate) struct IndexData {
    pub files: Vec<Option<FileEntry>>,
    by_path: HashMap<PathBuf, u32>,
    free: Vec<u32>,
    pub file_count: u32,
    pub symbol_count: u32,
    /// Mirrors `files` for the shared matcher; kept in sync by insert/remove.
    pub file_set: ide_file_search::FileSet,
}
```

在 `insert` 的替换分支与新增分支末尾都加：

```rust
self.file_set.push(entry.path.to_string_lossy().as_ref(), &entry.rel, false);
```

`remove` 里加：

```rust
self.file_set.remove(old.path.to_string_lossy().as_ref());
```

`remove_tree` 与 `shrink` 不动。`matching::find_files` 改为直接用 `data.file_set`，不再重建：

```rust
pub(crate) fn find_files(data: &IndexData, recents: &Recents, query: &str, limit: usize) -> Vec<FileMatch> {
    if limit == 0 {
        return Vec::new();
    }
    let recent_keys: Vec<String> = recents.paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    let (hits, _) = ide_file_search::find_files(&data.file_set, &recent_keys, query, limit, &[]);
    hits.into_iter()
        .filter_map(|h| {
            let path = std::path::PathBuf::from(&h.key);
            let e = data.get(&path)?;
            Some(FileMatch { path: e.path.clone().into(), rel_path: h.rel, score: h.score, indices: h.indices })
        })
        .collect()
}
```

- [ ] **Step 8: 跑桌面端全部测试**

Run: `cd /Users/benghiong/Documents/Code/openidea && cargo test -p ide-index`
Expected: 全部 PASS，包括 `file_ranking_is_idea_like`、`shorter_paths_win_ties_and_recent_files_boost`、`symbol_ranking_is_idea_like`、`masks`。

Run: `cd /Users/benghiong/Documents/Code/openidea && cargo clippy -p ide-file-search -p ide-index -- -D warnings`
Expected: 无警告。

- [ ] **Step 9: 提交**

```bash
cd /Users/benghiong/Documents/Code/openidea
git add Cargo.toml crates/ide-file-search crates/ide-index
git commit -m "Extract file matching into ide-file-search shared with the wasm build"
```

---

### Task 2: 导出 WASM 接口

**Files:**
- Create: `openidea/crates/ide-file-search/src/wasm.rs`
- Modify: `openidea/crates/ide-file-search/src/lib.rs`（已在 Task 1 预留 `#[cfg(target_arch = "wasm32")] mod wasm;`）
- Create: `openidea/scripts/build-file-search-wasm.sh`

**Interfaces:**
- Consumes: `FileSet`、`Entry`、`find_files`、`list_by_extension`（Task 1）。
- Produces（JS 侧，`nodejs` target）:
  - `setFiles(json: string): void` — `[{ key, rel, library }]` 整份替换
  - `upsertFiles(json: string): void` — `[{ key, rel, library }]`
  - `removeFiles(json: string): void` — `["key", ...]`
  - `setRecents(json: string): void` — `["key", ...]`，最新在前
  - `findFiles(query: string, limit: number, extensions: string): string` — 返回 `{"hits":[{"key","rel","score","indices"}],"total":n}`
  - `listByExtension(extensions: string, limit: number): string` — 同结构，`score` 为 0

- [ ] **Step 1: 写 WASM 导出**

Create `openidea/crates/ide-file-search/src/wasm.rs`:

```rust
//! wasm-bindgen surface consumed by the VS Code extension.

use std::cell::RefCell;

use wasm_bindgen::prelude::*;

use crate::{find_files, list_by_extension, Entry, FileSet};

#[derive(serde::Deserialize)]
struct InEntry {
    key: String,
    rel: String,
    #[serde(default)]
    library: bool,
}

#[derive(serde::Serialize)]
struct OutHit {
    key: String,
    rel: String,
    score: u32,
    indices: Vec<u32>,
}

#[derive(serde::Serialize)]
struct OutPage {
    hits: Vec<OutHit>,
    total: usize,
}

thread_local! {
    static SET: RefCell<FileSet> = RefCell::new(FileSet::default());
    static RECENTS: RefCell<Vec<String>> = RefCell::new(Vec::new());
}

fn to_entries(json: &str) -> Result<Vec<Entry>, JsValue> {
    let parsed: Vec<InEntry> = serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(parsed
        .into_iter()
        .map(|e| Entry { key: e.key, rel: e.rel, library: e.library })
        .collect())
}

fn page(hits: Vec<crate::FileHit>, total: usize) -> String {
    let out = OutPage {
        hits: hits
            .into_iter()
            .map(|h| OutHit { key: h.key, rel: h.rel, score: h.score, indices: h.indices })
            .collect(),
        total,
    };
    serde_json::to_string(&out).expect("OutPage serializes")
}

#[wasm_bindgen(js_name = setFiles)]
pub fn set_files(json: &str) -> Result<(), JsValue> {
    let entries = to_entries(json)?;
    SET.with(|s| s.borrow_mut().replace_all(entries));
    Ok(())
}

#[wasm_bindgen(js_name = upsertFiles)]
pub fn upsert_files(json: &str) -> Result<(), JsValue> {
    for entry in to_entries(json)? {
        SET.with(|s| s.borrow_mut().upsert(entry));
    }
    Ok(())
}

#[wasm_bindgen(js_name = removeFiles)]
pub fn remove_files(json: &str) -> Result<(), JsValue> {
    let keys: Vec<String> = serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    SET.with(|s| {
        let mut set = s.borrow_mut();
        for key in keys {
            set.remove(&key);
        }
    });
    Ok(())
}

#[wasm_bindgen(js_name = setRecents)]
pub fn set_recents(json: &str) -> Result<(), JsValue> {
    let keys: Vec<String> = serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    RECENTS.with(|r| *r.borrow_mut() = keys);
    Ok(())
}

#[wasm_bindgen(js_name = findFiles)]
pub fn find_files_js(query: &str, limit: usize, extensions: &str) -> Result<String, JsValue> {
    let exts: Vec<String> = serde_json::from_str(extensions).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let recents = RECENTS.with(|r| r.borrow().clone());
    let (hits, total) = SET.with(|s| find_files(&s.borrow(), &recents, query, limit, &exts));
    Ok(page(hits, total))
}

#[wasm_bindgen(js_name = listByExtension)]
pub fn list_by_extension_js(extensions: &str, limit: usize) -> Result<String, JsValue> {
    let exts: Vec<String> = serde_json::from_str(extensions).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let (hits, total) = SET.with(|s| list_by_extension(&s.borrow(), &exts, limit));
    Ok(page(hits, total))
}
```

- [ ] **Step 2: 建构建脚本**

Create `openidea/scripts/build-file-search-wasm.sh`:

```bash
#!/usr/bin/env bash
# Builds the file-search wasm module and copies it into the extension's vendor dir.
set -euo pipefail

CRATE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:?usage: build-file-search-wasm.sh <out-dir>}"

cd "$CRATE_DIR/crates/ide-file-search"
wasm-pack build --target nodejs --release --out-dir "$OUT_DIR" --out-name file_search
rm -rf "$OUT_DIR/.gitignore" "$OUT_DIR/package.json"
echo "built file_search into $OUT_DIR"
```

```bash
chmod +x /Users/benghiong/Documents/Code/openidea/scripts/build-file-search-wasm.sh
```

- [ ] **Step 3: 构建并确认导出存在**

Run:

```bash
cd /Users/benghiong/Documents/Code/openidea
./scripts/build-file-search-wasm.sh /tmp/file_search_wasm
node -e "const m=require('/tmp/file_search_wasm/file_search.js'); m.setFiles(JSON.stringify([{key:'src/A.java',rel:'src/A.java',library:false},{key:'src/B.xml',rel:'src/B.xml',library:false}])); m.setRecents(JSON.stringify(['src/A.java'])); console.log(m.findFiles('a',10,'[]')); console.log(m.listByExtension('[\".xml\"]',10));"
```

Expected: 两行 JSON；第一行 `hits` 含 `src/A.java`，第二行 `hits` 只含 `src/B.xml` 且 `score` 为 0。

- [ ] **Step 4: 提交**

```bash
cd /Users/benghiong/Documents/Code/openidea
git add crates/ide-file-search/src/wasm.rs crates/ide-file-search/src/lib.rs crates/ide-file-search/Cargo.toml scripts/build-file-search-wasm.sh
git commit -m "Export the file matcher over wasm-bindgen"
```

---

### Task 3: 插件加载 WASM 并替换文件搜索

**Files:**
- Create: `vscode-plugin/vendor/wasm/`（构建产物，提交）
- Create: `vscode-plugin/scripts/build-wasm.js`
- Create: `vscode-plugin/src/search/wasmFileSearch.ts`
- Create: `vscode-plugin/src/search/wasmFileSearch.test.ts`
- Modify: `vscode-plugin/package.json`（加 `build:wasm` 脚本，把 `vendor/wasm` 打进 vsix）
- Modify: `vscode-plugin/src/limits.ts`

**Interfaces:**
- Consumes: Task 2 的六个 JS 导出。
- Produces:
  - `export interface FileSearchResult { hits: FileHit[]; total: number }`
  - `export interface FileHit { key: string; rel: string; score: number; indices: number[] }`
  - `export class WasmFileSearch { static load(dir: string, log: (msg: string) => void): Promise<WasmFileSearch>; setFiles(entries: IndexedEntry[]): void; upsertFiles(entries: IndexedEntry[]): void; removeFiles(keys: string[]): void; setRecents(keys: string[]): void; find(query: string, limit: number, extensions: string[]): FileSearchResult; listByExtension(extensions: string[], limit: number): FileSearchResult; readonly available: boolean }`
  - `export interface IndexedEntry { key: string; rel: string; library: boolean }`

- [ ] **Step 1: 写出 vendor 目录并加构建脚本**

Create `vscode-plugin/scripts/build-wasm.js`:

```js
// Rebuilds vendor/wasm from a local OpenIdea checkout.
// Usage: npm run build:wasm [-- /path/to/openidea]
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const openidea = process.argv[2] ?? path.join(__dirname, "..", "..", "openidea");
const out = path.join(__dirname, "..", "vendor", "wasm");
fs.mkdirSync(out, { recursive: true });
execFileSync(path.join(openidea, "scripts", "build-file-search-wasm.sh"), [out], { stdio: "inherit" });
for (const name of fs.readdirSync(out)) {
  if (name.endsWith(".d.ts") || name.endsWith("package.json") || name.endsWith(".gitignore")) {
    fs.rmSync(path.join(out, name), { recursive: true, force: true });
  }
}
console.log(`vendor/wasm: ${fs.readdirSync(out).join(", ")}`);
```

Modify `vscode-plugin/package.json` 的 `scripts`：

```json
"compile": "tsc -p .",
"build:wasm": "node scripts/build-wasm.js",
"test": "tsc -p . --pretty false && node --test \"out/**/*.test.js\""
```

并在顶层加（`.vsix` 需要带上 vendor）：

```json
"files": ["out", "media", "vendor", "src/classpath/gradle-classpath.init.gradle", "package.json", "README.md"],
```

- [ ] **Step 2: 生成产物**

Run: `cd /Users/benghiong/Documents/Code/vscode-plugin && npm run build:wasm`
Expected: 输出 `vendor/wasm: file_search.js, file_search_bg.wasm, file_search_bg.wasm.d.ts`（`.d.ts` 会被清掉，实际剩 `file_search.js`、`file_search_bg.wasm`）。

Run: `ls vendor/wasm`
Expected: 只有 `file_search.js` 与 `file_search_bg.wasm`。

- [ ] **Step 3: 写失败的测试**

Create `vscode-plugin/src/search/wasmFileSearch.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { WasmFileSearch } from "./wasmFileSearch";

const vendor = path.join(__dirname, "..", "..", "vendor", "wasm");

test("missing wasm leaves the search unavailable", async () => {
  const search = await WasmFileSearch.load("/nonexistent/wasm", () => {});
  assert.equal(search.available, false);
  assert.deepEqual(search.find("a", 10, []).hits, []);
});

test("files and recents round-trip through the wasm module", async () => {
  const search = await WasmFileSearch.load(vendor, () => {});
  assert.equal(search.available, true);
  search.setFiles([
    { key: "src/A.java", rel: "src/A.java", library: false },
    { key: "src/B.xml", rel: "src/B.xml", library: false },
  ]);
  search.setRecents(["src/A.java"]);
  assert.equal(search.find("A", 10, []).hits[0]?.key, "src/A.java");
  assert.deepEqual(search.listByExtension([".xml"], 10).hits.map((h) => h.rel), ["src/B.xml"]);
  search.removeFiles(["src/A.java"]);
  assert.equal(search.find("A", 10, []).total, 0);
});

test("a throwing module marks the search unavailable after the first failure", async () => {
  const search = await WasmFileSearch.load(vendor, () => {});
  search.setFiles([{ key: "a", rel: "a", library: false }]);
  (search as unknown as { module: { findFiles: () => string } }).module.findFiles = () => {
    throw new Error("boom");
  };
  const first = search.find("a", 10, []);
  assert.deepEqual(first.hits, []);
  assert.equal(search.available, false);
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `cd /Users/benghiong/Documents/Code/vscode-plugin && npm test 2>&1 | tail -20`
Expected: 编译报错 `Cannot find module './wasmFileSearch'`。

- [ ] **Step 5: 实现 `wasmFileSearch`**

Create `vscode-plugin/src/search/wasmFileSearch.ts`:

```ts
import path from "node:path";

export interface IndexedEntry {
  key: string;
  rel: string;
  library: boolean;
}

export interface FileHit {
  key: string;
  rel: string;
  score: number;
  indices: number[];
}

export interface FileSearchResult {
  hits: FileHit[];
  total: number;
}

interface WasmModule {
  setFiles(json: string): void;
  upsertFiles(json: string): void;
  removeFiles(json: string): void;
  setRecents(json: string): void;
  findFiles(query: string, limit: number, extensions: string): string;
  listByExtension(extensions: string, limit: number): string;
}

const EMPTY: FileSearchResult = { hits: [], total: 0 };

export class WasmFileSearch {
  private failed = false;

  private constructor(private readonly module: WasmModule | undefined, private readonly log: (message: string) => void) {}

  static async load(directory: string, log: (message: string) => void): Promise<WasmFileSearch> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loaded = require(path.join(directory, "file_search.js")) as WasmModule;
      return new WasmFileSearch(loaded, log);
    } catch (error) {
      log(`文件搜索 WASM 加载失败，改用内置匹配：${String(error)}`);
      return new WasmFileSearch(undefined, log);
    }
  }

  get available(): boolean {
    return this.module !== undefined && !this.failed;
  }

  setFiles(entries: IndexedEntry[]): void {
    this.call((m) => m.setFiles(JSON.stringify(entries)));
  }

  upsertFiles(entries: IndexedEntry[]): void {
    this.call((m) => m.upsertFiles(JSON.stringify(entries)));
  }

  removeFiles(keys: string[]): void {
    this.call((m) => m.removeFiles(JSON.stringify(keys)));
  }

  setRecents(keys: string[]): void {
    this.call((m) => m.setRecents(JSON.stringify(keys)));
  }

  find(query: string, limit: number, extensions: string[]): FileSearchResult {
    return this.callResult((m) => m.findFiles(query, limit, JSON.stringify(extensions)));
  }

  listByExtension(extensions: string[], limit: number): FileSearchResult {
    return this.callResult((m) => m.listByExtension(JSON.stringify(extensions), limit));
  }

  private call(action: (module: WasmModule) => void): void {
    if (!this.module || this.failed) return;
    try {
      action(this.module);
    } catch (error) {
      this.fail(error);
    }
  }

  private callResult(action: (module: WasmModule) => string): FileSearchResult {
    if (!this.module || this.failed) return EMPTY;
    try {
      return JSON.parse(action(this.module)) as FileSearchResult;
    } catch (error) {
      this.fail(error);
      return EMPTY;
    }
  }

  private fail(error: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.log(`文件搜索 WASM 调用失败，本次会话改用内置匹配：${String(error)}`);
  }
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd /Users/benghiong/Documents/Code/vscode-plugin && npm test 2>&1 | tail -20`
Expected: 全部通过，含新增 3 个用例。

- [ ] **Step 7: 加限额常量**

Modify `vscode-plugin/src/limits.ts`，追加：

```ts
export const RECENT_LIMIT = 50;
export const FILE_INDEX_DEBOUNCE_MS = 300;
export const FILE_BATCH_LIMIT = 50;
```

- [ ] **Step 8: 提交**

```bash
cd /Users/benghiong/Documents/Code/vscode-plugin
git add vendor scripts/build-wasm.js src/search/wasmFileSearch.ts src/search/wasmFileSearch.test.ts src/limits.ts package.json package-lock.json
git commit -m "Load the shared file matcher as wasm in the extension"
```

---

### Task 4: 解析后缀与 `:行:列`

**Files:**
- Create: `vscode-plugin/src/query/fileQuery.ts`
- Create: `vscode-plugin/src/query/fileQuery.test.ts`

**Interfaces:**
- Consumes: `SearchQuery`（`src/types.ts`）、Task 3 的 `findFiles` 形态。
- Produces:
  - `export interface FileQueryInput { text: string; terms: string[]; extensions: string[]; line?: number }`
  - `export function parseFileQuery(input: string): FileQueryInput`
  - `export function locateFileQuery(input: string, roots: string[]): FileQueryInput`（额外剥掉绝对路径前缀）

- [ ] **Step 1: 写失败的测试**

Create `vscode-plugin/src/query/fileQuery.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { locateFileQuery, parseFileQuery } from "./fileQuery";

test("splits extension tokens from search words", () => {
  assert.deepEqual(parseFileQuery("User .java"), { text: "User", terms: ["User"], extensions: [".java"] });
  assert.deepEqual(parseFileQuery("Order *.java,*.xml").extensions, [".java", ".xml"]);
  assert.deepEqual(parseFileQuery("User.java").terms, ["User.java"]);
  assert.deepEqual(parseFileQuery(".java"), { text: "", terms: [], extensions: [".java"] });
  assert.deepEqual(parseFileQuery(""), { text: "", terms: [], extensions: [] });
});

test("reads a trailing line and column", () => {
  assert.deepEqual(parseFileQuery("Button.tsx:12"), { text: "Button.tsx", terms: ["Button.tsx"], extensions: [], line: 12 });
  assert.deepEqual(parseFileQuery("Button.tsx:1:5"), { text: "Button.tsx", terms: ["Button.tsx"], extensions: [], line: 1 });
  assert.deepEqual(parseFileQuery("C:\\src\\A.java").terms, ["C:\\src\\A.java"]);
});

test("strips a workspace root prefix", () => {
  const parsed = locateFileQuery("/repo/src/Button.tsx:7", ["/repo"]);
  assert.equal(parsed.text, "src/Button.tsx");
  assert.equal(parsed.line, 7);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/benghiong/Documents/Code/vscode-plugin && npm test 2>&1 | tail -10`
Expected: 编译报错 `Cannot find module './fileQuery'`。

- [ ] **Step 3: 实现**

Create `vscode-plugin/src/query/fileQuery.ts`:

```ts
import { SearchQuery } from "../types";

export interface FileQueryInput extends SearchQuery {
  /** Text handed to the matcher, with extensions and position suffix removed. */
  text: string;
  /** 0-based line from a `:line` suffix. */
  line?: number;
}

export function parseFileQuery(input: string): FileQueryInput {
  const located = stripPosition(input);
  const { terms, extensions } = splitExtensions(located.text);
  return {
    text: terms.join(" "),
    terms,
    extensions,
    ...(located.line === undefined ? {} : { line: located.line }),
  };
}

export function locateFileQuery(input: string, roots: string[]): FileQueryInput {
  const parsed = parseFileQuery(input);
  const text = parsed.text.replace(/\\/g, "/");
  for (const root of roots) {
    const normalized = root.replace(/\\/g, "/").replace(/\/+$/, "");
    if (text === normalized) return { ...parsed, text: "" };
    if (text.startsWith(`${normalized}/`)) return { ...parsed, text: text.slice(normalized.length + 1) };
  }
  return parsed;
}

function stripPosition(input: string): { text: string; line?: number } {
  let text = input.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  if (/^file:\/\//i.test(text)) text = decodeSafe(text.replace(/^file:\/\//i, ""));
  const match = /^(.*\S):(\d+)(?::(\d+))?$/.exec(text);
  if (!match) return { text };
  const line = Number(match[2]);
  return line > 0 ? { text: match[1], line } : { text };
}

function splitExtensions(text: string): { terms: string[]; extensions: string[] } {
  const EXTENSION_TOKEN = /^(\*\.[A-Za-z0-9]+|\.[A-Za-z0-9]+)(,(\*\.[A-Za-z0-9]+|\.[A-Za-z0-9]+))*$/;
  const terms: string[] = [];
  const extensions: string[] = [];
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
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

function decodeSafe(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/benghiong/Documents/Code/vscode-plugin && npm test 2>&1 | tail -10`
Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
cd /Users/benghiong/Documents/Code/vscode-plugin
git add src/query/fileQuery.ts src/query/fileQuery.test.ts
git commit -m "Parse extensions and line suffixes for file queries"
```

---

### Task 5: 文件名单与增量更新

**Files:**
- Create: `vscode-plugin/src/workspace/fileIndex.ts`
- Create: `vscode-plugin/src/workspace/fileIndex.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `IndexedEntry`、Task 4 的 `parseFileQuery`（仅测试用到）。
- Produces:
  - `export interface FolderRoot { name: string; fsPath: string }`
  - `export function makeEntries(folders: FolderRoot[], filesByFolder: Map<string, string[]>): IndexedEntry[]`
  - `export function shouldFullRebuild(pending: number): boolean`
  - `export function keyFor(folder: FolderRoot, relativePath: string, single: boolean): string`

- [ ] **Step 1: 写失败的测试**

Create `vscode-plugin/src/workspace/fileIndex.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { keyFor, makeEntries, shouldFullRebuild } from "./fileIndex";
import { FILE_BATCH_LIMIT } from "../limits";

test("a single folder keeps the bare relative path", () => {
  assert.equal(keyFor({ name: "repo", fsPath: "/repo" }, "src/A.java", true), "src/A.java");
  assert.equal(keyFor({ name: "repo", fsPath: "/repo" }, "src/A.java", false), "repo/src/A.java");
});

test("multiple folders prefix the folder name", () => {
  const folders = [
    { name: "app", fsPath: "/code/app" },
    { name: "lib", fsPath: "/code/lib" },
  ];
  const entries = makeEntries(folders, new Map([
    ["/code/app", ["src/A.java"]],
    ["/code/lib", ["src/A.java"]],
  ]));
  assert.deepEqual(entries.map((e) => e.key), ["app/src/A.java", "lib/src/A.java"]);
  assert.ok(entries.every((e) => e.library === false));
});

test("batches over the limit fall back to a full rebuild", () => {
  assert.equal(shouldFullRebuild(FILE_BATCH_LIMIT), false);
  assert.equal(shouldFullRebuild(FILE_BATCH_LIMIT + 1), true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/benghiong/Documents/Code/vscode-plugin && npm test 2>&1 | tail -10`
Expected: 编译报错 `Cannot find module './fileIndex'`。

- [ ] **Step 3: 实现**

Create `vscode-plugin/src/workspace/fileIndex.ts`:

```ts
import { FILE_BATCH_LIMIT } from "../limits";
import { IndexedEntry } from "../search/wasmFileSearch";

export interface FolderRoot {
  name: string;
  fsPath: string;
}

export function keyFor(folder: FolderRoot, relativePath: string, single: boolean): string {
  return single ? relativePath : `${folder.name}/${relativePath}`;
}

export function makeEntries(folders: FolderRoot[], filesByFolder: Map<string, string[]>): IndexedEntry[] {
  const single = folders.length <= 1;
  const entries: IndexedEntry[] = [];
  for (const folder of folders) {
    for (const relativePath of filesByFolder.get(folder.fsPath) ?? []) {
      const key = keyFor(folder, relativePath, single);
      entries.push({ key, rel: key, library: false });
    }
  }
  return entries;
}

export function shouldFullRebuild(pending: number): boolean {
  return pending > FILE_BATCH_LIMIT;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/benghiong/Documents/Code/vscode-plugin && npm test 2>&1 | tail -10`
Expected: 全部通过。

- [ ] **Step 5: 接入 `extension.ts` 的全量重建与增量更新**

Modify `vscode-plugin/src/extension.ts`：

1. 删除 `let workspaceFiles: { relativePath: string; uri: string }[] = [];`，改为：

```ts
let fileSearch: WasmFileSearch | undefined;
let fileEntries: IndexedEntry[] = [];
let pendingFullRebuild: NodeJS.Timeout | undefined;
const pendingUpserts = new Set<string>();
const pendingDeletes = new Set<string>();
```

2. 在 `activate` 的 `void boot();` 之前加：

```ts
void bootFileSearch(context);
```

3. `boot()` 保留依赖索引逻辑，去掉 `scheduleFileIndex()` 调用（由 `bootFileSearch` 负责）。

4. 新增：

```ts
async function bootFileSearch(context: vscode.ExtensionContext): Promise<void> {
  const vendor = path.join(context.extensionPath, "vendor", "wasm");
  fileSearch = await WasmFileSearch.load(vendor, appendLog);
  await rebuildFileIndex();
}

function folderRoots(): FolderRoot[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({ name: folder.name, fsPath: folder.uri.fsPath }));
}

function scheduleFileIndex(): void {
  if (pendingFullRebuild) clearTimeout(pendingFullRebuild);
  pendingFullRebuild = setTimeout(() => {
    pendingFullRebuild = undefined;
    void rebuildFileIndex();
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
```

5. `watchWorkspaceFiles` 改为调用 `scheduleFileDelta`，并对 `.gitignore` / exclude 用 `scheduleFileIndex`：

```ts
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
```

6. `flushFileDeltas` 由 `scheduleFileDelta` 里的防抖定时器调用（见上面第 5 步的 `scheduleFileDelta` 与 `deltaTimer` 代码）。在文件顶部声明 `let deltaTimer: NodeJS.Timeout | undefined;`，`deactivate` 里清理：

```ts
if (deltaTimer) clearTimeout(deltaTimer);
if (pendingFullRebuild) clearTimeout(pendingFullRebuild);
```

7. `searchFiles` 改为：

```ts
async function searchFiles(query: FileQueryInput, limit: number) {
  const dependency = dependencyFileHits(dependencyJars, query, limit);
  if (query.terms.length === 0 && query.extensions.length > 0) {
    const listed = fileSearch?.available ? fileSearch.listByExtension(query.extensions, limit) : { hits: [], total: 0 };
    return [...toWorkspaceHits(listed, query), ...dependency];
  }
  if (query.terms.length === 0) return [];
  const found = fileSearch?.available
    ? fileSearch.find(query.text, limit, query.extensions)
    : { hits: matchFiles(fileEntries.map((entry) => ({ relativePath: entry.rel, uri: uriFor(entry.rel) })), query, limit).map(toFallbackHit), total: limit };
  return [...toWorkspaceHits(found, query), ...dependency];
}
```

并补上：

```ts
function keyForPath(fsPath: string): string | undefined {
  const folders = folderRoots();
  const folder = folders.find((root) => fsPath.startsWith(root.fsPath));
  if (!folder) return undefined;
  const relativePath = fsPath.slice(folder.fsPath.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");
  return keyFor(folder, relativePath, folders.length <= 1);
}

function uriFor(rel: string): string {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length <= 1) return folders[0] ? folderUri(folders[0].uri, rel) : "";
  const [name, ...rest] = rel.split("/");
  const folder = folders.find((item) => item.name === name);
  return folder ? folderUri(folder.uri, rest.join("/")) : "";
}

function toFallbackHit(hit: SearchHit): FileHit {
  return { key: hit.detail, rel: hit.detail, score: 0, indices: [] };
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
      titleRanges: rangesFromIndices(hit.rel, hit.indices),
    };
  });
}

function rangesFromIndices(rel: string, indices: number[]): Array<[number, number]> {
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
```

8. `publish` 里把 `parseQuery(text)` 换成 `parseFileQuery(text)`（符号、命令、内容仍用 `terms` / `extensions`，行为不变）。

- [ ] **Step 6: 跑测试与编译**

Run: `cd /Users/benghiong/Documents/Code/vscode-plugin && npm test 2>&1 | tail -20`
Expected: 全部通过。

Run: `cd /Users/benghiong/Documents/Code/vscode-plugin && npx tsc -p . --noEmit`
Expected: 无错误。

- [ ] **Step 7: 提交**

```bash
cd /Users/benghiong/Documents/Code/vscode-plugin
git add src/workspace/fileIndex.ts src/workspace/fileIndex.test.ts src/extension.ts
git commit -m "Drive file search from a wasm-backed index with incremental updates"
```

---

### Task 6: 最近文件

**Files:**
- Create: `vscode-plugin/src/workspace/recentFiles.ts`
- Create: `vscode-plugin/src/workspace/recentFiles.test.ts`
- Modify: `vscode-plugin/src/extension.ts`

**Interfaces:**
- Consumes: `RECENT_LIMIT`（Task 3）。
- Produces:
  - `export function pushRecent(list: string[], key: string): string[]`
  - `export function pruneRecents(list: string[], live: Set<string>): string[]`
  - `export function recentLabel(rel: string): string`（返回 `rel`，供面板显示）

- [ ] **Step 1: 写失败的测试**

Create `vscode-plugin/src/workspace/recentFiles.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneRecents, pushRecent } from "./recentFiles";
import { RECENT_LIMIT } from "../limits";

test("pushes the newest key first and drops duplicates", () => {
  assert.deepEqual(pushRecent(["b", "a"], "a"), ["a", "b"]);
  assert.deepEqual(pushRecent([], "a"), ["a"]);
});

test("keeps at most RECENT_LIMIT entries", () => {
  let list: string[] = [];
  for (let i = 0; i < RECENT_LIMIT + 5; i += 1) list = pushRecent(list, `f${i}`);
  assert.equal(list.length, RECENT_LIMIT);
  assert.equal(list[0], `f${RECENT_LIMIT + 4}`);
  assert.equal(list.includes("f0"), false);
});

test("drops keys that left the index", () => {
  const live = new Set(["a", "c"]);
  assert.deepEqual(pruneRecents(["a", "b", "c"], live), ["a", "c"]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/benghiong/Documents/Code/vscode-plugin && npm test 2>&1 | tail -10`
Expected: 编译报错 `Cannot find module './recentFiles'`。

- [ ] **Step 3: 实现**

Create `vscode-plugin/src/workspace/recentFiles.ts`:

```ts
import { RECENT_LIMIT } from "../limits";

export function pushRecent(list: string[], key: string): string[] {
  if (!key) return list;
  return [key, ...list.filter((item) => item !== key)].slice(0, RECENT_LIMIT);
}

export function pruneRecents(list: string[], live: Set<string>): string[] {
  return list.filter((key) => live.has(key));
}

export function recentLabel(rel: string): string {
  return rel;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/benghiong/Documents/Code/vscode-plugin && npm test 2>&1 | tail -10`
Expected: 全部通过。

- [ ] **Step 5: 接线**

Modify `vscode-plugin/src/extension.ts`：

1. 顶部加常量键名：

```ts
const RECENT_KEY = "searchEverywhere.recentFiles";
let recentKeys: string[] = [];
```

2. `bootFileSearch` 末尾读取并推送：

```ts
recentKeys = pruneRecents(context.workspaceState.get<string[]>(RECENT_KEY) ?? [], new Set(fileEntries.map((entry) => entry.key)));
fileSearch?.setRecents(recentKeys);
```

3. 在 `activate` 里加编辑器监听：

```ts
context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
  const fsPath = editor?.document.uri.fsPath;
  if (!fsPath || editor.document.isUntitled) return;
  const key = keyForPath(fsPath);
  if (!key) return;
  recentKeys = pushRecent(recentKeys, key);
  fileSearch?.setRecents(recentKeys);
  void context.workspaceState.update(RECENT_KEY, recentKeys);
}));
```

4. `keyForPath` 已在 Task 5 定义，本任务直接复用，不重复添加。

5. `openHit` 的 workspace 分支成功后记录。`openHit` 的签名改为 `async function openHit(id: string)`，改用模块级 `extensionContext`（在 `activate` 顶部赋值 `extensionContext = context;`，并声明 `let extensionContext: vscode.ExtensionContext | undefined;`）：

```ts
if (plan.type === "workspace") {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(plan.uri));
  await showDocument(document, plan.line);
  const key = keyForPath(vscode.Uri.parse(plan.uri).fsPath);
  if (key) {
    recentKeys = pushRecent(recentKeys, key);
    fileSearch?.setRecents(recentKeys);
    void extensionContext?.workspaceState.update(RECENT_KEY, recentKeys);
  }
  return;
}
```

6. `rebuildFileIndex` 末尾按新名单裁剪最近文件：

```ts
const live = new Set(fileEntries.map((entry) => entry.key));
const pruned = pruneRecents(recentKeys, live);
if (pruned.length !== recentKeys.length) {
  recentKeys = pruned;
  void extensionContext?.workspaceState.update(RECENT_KEY, recentKeys);
}
fileSearch?.setRecents(recentKeys);
```

- [ ] **Step 6: 跑测试与编译**

Run: `cd /Users/benghiong/Documents/Code/vscode-plugin && npm test 2>&1 | tail -20`
Expected: 全部通过。

Run: `cd /Users/benghiong/Documents/Code/vscode-plugin && npx tsc -p . --noEmit`
Expected: 无错误。

- [ ] **Step 7: 提交**

```bash
cd /Users/benghiong/Documents/Code/vscode-plugin
git add src/workspace/recentFiles.ts src/workspace/recentFiles.test.ts src/extension.ts
git commit -m "Record recent files and feed them to the matcher"
```

---

### Task 7: 高亮用匹配下标，更新文档

**Files:**
- Modify: `vscode-plugin/src/types.ts`
- Modify: `vscode-plugin/src/extension.ts`
- Modify: `vscode-plugin/src/panel/panelHtml.test.ts`（如有断言依赖高亮字段）
- Modify: `vscode-plugin/docs/superpowers/specs/2026-11-01-search-everywhere-design.md`（标注被新规格覆盖的条款）

**Interfaces:**
- Consumes: `SearchHit.titleRanges`（Task 5 已写入）。
- Produces: 无新导出。

- [ ] **Step 1: 加字段**

Modify `vscode-plugin/src/types.ts`，在 `SearchHit` 里加：

```ts
  /** Match ranges inside `title`, when the matcher supplied indices. */
  titleRanges?: Array<[number, number]>;
```

- [ ] **Step 2: 面板优先用 `titleRanges`**

Modify `vscode-plugin/src/extension.ts` 的 `toPayload` 映射：

```ts
titleRanges: hit.titleRanges ?? highlightRanges(hit.title, terms),
detailRanges: highlightRanges(hit.detail, terms),
previewRanges: highlightRanges(hit.preview ?? "", terms),
```

- [ ] **Step 3: 验证面板仍能渲染**

Run: `cd /Users/benghiong/Documents/Code/vscode-plugin && npm test 2>&1 | tail -20`
Expected: 全部通过；`panelHtml.test.ts` 若断言 `titleRanges` 由 `highlightRanges` 计算，按新行为更新断言。

- [ ] **Step 4: 在旧规格里标注覆盖关系**

Modify `vscode-plugin/docs/superpowers/specs/2026-11-01-search-everywhere-design.md`，在文件顶部「日期：2026-11-01」之后加一行：

```markdown
> 文件搜索的查询、排序、最近文件与高亮已被 `2026-11-02-file-search-wasm-design.md` 取代；其余条款继续有效。
```

- [ ] **Step 5: 提交**

```bash
cd /Users/benghiong/Documents/Code/vscode-plugin
git add src/types.ts src/extension.ts docs/superpowers/specs/2026-11-01-search-everywhere-design.md
git commit -m "Highlight file hits from matcher indices"
```

---

### Task 8: 手工验收

**Files:** 无改动。

**Interfaces:**
- Consumes: Task 1–7 全部产物。
- Produces: 验收结论。

- [ ] **Step 1: 构建并从扩展开发主机启动**

Run: `cd /Users/benghiong/Documents/Code/vscode-plugin && npm run compile && npm run build:wasm`
Expected: 编译无错，`vendor/wasm` 里有 `file_search.js` 与 `file_search_bg.wasm`。

在 VS Code 按 `F5` 启动扩展开发主机，打开一个多模块 Java 仓库。

- [ ] **Step 2: 逐项确认**

- 双击 Shift 打开面板。
- 空输入：文件组列出最近文件；打开几个文件后顺序变化。
- `ui/btn` 命中目录与文件名都符合的文件。
- `Button.tsx:12` 打开到第 12 行。
- `OCo` 命中 `OrderController`。
- 大仓库输入通用前缀（如 `c`）时，好文件出现在前 8 条，滚动不再漏。
- 改 `.gitignore` 后约 1 秒内名单更新；新建、删除文件立即反映。
- 多根工作区里同名文件可区分（显示 `文件夹名/路径`）。
- 把 `vendor/wasm` 改名后重启扩展：文件搜索仍可用，输出通道 `Search Everywhere` 有一条退回记录。

- [ ] **Step 3: 记录结论**

把每项的通过/失败写进提交说明或 PR 描述；失败的项回到对应任务修。

---

## Self-review

**Spec coverage：**

| 规格条款 | 对应任务 |
| --- | --- |
| 新建 `ide-file-search`，桌面端改调 | Task 1 |
| WASM 目标、`nodejs` target、产物提交 `vendor/wasm` | Task 2、Task 3 |
| WASM 接口六个导出 | Task 2、Task 3 |
| 查询：去空白、`./`、`:行:列`、`/` 分段、只有后缀、全空 | Task 1、Task 4 |
| 排序：常量、文件名档、驼峰、最近加分、短路径优先 | Task 1 |
| 最近文件 50 条、存储键、来源、丢弃失效项、空查询 | Task 6 |
| 工作区名单：全量重建、300ms 防抖、单条增删、50 条阈值、多根 key | Task 5 |
| 依赖名单整份换入 | Task 5（沿用现有 `refreshOnce`，`dependencyFileHits` 不变） |
| 失败时退回 + 输出通道 + 行号仍有效 | Task 3、Task 5 |
| 高亮用 `indices` | Task 7 |
| 限额三个新常量 | Task 3 |
| 测试：Rust 排序断言、插件纯模块、手工验收 | Task 1、Task 3–8 |

**Placeholder scan：** 无 TBD/TODO；每个代码步骤都给了完整代码。

**Type consistency：**

- `IndexedEntry { key, rel, library }` 在 Task 3 定义、Task 5/6 使用，字段一致。
- `FileHit { key, rel, score, indices }` 在 Task 1（Rust）、Task 3（TS）一致；`FileSearchResult { hits, total }` 一致。
- `FileQueryInput extends SearchQuery`，含 `text` 与可选 `line`，Task 5 的 `searchFiles(query: FileQueryInput, limit)` 与之一致。
- `keyFor(folder, relativePath, single)` 在 Task 5 定义，Task 6 的 `keyForPath` 复用它，参数顺序一致。
- `find_files` 的 Rust 签名 `(set, recents, query, limit, extensions) -> (Vec<FileHit>, usize)` 在 Task 1、Task 2 一致。

**已知遗留：** 无。`flushFileDeltas` 与 `scheduleFileDelta` 的文件夹判定统一走 `keyForPath` / `folderRoots()` 的 `single` 分支。
