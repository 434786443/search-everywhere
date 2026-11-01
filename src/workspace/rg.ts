import { SearchHit, SearchQuery } from "../types";

export interface RgMatch { path: string; line: number; preview: string; }

export function normalizeRgPath(filePath: string): string {
  if (filePath.startsWith(".\\")) return filePath.slice(2).replaceAll("\\", "/");
  if (filePath.startsWith("./")) return filePath.slice(2);
  return filePath;
}

export function toRgExclude(pattern: string): string {
  const body = pattern.startsWith("**/") ? pattern : `**/${pattern.replace(/^!/, "")}`;
  return body.startsWith("!") ? body : `!${body}`;
}

export function parseRgFiles(stdout: string): string[] {
  return stdout.split(/\r?\n/).map(line => normalizeRgPath(line.trim())).filter(Boolean);
}

export function parseRgMatches(stdout: string, limit: number): RgMatch[] {
  const matches: RgMatch[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const found = /^(.*?):(\d+):(.*)$/.exec(raw);
    if (!found || found[3].length > MAX_CONTENT_LINE) continue;
    const preview = found[3].length > MAX_PREVIEW ? `${found[3].slice(0, MAX_PREVIEW)}…` : found[3];
    matches.push({ path: normalizeRgPath(found[1]), line: Number(found[2]), preview });
    if (matches.length === limit) break;
  }
  return matches;
}

const MAX_PREVIEW = 240;
const MAX_CONTENT_LINE = 1000;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contentPattern(term: string): string {
  const escaped = escapeRegex(term);
  return /^@[A-Za-z_][\w$]*$/.test(term) ? `${escaped}\\b` : escaped;
}

export function contentRgArgs(query: SearchQuery, excludeGlobs: string[]): string[] {
  const annotationQuery = query.terms.some(term => term.startsWith("@"));
  const extensions = annotationQuery && query.extensions.length === 0 ? [".java"] : query.extensions;
  const pattern = query.terms.map(term => `(?=.*${contentPattern(term)})`).join("") + ".*";
  const globs = [
    ...excludeGlobs.flatMap(glob => ["--glob", glob]),
    "--glob", "!**/*.prefs",
    ...extensions.flatMap(extension => ["--glob", `*${extension}`]),
  ];
  return ["--pcre2", "-n", "-i", "--no-heading", "--glob", "!.git/**", ...globs, pattern, "."];
}

export function fileRgArgs(excludeGlobs: string[]): string[] {
  return ["--files", "--hidden", "--glob", "!.git/**", "--iglob", "!.git/**", ...excludeGlobs.flatMap(glob => ["--glob", glob])];
}

export async function searchContentFolders<TFolder extends { key: string }>(
  folders: readonly TFolder[],
  read: (folder: TFolder) => Promise<string>,
  limit: number,
  dependency: SearchHit[],
  toHit: (folderKey: string, match: RgMatch, stableIndex: number) => SearchHit,
): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  for (const folder of folders) {
    if (hits.length >= limit) break;
    try {
      const parsed = parseRgMatches(await read(folder), limit - hits.length);
      for (const match of parsed) hits.push(toHit(folder.key, match, hits.length));
    } catch {
      continue;
    }
  }
  return [...hits, ...dependency];
}
