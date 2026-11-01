import { ALL_GROUP_CAP, TAB_CAP } from "../limits";
import { rankHits } from "../rank/rankHits";
import { SearchHit, SearchQuery, SearchTab } from "../types";

export interface SearchProvider { search(query: SearchQuery): Promise<SearchHit[]>; }
export interface ResultGroup { hits: SearchHit[]; truncated: boolean; }
export interface GroupedResults {
  stale: boolean;
  files: ResultGroup;
  symbols: ResultGroup;
  commands: ResultGroup;
  content: ResultGroup;
  contentFailed: boolean;
}
export interface CoordinateInput {
  query: SearchQuery;
  tab: SearchTab;
  includeContent: boolean;
  providers: { files: SearchProvider; symbols: SearchProvider; commands: SearchProvider; content: SearchProvider };
  isStale(): boolean;
}

function group(hits: SearchHit[], limit: number): ResultGroup {
  return { hits: hits.slice(0, limit), truncated: hits.length > limit };
}

export function emptyResults(stale = false): GroupedResults {
  const empty = { hits: [], truncated: false };
  return { stale, files: empty, symbols: empty, commands: empty, content: empty, contentFailed: false };
}

export async function coordinate(input: CoordinateInput): Promise<GroupedResults> {
  const { query, tab } = input;
  if (query.terms.length === 0 && query.extensions.length === 0) return emptyResults(false);
  const limit = tab === "all" ? ALL_GROUP_CAP : TAB_CAP;
  const wantFiles = tab === "all" || tab === "files";
  const wantSymbols = tab === "all" || tab === "symbols";
  const wantCommands = (tab === "all" || tab === "commands") && query.extensions.length === 0 && query.terms.length > 0;
  const wantContent = input.includeContent && query.terms.length > 0 && (tab === "all" || tab === "files");
  const files = wantFiles ? await input.providers.files.search(query) : [];
  const symbols = wantSymbols ? await input.providers.symbols.search(query) : [];
  const commands = wantCommands ? await input.providers.commands.search(query) : [];
  let content: SearchHit[] = [];
  let contentFailed = false;
  if (wantContent) {
    try { content = await input.providers.content.search(query); }
    catch { contentFailed = true; }
  }
  if (input.isStale()) return emptyResults(true);
  return {
    stale: false,
    files: group(rankHits(files, query), limit),
    symbols: group(rankHits(symbols, query), limit),
    commands: group(rankHits(commands, query), limit),
    content: group(rankHits(content, query), limit),
    contentFailed,
  };
}
