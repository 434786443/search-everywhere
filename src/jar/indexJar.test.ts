import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { FILE_TEXT_CAP, JAR_TEXT_CAP } from "../limits";
import { indexJarEntries, sameJarIdentity } from "./indexJar";
import { readZip } from "./readZip";

const HELLO_CLASS = "yv66vgAAAD0AFgoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWBwAIAQARY29tL2V4YW1wbGUvSGVsbG8HAAoBABJqYXZhL2xhbmcvUnVubmFibGUBAARDb2RlAQAPTGluZU51bWJlclRhYmxlAQAFZ3JlZXQBACYoTGphdmEvbGFuZy9TdHJpbmc7KUxqYXZhL2xhbmcvU3RyaW5nOwEABW5hbWVzAQAiKExqYXZhL3V0aWwvTGlzdDspTGphdmEvdXRpbC9MaXN0OwEACVNpZ25hdHVyZQEASihMamF2YS91dGlsL0xpc3Q8TGphdmEvbGFuZy9TdHJpbmc7PjspTGphdmEvdXRpbC9MaXN0PExqYXZhL2xhbmcvU3RyaW5nOz47AQADcnVuAQAKU291cmNlRmlsZQEACkhlbGxvLmphdmEAIQAHAAIAAQAJAAAABAABAAUABgABAAsAAAAdAAEAAQAAAAUqtwABsQAAAAEADAAAAAYAAQAAAAYAAQANAA4AAQALAAAAGgABAAIAAAACK7AAAAABAAwAAAAGAAEAAAAHAAEADwAQAAIACwAAABoAAQACAAAAAiuwAAAAAQAMAAAABgABAAAACAARAAAAAgASAAEAEwAGAAEACwAAABkAAAABAAAAAbEAAAABAAwAAAAGAAEAAAAJAAEAFAAAAAIAFQ==";

function zipStoredAndDeflate(files: { name: string; data: Buffer; method: 0 | 8 }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const stored = file.method === 0 ? file.data : deflateRawSync(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(file.method, 8);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const chunk = Buffer.concat([local, name, stored]);
    locals.push(chunk);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(file.method, 10);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += chunk.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

test("indexes class names and capped text from a stored and deflate zip", () => {
  const xml = Buffer.from("<app>User</app>");
  const hello = Buffer.from(HELLO_CLASS, "base64");
  const broken = Buffer.from("not a class");
  const bytes = zipStoredAndDeflate([
    { name: "com/example/Hello.class", data: hello, method: 8 },
    { name: "meta/app.xml", data: xml, method: 0 },
    { name: "com/example/Broken.class", data: broken, method: 0 },
  ]);
  const entries = readZip(bytes);
  const identity = { jarPath: "/libs/app.jar", mtimeMs: 10, size: bytes.length };
  const indexed = indexJarEntries({ ...identity, entries, fileTextCap: FILE_TEXT_CAP, jarTextCap: JAR_TEXT_CAP });

  assert.equal(indexed.classes[0].simpleName, "Hello");
  assert.match(indexed.classes[0].declaration, /greet/);
  const xmlText = indexed.texts.find(item => item.entry === "meta/app.xml");
  assert.ok(xmlText);
  assert.equal(xmlText.text, "<app>User</app>");
  assert.equal(xmlText.truncated, false);
  assert.equal(indexed.texts.some(item => item.entry.endsWith(".class") || item.text.includes("Hello.java")), false);

  const brokenClass = indexed.classes.find(item => item.entry === "com/example/Broken.class");
  assert.ok(brokenClass);
  assert.equal(brokenClass.simpleName, "Broken");
  assert.equal(brokenClass.signaturesFailed, true);
  assert.match(brokenClass.declaration, /无法读取方法签名/);

  const capped = indexJarEntries({ ...identity, entries, fileTextCap: 4, jarTextCap: JAR_TEXT_CAP });
  assert.equal(capped.texts.some(item => item.entry === "meta/app.xml"), false);
  const xmlPath = capped.paths.find(item => item.entry === "meta/app.xml");
  assert.ok(xmlPath);
  assert.equal(xmlPath.truncated, true);

  assert.equal(sameJarIdentity(indexed, identity), true);
  assert.equal(sameJarIdentity(indexed, { ...identity, size: identity.size + 1 }), false);
});
