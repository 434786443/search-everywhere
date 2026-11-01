import { inflateRawSync } from "node:zlib";

export interface ZipEntry { name: string; data: Buffer; }

export function readZip(bytes: Buffer): ZipEntry[] {
  const eocd = findEocd(bytes);
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff) throw new Error("zip64");
  const count = bytes.readUInt16LE(eocd + 10);
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    const method = bytes.readUInt16LE(p + 10);
    const compSize = bytes.readUInt32LE(p + 20);
    const nameLen = bytes.readUInt16LE(p + 28);
    const extraLen = bytes.readUInt16LE(p + 30);
    const commentLen = bytes.readUInt16LE(p + 32);
    const localOff = bytes.readUInt32LE(p + 42);
    const name = bytes.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const localNameLen = bytes.readUInt16LE(localOff + 26);
    const localExtraLen = bytes.readUInt16LE(localOff + 28);
    const start = localOff + 30 + localNameLen + localExtraLen;
    const compressed = bytes.subarray(start, start + compSize);
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : unsupported(method);
    entries.push({ name, data });
  }
  return entries;
}

function unsupported(method: number): never {
  throw new Error(`method ${method}`);
}

function findEocd(bytes: Buffer): number {
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (bytes.readUInt32LE(i) !== 0x06054b50) continue;
    const commentLen = bytes.readUInt16LE(i + 20);
    if (i + 22 + commentLen === bytes.length) return i;
  }
  throw new Error("eocd");
}
