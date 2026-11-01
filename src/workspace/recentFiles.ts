import { RECENT_LIMIT } from "../limits";

/** Newest first, no duplicates, capped at RECENT_LIMIT. */
export function pushRecent(list: string[], key: string): string[] {
  if (!key) return list;
  return [key, ...list.filter((item) => item !== key)].slice(0, RECENT_LIMIT);
}

/** Drops keys whose file left the index, so a deleted path never resurfaces. */
export function pruneRecents(list: string[], live: Set<string>): string[] {
  return list.filter((key) => live.has(key));
}
