import { describe, expect, it } from 'vitest';
import { rendererRecoveryDecision } from '../src/main/rendererRecovery';

describe('renderer crash recovery', () => {
  it('reloads after an unexpected exit and stops after repeated exits', () => {
    const first = rendererRecoveryDecision([], 1_000);
    expect(first.reloadAfterMs).toBe(250);
    const second = rendererRecoveryDecision(first.recentExits, 2_000);
    expect(second.reloadAfterMs).toBe(500);
    const third = rendererRecoveryDecision(second.recentExits, 3_000);
    expect(third.reloadAfterMs).toBe(750);
    expect(rendererRecoveryDecision(third.recentExits, 4_000).reloadAfterMs).toBeNull();
    expect(rendererRecoveryDecision(third.recentExits, 64_000).reloadAfterMs).toBe(250);
  });
});
