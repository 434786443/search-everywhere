import { SearchHit, SearchQuery } from "../types";

export function matchesExtension(hit: SearchHit, extensions: string[]): boolean {
  if (hit.kind === "command") return extensions.length === 0;
  if (extensions.length === 0) return true;
  if (extensions.includes(hit.extension)) return true;
  return Boolean(hit.treatAsJava && extensions.includes(".java"));
}

function stripExt(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 ? fileName : fileName.slice(0, dot);
}

function tierFor(hit: SearchHit, query: SearchQuery): 0 | 1 | 2 | undefined {
  if (!matchesExtension(hit, query.extensions)) return undefined;
  const terms = query.terms.map(term => term.toLowerCase());
  if (terms.length === 0) return 2;
  if (hit.kind === "content") {
    const preview = (hit.preview ?? "").toLowerCase();
    return terms.every(term => preview.includes(term)) ? 2 : undefined;
  }
  const fields = [hit.title, stripExt(hit.title), hit.detail].map(value => value.toLowerCase());
  if (terms.length === 1) {
    const term = terms[0];
    if (hit.kind === "file" || hit.kind === "symbol") {
      if (hit.title.toLowerCase() === term || stripExt(hit.title).toLowerCase() === term) return 0;
      if (stripExt(hit.title).toLowerCase().startsWith(term)) return 1;
    } else if (fields.some(field => field === term)) return 0;
    else if (fields.some(field => field.startsWith(term))) return 1;
  }
  return terms.every(term => fields.some(field => field.includes(term))) ? 2 : undefined;
}

export function rankHits(hits: SearchHit[], query: SearchQuery): SearchHit[] {
  return hits
    .map(hit => ({ hit, tier: tierFor(hit, query) }))
    .filter((item): item is { hit: SearchHit; tier: 0 | 1 | 2 } => item.tier !== undefined)
    .sort((a, b) => a.tier - b.tier
      || (a.hit.source.type === "workspace" ? 0 : 1) - (b.hit.source.type === "workspace" ? 0 : 1)
      || a.hit.stableIndex - b.hit.stableIndex)
    .map(item => item.hit);
}
