import { SearchQuery } from "../types";

const EXTENSION_TOKEN = /^(\*\.[A-Za-z0-9]+|\.[A-Za-z0-9]+)(,(\*\.[A-Za-z0-9]+|\.[A-Za-z0-9]+))*$/;

export function parseQuery(input: string): SearchQuery {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const terms: string[] = [];
  const extensions: string[] = [];
  for (const token of tokens) {
    if (!EXTENSION_TOKEN.test(token)) {
      terms.push(token);
      continue;
    }
    for (const part of token.split(",")) {
      const extension = (part.startsWith("*.") ? part.slice(1) : part).toLowerCase();
      if (!extensions.includes(extension)) extensions.push(extension);
    }
  }
  return { terms, extensions };
}
