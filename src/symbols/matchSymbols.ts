import { hitMatches, rankHits } from "../rank/rankHits";
import { SearchHit, SearchQuery } from "../types";

export interface WorkspaceSymbolInput { name: string; detail: string; uri: string; line: number; extension: string; }
export interface DependencyClassInput { simpleName: string; detail: string; jarPath: string; jarName: string; entry: string; }

export function matchWorkspaceSymbols(symbols: WorkspaceSymbolInput[], query: SearchQuery): SearchHit[] {
  if (query.terms.length === 0) return [];
  const hits: SearchHit[] = symbols.map((symbol, stableIndex) => ({
    id: `symbol:${symbol.uri}:${symbol.line}:${symbol.name}`,
    kind: "symbol",
    title: symbol.name,
    detail: symbol.detail,
    source: { type: "workspace" },
    uri: symbol.uri,
    line: symbol.line,
    extension: symbol.extension,
    stableIndex,
  }));
  return rankHits(hits, query);
}

export function matchDependencyClasses(classes: Iterable<DependencyClassInput>, query: SearchQuery, limit = Number.POSITIVE_INFINITY): SearchHit[] {
  const hits: SearchHit[] = [];
  let stableIndex = 0;
  for (const item of classes) {
    const hit: SearchHit = {
      id: `jar-class:${item.jarPath}!${item.entry}`,
      kind: "symbol",
      title: item.simpleName,
      detail: item.detail,
      source: { type: "jar", jarPath: item.jarPath, jarName: item.jarName },
      extension: ".class",
      treatAsJava: true,
      stableIndex,
      entry: item.entry,
    };
    stableIndex += 1;
    if (!hitMatches(hit, query)) continue;
    hits.push(hit);
    if (hits.length >= limit) break;
  }
  return rankHits(hits, query);
}
