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
