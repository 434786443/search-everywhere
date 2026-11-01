export interface PublishDecision {
  requestId: number;
  latestRequestId: number;
  generation: number;
  currentGeneration: number;
}

export function shouldPublish(decision: PublishDecision): boolean {
  return decision.requestId === decision.latestRequestId
    && decision.generation === decision.currentGeneration;
}
