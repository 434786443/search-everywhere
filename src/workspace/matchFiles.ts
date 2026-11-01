import { hitMatches, rankHits } from "../rank/rankHits";
import { SearchHit, SearchQuery } from "../types";

export interface IndexedFile { relativePath: string; uri: string; }

export function matchFiles(files: IndexedFile[], query: SearchQuery, limit = Number.POSITIVE_INFINITY): SearchHit[] {
  const hits: SearchHit[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const title = file.relativePath.split("/").pop() ?? file.relativePath;
    const dot = title.lastIndexOf(".");
    const hit: SearchHit = {
      id: `file:${file.uri}`,
      kind: "file",
      title,
      detail: file.relativePath,
      source: { type: "workspace" },
      uri: file.uri,
      extension: dot <= 0 ? "" : title.slice(dot).toLowerCase(),
      stableIndex: index,
    };
    if (!hitMatches(hit, query)) continue;
    hits.push(hit);
    if (hits.length >= limit) break;
  }
  return rankHits(hits, query);
}
