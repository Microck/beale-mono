const RECOVERY_WINDOW_MS = 60_000;
const MAX_RECOVERIES = 3;

export interface RendererRecoveryDecision {
  recentExits: number[];
  reloadAfterMs: number | null;
}

export function rendererRecoveryDecision(recentExits: readonly number[], nowMs: number): RendererRecoveryDecision {
  const withinWindow = recentExits.filter((exitAt) => nowMs - exitAt < RECOVERY_WINDOW_MS);
  const nextExits = [...withinWindow, nowMs];
  return {
    recentExits: nextExits,
    reloadAfterMs: nextExits.length <= MAX_RECOVERIES ? 250 * nextExits.length : null
  };
}
