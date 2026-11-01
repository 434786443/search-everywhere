import { rankHits } from "../rank/rankHits";
import { SearchHit, SearchQuery } from "../types";

export interface IndexedFile { relativePath: string; uri: string; }

export function matchFiles(files: IndexedFile[], query: SearchQuery): SearchHit[] {
  const hits: SearchHit[] = files.map((file, stableIndex) => {
    const title = file.relativePath.split("/").pop() ?? file.relativePath;
    const dot = title.lastIndexOf(".");
    return {
      id: `file:${file.uri}`,
      kind: "file",
      title,
      detail: file.relativePath,
      source: { type: "workspace" },
      uri: file.uri,
      extension: dot <= 0 ? "" : title.slice(dot).toLowerCase(),
      stableIndex,
    };
  });
  return rankHits(hits, query);
}
