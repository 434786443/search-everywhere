import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClassFile } from "./classFile";
import { formatDeclaration } from "./declaration";

const HELLO_CLASS = "yv66vgAAAD0AFgoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWBwAIAQARY29tL2V4YW1wbGUvSGVsbG8HAAoBABJqYXZhL2xhbmcvUnVubmFibGUBAARDb2RlAQAPTGluZU51bWJlclRhYmxlAQAFZ3JlZXQBACYoTGphdmEvbGFuZy9TdHJpbmc7KUxqYXZhL2xhbmcvU3RyaW5nOwEABW5hbWVzAQAiKExqYXZhL3V0aWwvTGlzdDspTGphdmEvdXRpbC9MaXN0OwEACVNpZ25hdHVyZQEASihMamF2YS91dGlsL0xpc3Q8TGphdmEvbGFuZy9TdHJpbmc7PjspTGphdmEvdXRpbC9MaXN0PExqYXZhL2xhbmcvU3RyaW5nOz47AQADcnVuAQAKU291cmNlRmlsZQEACkhlbGxvLmphdmEAIQAHAAIAAQAJAAAABAABAAUABgABAAsAAAAdAAEAAQAAAAUqtwABsQAAAAEADAAAAAYAAQAAAAYAAQANAA4AAQALAAAAGgABAAIAAAACK7AAAAABAAwAAAAGAAEAAAAHAAEADwAQAAIACwAAABoAAQACAAAAAiuwAAAAAQAMAAAABgABAAAACAARAAAAAgASAAEAEwAGAAEACwAAABkAAAABAAAAAbEAAAABAAwAAAAGAAEAAAAJAAEAFAAAAAIAFQ==";

test("declaration shows generic signatures and no method bodies", () => {
  const text = formatDeclaration(parseClassFile(Buffer.from(HELLO_CLASS, "base64")));
  assert.match(text, /^package com\.example;/);
  assert.match(text, /public class Hello implements java\.lang\.Runnable/);
  assert.match(text, /public java\.lang\.String greet\(java\.lang\.String\);/);
  assert.match(text, /public java\.util\.List<java\.lang\.String> names\(java\.util\.List<java\.lang\.String>\);/);
  assert.equal(text.includes("java.lang.Object"), false);
  assert.equal(text.includes("invoke"), false);
  assert.equal(text.includes("field"), false);
});

test("truncated signature finishes instead of hanging", () => {
  const text = formatDeclaration({
    access: 0x0001,
    thisName: "com/example/Hello",
    superName: "java/lang/Object",
    interfaces: [],
    methods: [
      { access: 0x0001, name: "cutOff", descriptor: "(Ljava/lang/String;)Ljava/lang/String;", signature: "(Ltruncated" },
      { access: 0x0001, name: "typeVar", descriptor: "()V", signature: "(TNoSemi" },
    ],
    hasRecord: false,
  });
  assert.match(text, /public java\.lang\.String cutOff\(java\.lang\.String\);/);
  assert.match(text, /public void typeVar\(\);/);
});
