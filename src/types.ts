export interface SearchQuery {
  terms: string[];
  extensions: string[];
}

export type HitKind = "file" | "content" | "symbol" | "command";
export type SearchTab = "all" | "files" | "symbols" | "commands";

export interface HitSource {
  type: "workspace" | "jar";
  jarPath?: string;
  jarName?: string;
}

export interface SearchHit {
  id: string;
  kind: HitKind;
  title: string;
  detail: string;
  source: HitSource;
  uri?: string;
  line?: number;
  preview?: string;
  extension: string;
  treatAsJava?: boolean;
  textTruncated?: boolean;
  stableIndex: number;
  entry?: string;
}
