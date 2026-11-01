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

function isWordStart(value: string, index: number): boolean {
  if (index === 0) return true;
  const previous = value[index - 1];
  const current = value[index];
  return (/[a-z]/i.test(current) && !/[a-z0-9]/i.test(previous))
    || (/[a-z]/.test(previous) && /[A-Z]/.test(current));
}

function characterMatches(patternCharacter: string, valueCharacter: string): boolean {
  if (/[A-Z]/.test(patternCharacter)) return patternCharacter === valueCharacter;
  return patternCharacter.toLowerCase() === valueCharacter.toLowerCase();
}

function matchedPositions(pattern: string, value: string): number[] | undefined {
  const memo = new Map<string, number[] | undefined>();
  const search = (patternIndex: number, after: number): number[] | undefined => {
    if (patternIndex === pattern.length) return [];
    const key = `${patternIndex}:${after}`;
    if (memo.has(key)) return memo.get(key);
    const candidates: number[] = [];
    for (let index = after + 1; index < value.length; index += 1) {
      if (characterMatches(pattern[patternIndex], value[index])) candidates.push(index);
    }
    candidates.sort((left, right) =>
      Number(isWordStart(value, right)) - Number(isWordStart(value, left)) || left - right);
    for (const index of candidates) {
      const suffix = search(patternIndex + 1, index);
      if (suffix) {
        const result = [index, ...suffix];
        memo.set(key, result);
        return result;
      }
    }
    memo.set(key, undefined);
    return undefined;
  };
  return search(0, -1);
}

function degree(pattern: string, value: string): number | undefined {
  if (pattern.length === 0) return 0;
  const positions = matchedPositions(pattern, value);
  if (!positions) return undefined;

  const fragmentStarts = positions.filter((position, index) =>
    index === 0 || position !== positions[index - 1] + 1);
  let score = pattern.length * 10 - (value.length - pattern.length);
  if (fragmentStarts[0] === 0) score += 10000;
  score += fragmentStarts.filter(position => position !== 0 && isWordStart(value, position)).length * 1000;
  if (value.toLowerCase() === pattern.toLowerCase()
    && [...pattern].every((character, index) => !/[A-Z]/.test(character) || /[A-Z]/.test(value[index]))) {
    score += 1000000;
  }
  return score;
}

interface MatchScore {
  degree: number;
  hasNameMatch: boolean;
}

function annotationTerm(term: string): { pattern: string; annotation: boolean } {
  if (!term.startsWith("@")) return { pattern: term, annotation: false };
  return { pattern: term.slice(1).toLowerCase(), annotation: true };
}

function isAnnotationHit(hit: SearchHit): boolean {
  return Boolean(hit.annotation) || hit.title.startsWith("@") || hit.detail.includes("@interface");
}

function scoreFor(hit: SearchHit, terms: string[]): MatchScore | undefined {
  let degreeScore = 0;
  let hasNameMatch = false;
  for (const term of terms) {
    const parsed = annotationTerm(term);
    if (parsed.annotation && parsed.pattern.length === 0) {
      if (!isAnnotationHit(hit)) return undefined;
      degreeScore += 1;
      hasNameMatch = true;
      continue;
    }
    const patterns = parsed.annotation ? [parsed.pattern, term] : [term];
    if (hit.kind === "command") {
      const best = Math.max(...patterns.flatMap(pattern => [degree(pattern, hit.title) ?? -Infinity, degree(pattern, hit.detail) ?? -Infinity]));
      if (best === -Infinity) return undefined;
      degreeScore += best;
      continue;
    }

    const candidates = patterns.flatMap(pattern => [
      { degree: degree(pattern, hit.title), name: true },
      { degree: degree(pattern, stripExt(hit.title)), name: true },
      { degree: degree(pattern, hit.detail), name: false },
    ]).filter((candidate): candidate is { degree: number; name: boolean } => candidate.degree !== undefined);
    if (candidates.length === 0) return undefined;
    const nameCandidates = candidates.filter(candidate => candidate.name);
    const comparableCandidates = nameCandidates.length > 0 ? nameCandidates : candidates;
    const best = comparableCandidates.reduce((current, candidate) =>
      candidate.degree > current.degree ? candidate : current);
    degreeScore += best.degree + (parsed.annotation && isAnnotationHit(hit) ? 2_000_000 : 0);
    hasNameMatch ||= best.name;
  }
  return { degree: degreeScore, hasNameMatch };
}

export function hitMatches(hit: SearchHit, query: SearchQuery): boolean {
  if (!matchesExtension(hit, query.extensions)) return false;
  if (hit.kind === "content") {
    const previewLines = (hit.preview ?? "").toLowerCase().split(/\r\n?|\n/);
    return previewLines.some(line => query.terms.every(term => term === "@" ? /@[A-Za-z_]/.test(line) : line.toLowerCase().includes(term.toLowerCase())));
  }
  return scoreFor(hit, query.terms) !== undefined;
}

function contiguousRanges(text: string, term: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  let from = 0;
  while (from <= text.length - term.length) {
    const index = lower.indexOf(needle, from);
    if (index < 0) break;
    const caseMatches = [...term].every((character, offset) => !/[A-Z]/.test(character) || text[index + offset] === character);
    if (caseMatches) {
      ranges.push([index, index + term.length]);
      from = index + term.length;
    } else {
      from = index + 1;
    }
  }
  return ranges;
}

function rangesFromPositions(positions: number[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const position of positions) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === position) last[1] = position + 1;
    else ranges.push([position, position + 1]);
  }
  return ranges;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

export function highlightRanges(text: string, terms: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    if (term.length === 0) continue;
    const patterns = term.startsWith("@") && term.length > 1 ? [term, term.slice(1)] : [term];
    let matched = false;
    for (const pattern of patterns) {
      const contiguous = contiguousRanges(text, pattern);
      if (contiguous.length > 0) {
        ranges.push(...contiguous);
        matched = true;
        break;
      }
      const positions = matchedPositions(pattern, text);
      if (positions) {
        ranges.push(...rangesFromPositions(positions));
        matched = true;
        break;
      }
    }
    if (!matched && term === "@" && text.startsWith("@")) ranges.push([0, 1]);
  }
  return mergeRanges(ranges);
}

export function rankHits(hits: SearchHit[], query: SearchQuery): SearchHit[] {
  const terms = query.terms;
  return hits
    .filter(hit => hitMatches(hit, query))
    .map(hit => {
      if (hit.kind === "content") return { hit, score: { degree: 0, hasNameMatch: false } as MatchScore };
      return { hit, score: scoreFor(hit, terms) as MatchScore };
    })
    .sort((a, b) => (a.hit.kind === "content" && b.hit.kind === "content" ? 0
      : Number(b.score.hasNameMatch) - Number(a.score.hasNameMatch) || b.score.degree - a.score.degree)
      || (a.hit.source.type === "workspace" ? 0 : 1) - (b.hit.source.type === "workspace" ? 0 : 1)
      || a.hit.stableIndex - b.hit.stableIndex)
    .map(item => item.hit);
}
