import { rankHits } from "../rank/rankHits";
import { SearchHit, SearchQuery } from "../types";

export interface CommandInput { id: string; title?: string; }

export function matchCommands(commands: CommandInput[], query: SearchQuery): SearchHit[] {
  if (query.terms.length === 0) return [];
  const hits: SearchHit[] = commands.map((command, stableIndex) => ({
    id: `command:${command.id}`,
    kind: "command",
    title: command.title && command.title.length > 0 ? command.title : command.id,
    detail: command.id,
    source: { type: "workspace" },
    extension: "",
    stableIndex,
  }));
  return rankHits(hits, query);
}
