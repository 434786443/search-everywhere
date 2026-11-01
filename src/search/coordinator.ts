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
  prior?: { files: ResultGroup; symbols: ResultGroup; commands: ResultGroup };
}

function group(hits: SearchHit[], limit: number): ResultGroup {
  return { hits: hits.slice(0, limit), truncated: hits.length > limit };
}

function blankGroup(): ResultGroup {
  return { hits: [], truncated: false };
}

export function emptyResults(stale = false): GroupedResults {
  return { stale, files: blankGroup(), symbols: blankGroup(), commands: blankGroup(), content: blankGroup(), contentFailed: false };
}

export async function coordinate(input: CoordinateInput): Promise<GroupedResults> {
  const { query, tab } = input;
  if (query.terms.length === 0 && query.extensions.length === 0) return emptyResults(false);
  const limit = tab === "all" ? ALL_GROUP_CAP : TAB_CAP;
  const wantFiles = tab === "all" || tab === "files";
  const wantSymbols = tab === "all" || tab === "symbols";
  const wantCommands = (tab === "all" || tab === "commands") && query.extensions.length === 0 && query.terms.length > 0;
  const wantContent = input.includeContent && query.terms.length > 0 && (tab === "all" || tab === "files");
  let contentFailed = false;

  const start = (
    provider: SearchProvider,
    wanted: boolean,
    onFailure?: () => void,
  ): Promise<SearchHit[]> => {
    if (!wanted) return Promise.resolve([]);
    try {
      return Promise.resolve(provider.search(query)).catch(() => {
        onFailure?.();
        return [];
      });
    } catch {
      onFailure?.();
      return Promise.resolve([]);
    }
  };

  const reuse = input.includeContent ? input.prior : undefined;
  const filesPromise = reuse ? Promise.resolve([]) : start(input.providers.files, wantFiles);
  const symbolsPromise = reuse ? Promise.resolve([]) : start(input.providers.symbols, wantSymbols);
  const commandsPromise = reuse ? Promise.resolve([]) : start(input.providers.commands, wantCommands);
  const contentPromise = start(input.providers.content, wantContent, () => {
    contentFailed = true;
  });
  const [files, symbols, commands, content] = await Promise.all([
    filesPromise,
    symbolsPromise,
    commandsPromise,
    contentPromise,
  ]);
  if (input.isStale()) return emptyResults(true);
  return {
    stale: false,
    files: reuse ? reuse.files : group(rankHits(files, query), limit),
    symbols: reuse ? reuse.symbols : group(rankHits(symbols, query), limit),
    commands: reuse ? reuse.commands : group(rankHits(commands, query), limit),
    content: group(rankHits(content, query), limit),
    contentFailed,
  };
}
