import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldPublish } from "./shouldPublish";

test("fast id 1, latest id 2, same generation: do not publish", () => {
  assert.equal(shouldPublish({
    requestId: 1,
    latestRequestId: 2,
    generation: 4,
    currentGeneration: 4,
  }), false);
});

test("content id 2, latest id 2, same generation: publish", () => {
  assert.equal(shouldPublish({
    requestId: 2,
    latestRequestId: 2,
    generation: 4,
    currentGeneration: 4,
  }), true);
});

test("either id, generation no longer current: do not publish", () => {
  assert.equal(shouldPublish({
    requestId: 1,
    latestRequestId: 2,
    generation: 4,
    currentGeneration: 5,
  }), false);
  assert.equal(shouldPublish({
    requestId: 2,
    latestRequestId: 2,
    generation: 4,
    currentGeneration: 5,
  }), false);
});
