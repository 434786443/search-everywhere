# Search Everywhere

双击 Shift 打开的搜索面板，在 VS Code 里搜索工作区文件名、文件内容、符号和命令，并把 Maven / Gradle 的传递依赖包纳入同一套搜索。

## 搜索范围

- **文件名**：模糊匹配，支持 `目录/文件名` 分段查询、`文件名:行号` 定位、驼峰简写（`OCo` → `OrderController`），最近打开的文件优先。
- **内容**：调用 VS Code 自带的 ripgrep，多个搜索词需要出现在同一行。
- **符号**：工作区符号，加上依赖包里的类名。
- **命令**：已安装扩展贡献的命令。
- **依赖包**：Maven 与 Gradle 的传递依赖，类名、源码、文本都可搜。

后缀过滤在取结果之前生效：`.java`、`*.java,*.xml`。

## 文件匹配的实现

文件名匹配的排序代码来自 [OpenIDEA](https://github.com/l0ng-ai/openidea) 的 `find_files`，通过 WebAssembly 调用，桌面版 IDE 与这个插件共用同一份逻辑。

`vendor/wasm/` 里是预编译产物，安装插件的人不需要 Rust 工具链。改动匹配逻辑后需要重新生成：

```bash
npm run build:wasm -- /path/to/openidea
```

## 开发

```bash
npm install
npm run compile
npm test
```

在 VS Code 中按 `F5` 启动扩展开发主机。

## 打包

```bash
npm run compile
npx @vscode/vsce package --allow-missing-repository
code --install-extension search-everywhere-0.0.1.vsix
```

注意两点：

- 不要加 `--no-dependencies`。它会把 `node_modules` 排除出包，`@vscode/ripgrep` 的平台二进制就丢了，文件名和内容搜索会失效。
- 打出的包只含**当前平台**的 ripgrep 二进制。要在别的平台使用，请在目标平台上重新 `npm install` 后打包。

## 设计文档

- 整体设计：`docs/superpowers/specs/2026-11-01-search-everywhere-design.md`
- 文件搜索改用 WASM：`docs/superpowers/specs/2026-11-02-file-search-wasm-design.md`
- 实施计划：`docs/superpowers/plans/2026-11-02-file-search-wasm.md`
