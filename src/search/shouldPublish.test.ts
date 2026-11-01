import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldPublish } from "./shouldPublish";

test("filename-only, content not posted, same generation: publish", () => {
  assert.equal(shouldPublish({
    generation: 4,
    currentGeneration: 4,
    includeContent: false,
    contentPosted: false,
  }), true);
});

test("filename-only, content already posted for this generation: do not publish", () => {
  assert.equal(shouldPublish({
    generation: 4,
    currentGeneration: 4,
    includeContent: false,
    contentPosted: true,
  }), false);
});

test("content publish, same generation: publish", () => {
  assert.equal(shouldPublish({
    generation: 4,
    currentGeneration: 4,
    includeContent: true,
    contentPosted: false,
  }), true);
  assert.equal(shouldPublish({
    generation: 4,
    currentGeneration: 4,
    includeContent: true,
    contentPosted: true,
  }), true);
});

test("any publish whose generation is no longer current: do not publish", () => {
  assert.equal(shouldPublish({
    generation: 4,
    currentGeneration: 5,
    includeContent: false,
    contentPosted: false,
  }), false);
  assert.equal(shouldPublish({
    generation: 4,
    currentGeneration: 5,
    includeContent: true,
    contentPosted: false,
  }), false);
  assert.equal(shouldPublish({
    generation: 4,
    currentGeneration: 5,
    includeContent: false,
    contentPosted: true,
  }), false);
  assert.equal(shouldPublish({
    generation: 4,
    currentGeneration: 5,
    includeContent: true,
    contentPosted: true,
  }), false);
});
