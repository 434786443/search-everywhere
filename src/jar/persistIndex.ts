import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { IndexedJar, SourcesIdentity } from "./indexJar";

function cacheKey(jar: { jarPath: string; mtimeMs: number; size: number; sources?: SourcesIdentity }): string {
  return createHash("sha256").update(JSON.stringify({
    jarPath: jar.jarPath,
    mtimeMs: jar.mtimeMs,
    size: jar.size,
    sources: jar.sources ?? null,
  })).digest("hex");
}

function fileName(jar: IndexedJar): string {
  return `${cacheKey(jar)}.jarindex.json`;
}

export async function readPersistedJars(directory: string | undefined): Promise<IndexedJar[]> {
  if (!directory) return [];
  let names: string[] = [];
  try {
    names = await fs.readdir(directory);
  } catch {
    return [];
  }
  const jars: IndexedJar[] = [];
  for (const name of names) {
    if (!name.endsWith(".jarindex.json")) continue;
    try {
      jars.push(JSON.parse(await fs.readFile(path.join(directory, name), "utf8")) as IndexedJar);
    } catch {
      continue;
    }
  }
  return jars;
}

export async function writePersistedJars(directory: string | undefined, jars: IndexedJar[]): Promise<void> {
  if (!directory) return;
  await fs.mkdir(directory, { recursive: true });
  const keep = new Set<string>();
  for (const jar of jars) {
    const name = fileName(jar);
    keep.add(name);
    await fs.writeFile(path.join(directory, name), JSON.stringify(jar));
  }
  for (const name of await fs.readdir(directory)) {
    if (name.endsWith(".jarindex.json") && !keep.has(name)) await fs.rm(path.join(directory, name), { force: true });
  }
}
