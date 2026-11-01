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
