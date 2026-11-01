import { SearchQuery } from "../types";
import { parseQuery } from "./parseQuery";

export interface FileQueryInput extends SearchQuery {
  /** Text handed to the file matcher, with the extension tokens and any `:line` suffix removed. */
  text: string;
  /** 0-based line parsed from a `:line` or `:line:column` suffix. */
  line?: number;
}

/**
 * Splits a raw input into a file-search query.
 *
 * `User .java` keeps `User` as the matcher text and `.java` as a suffix filter.
 * `Button.tsx:12` searches `Button.tsx` and opens line 12. `C:\src\A.java` is
 * left alone: a single letter before `:` is a drive, not a line number.
 */
export function parseFileQuery(input: string, roots: string[] = []): FileQueryInput {
  const located = stripPosition(input, roots);
  const { terms, extensions } = parseQuery(located.text);
  return {
    text: terms.join(" "),
    terms,
    extensions,
    ...(located.line === undefined ? {} : { line: located.line }),
  };
}

function stripPosition(input: string, roots: string[]): { text: string; line?: number } {
  let text = input.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  if (/^file:\/\//i.test(text)) text = decodeSafe(text.replace(/^file:\/\//i, ""));
  for (const root of roots) {
    const normalized = root.replace(/\\/g, "/").replace(/\/+$/, "");
    const candidate = text.replace(/\\/g, "/");
    if (candidate === normalized) return { text: "" };
    if (candidate.startsWith(`${normalized}/`)) {
      text = candidate.slice(normalized.length + 1);
      break;
    }
  }
  const match = /^(.+?):(\d+)(?::(\d+))?$/.exec(text);
  if (!match) return { text };
  // A single letter before the colon is a Windows drive, not a line number.
  if (match[1].length === 1 && /[A-Za-z]/.test(match[1])) return { text };
  const line = Number(match[2]);
  return line > 0 ? { text: match[1], line } : { text };
}

function decodeSafe(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}
