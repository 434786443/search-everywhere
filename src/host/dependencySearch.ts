import { basename } from "node:path";
import { IndexedJar } from "../jar/indexJar";
import { rankHits } from "../rank/rankHits";
import { matchDependencyClasses } from "../symbols/matchSymbols";
import { HitSource, SearchHit, SearchQuery } from "../types";

function jarSource(jarPath: string): HitSource {
  return { type: "jar", jarPath, jarName: basename(jarPath) };
}

function entryTitle(entry: string): string {
  return entry.split("/").pop() ?? entry;
}

function entryExtension(entry: string): string {
  const base = entryTitle(entry);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

function fileEntries(jar: IndexedJar): { entry: string; truncated: boolean }[] {
  const byEntry = new Map<string, { entry: string; truncated: boolean }>();
  const add = (entry: string, truncated: boolean) => {
    const existing = byEntry.get(entry);
    if (existing) {
      existing.truncated = existing.truncated || truncated;
      return;
    }
    byEntry.set(entry, { entry, truncated });
  };
  for (const item of jar.classes) add(item.entry, false);
  for (const item of jar.texts) add(item.entry, item.truncated);
  for (const item of jar.paths) add(item.entry, item.truncated);
  return [...byEntry.values()];
}

export function dependencyFileHits(jars: IndexedJar[], query: SearchQuery): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const jar of jars) {
    for (const item of fileEntries(jar)) {
      hits.push({
        id: `jar-file:${jar.jarPath}!${item.entry}`,
        kind: "file",
        title: entryTitle(item.entry),
        detail: item.entry,
        source: jarSource(jar.jarPath),
        extension: entryExtension(item.entry),
        textTruncated: item.truncated,
        stableIndex: hits.length,
        entry: item.entry,
      });
    }
  }
  return rankHits(hits, query);
}

export function dependencySymbolHits(jars: IndexedJar[], query: SearchQuery): SearchHit[] {
  return matchDependencyClasses(jars.flatMap(jar => jar.classes.map(item => ({
    simpleName: item.simpleName,
    detail: item.binaryName,
    jarPath: jar.jarPath,
    jarName: basename(jar.jarPath),
    entry: item.entry,
  }))), query);
}

export function dependencyContentHits(jars: IndexedJar[], query: SearchQuery): SearchHit[] {
  const hits: SearchHit[] = [];
  const terms = query.terms.map(term => term.toLowerCase());
  if (terms.length > 0) {
    for (const jar of jars) {
      for (const record of jar.texts) {
        const lines = record.text.split(/\r\n?|\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          const lower = line.toLowerCase();
          if (!terms.every(term => lower.includes(term))) continue;
          const lineNumber = index + 1;
          hits.push({
            id: `jar-content:${jar.jarPath}!${record.entry}:${lineNumber}`,
            kind: "content",
            title: entryTitle(record.entry),
            detail: record.entry,
            source: jarSource(jar.jarPath),
            line: lineNumber,
            preview: line,
            extension: entryExtension(record.entry),
            textTruncated: record.truncated,
            stableIndex: hits.length,
            entry: record.entry,
          });
        }
      }
    }
  }
  return rankHits(hits, query);
}
