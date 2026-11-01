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
    if (!found) continue;
    matches.push({ path: normalizeRgPath(found[1]), line: Number(found[2]), preview: found[3] });
    if (matches.length === limit) break;
  }
  return matches;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function contentRgArgs(query: SearchQuery, excludeGlobs: string[]): string[] {
  const pattern = query.terms.map(term => `(?=.*${escapeRegex(term)})`).join("") + ".*";
  const globs = [
    ...excludeGlobs.flatMap(glob => ["--glob", glob]),
    ...query.extensions.flatMap(extension => ["--glob", `*${extension}`]),
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
