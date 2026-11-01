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
