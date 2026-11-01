export interface PublishDecision {
  generation: number;
  currentGeneration: number;
  includeContent: boolean;
  contentPosted: boolean;
}

export function shouldPublish(decision: PublishDecision): boolean {
  return decision.generation === decision.currentGeneration
    && (decision.includeContent || !decision.contentPosted);
}
