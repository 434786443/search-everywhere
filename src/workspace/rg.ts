import { SearchQuery } from "../types";

export interface RgMatch { path: string; line: number; preview: string; }

export function toRgExclude(pattern: string): string {
  const body = pattern.startsWith("**/") ? pattern : `**/${pattern.replace(/^!/, "")}`;
  return body.startsWith("!") ? body : `!${body}`;
}

export function parseRgFiles(stdout: string): string[] {
  return stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

export function parseRgMatches(stdout: string, limit: number): RgMatch[] {
  const matches: RgMatch[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const found = /^(.*?):(\d+):(.*)$/.exec(raw);
    if (!found) continue;
    matches.push({ path: found[1], line: Number(found[2]), preview: found[3] });
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
  return ["-n", "-i", "--no-heading", "--glob", "!.git/**", ...globs, pattern];
}

export function fileRgArgs(excludeGlobs: string[]): string[] {
  return ["--files", "--hidden", "--glob", "!.git/**", "--iglob", "!.git/**", ...excludeGlobs.flatMap(glob => ["--glob", glob])];
}
