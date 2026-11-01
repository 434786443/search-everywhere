import { test } from "node:test";
import assert from "node:assert/strict";
import { highlightRanges } from "./rankHits";

test("highlights a case-insensitive word in a file name", () => {
  assert.deepEqual(highlightRanges("UserService.java", ["user"]), [[0, 4]]);
});

test("highlights every term in a preview line", () => {
  assert.deepEqual(highlightRanges("class UserService {}", ["User", "Service"]), [[6, 17]]);
});

test("highlights an annotation query in the name and the at sign", () => {
  assert.deepEqual(highlightRanges("@Service", ["@Service"]), [[0, 8]]);
  assert.deepEqual(highlightRanges("Service.java", ["@Service"]), [[0, 7]]);
});

test("highlights camel-hump letters when the term is not contiguous", () => {
  assert.deepEqual(highlightRanges("UserService", ["US"]), [[0, 1], [4, 5]]);
});
