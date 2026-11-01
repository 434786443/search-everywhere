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
