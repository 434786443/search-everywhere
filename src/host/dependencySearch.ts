import { basename } from "node:path";
import { IndexedJar } from "../jar/indexJar";
import { hitMatches, rankHits } from "../rank/rankHits";
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

function considerFileEntry(
  jar: IndexedJar,
  seen: Map<string, SearchHit>,
  hits: SearchHit[],
  query: SearchQuery,
  entry: string,
  truncated: boolean,
  limit: number,
): boolean {
  const existing = seen.get(entry);
  if (existing) {
    existing.textTruncated = existing.textTruncated || truncated;
    return hits.length >= limit;
  }
  const hit: SearchHit = {
    id: `jar-file:${jar.jarPath}!${entry}`,
    kind: "file",
    title: entryTitle(entry),
    detail: entry,
    source: jarSource(jar.jarPath),
    extension: entryExtension(entry),
    textTruncated: truncated,
    stableIndex: hits.length,
    entry,
  };
  seen.set(entry, hit);
  if (!hitMatches(hit, query)) return false;
  hits.push(hit);
  return hits.length >= limit;
}

export function dependencyFileHits(jars: IndexedJar[], query: SearchQuery, limit = Number.POSITIVE_INFINITY): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const jar of jars) {
    const seen = new Map<string, SearchHit>();
    let filled = false;
    for (const item of jar.classes) {
      if (considerFileEntry(jar, seen, hits, query, item.entry, false, limit)) { filled = true; break; }
    }
    if (filled) break;
    for (const item of jar.texts) {
      if (considerFileEntry(jar, seen, hits, query, item.entry, item.truncated, limit)) { filled = true; break; }
    }
    if (filled) break;
    for (const item of jar.paths) {
      if (considerFileEntry(jar, seen, hits, query, item.entry, item.truncated, limit)) { filled = true; break; }
    }
    if (filled) break;
  }
  return rankHits(hits, query);
}

export function dependencySymbolHits(jars: IndexedJar[], query: SearchQuery, limit = Number.POSITIVE_INFINITY): SearchHit[] {
  return matchDependencyClasses(function* classes() {
    for (const jar of jars) {
      for (const item of jar.classes) {
        yield {
          simpleName: item.simpleName,
          detail: item.binaryName,
          annotation: item.annotation,
          jarPath: jar.jarPath,
          jarName: basename(jar.jarPath),
          entry: item.entry,
        };
      }
    }
  }(), query, limit);
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
          if (!terms.every(term => term === "@" ? /@[A-Za-z_]/.test(line) : lower.includes(term))) continue;
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
