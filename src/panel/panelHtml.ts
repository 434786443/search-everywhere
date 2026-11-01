import { randomBytes } from "node:crypto";
import { EMPTY_HINT } from "../limits";

export function createPanelNonce(): string {
  return randomBytes(16).toString("base64url");
}

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
