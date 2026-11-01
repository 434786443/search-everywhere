import { classEntryToSourceEntry, findDeclarationLine } from "../jar/sourcePath";
import { SearchHit } from "../types";

export type OpenPlan =
  | { type: "workspace"; uri: string; line?: number }
  | { type: "jar-text"; jarPath: string; entry: string; line?: number }
  | { type: "declaration"; jarPath: string; entry: string }
  | { type: "command"; commandId: string };

export function decideOpen(input: { hit: SearchHit; sourcesJarPath?: string; sourceText?: string }): OpenPlan {
  const hit = input.hit;
  if (hit.kind === "command") return { type: "command", commandId: hit.detail };
  if (hit.source.type === "workspace") return { type: "workspace", uri: hit.uri ?? "", line: hit.line };
  if (hit.kind === "content" && hit.entry) return { type: "jar-text", jarPath: input.sourcesJarPath ?? hit.source.jarPath ?? "", entry: hit.entry, line: hit.line };
  if (input.sourceText && input.sourcesJarPath && hit.entry) {
    const line = findDeclarationLine(input.sourceText, hit.title.replace(/^@/, ""));
    return { type: "jar-text", jarPath: input.sourcesJarPath, entry: classEntryToSourceEntry(hit.entry), ...(line === undefined ? {} : { line }) };
  }
  return { type: "declaration", jarPath: hit.source.jarPath ?? "", entry: hit.entry ?? "" };
}
