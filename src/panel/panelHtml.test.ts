import { test } from "node:test";
import assert from "node:assert/strict";
import { createPanelNonce, panelHtml } from "./panelHtml";
import { EMPTY_HINT } from "../limits";

test("panel contains four tabs and the empty hint", () => {
  const html = panelHtml({ scriptUri: "script.js", styleUri: "panel.css", cspSource: "csp", nonce: "n" });
  for (const label of ["全部", "文件", "符号", "命令", EMPTY_HINT]) assert.ok(html.includes(label));
  assert.ok(html.includes("nonce=\"n\""));
});

test("nonce is random for each panel open", () => {
  const first = createPanelNonce();
  const second = createPanelNonce();
  assert.notEqual(first, second);
  assert.equal(/^\d+$/.test(first), false);
});
