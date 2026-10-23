import { describe, expect, it } from 'vitest';
import type { AppServerSessionSummary } from '../src/main/appServerCliClient';
import { canonicalSessionRegistryBatches, REGISTRY_RECONCILE_BATCH_BYTES } from '../src/main/canonicalSessionRegistry';

function canonicalSession(index: number): AppServerSessionSummary {
  const prompt = 'Inspect the authorized example surface. '.repeat(700);
  return {
    schemaVersion: 1,
    id: `session-example-${index}`,
    workspaceId: 'workspace-example',
    status: 'active',
    title: `Example session ${index}`,
    prompt,
    summary: 'Research in progress.',
    provider: 'openai-codex',
    model: 'example-model',
    reasoningEffort: 'high',
    workflowId: null,
    profile: null,
    metadata: {
      shellSafetyMode: 'auto_review',
      bealeRun: { mode: 'open_discovery', budget: { machineId: 'local' } },
      appServerRestartLaunch: { launch: { promptMarkdown: prompt } }
    },
    finalDisposition: null,
    attempts: [],
    lastMessageAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1
  };
}

describe('canonical session registry reconciliation', () => {
  it('keeps a large session catalog within the app-server request limit without losing sidebar fields', () => {
    const sessions = Array.from({ length: 24 }, (_, index) => canonicalSession(index));
    expect(Buffer.byteLength(JSON.stringify(sessions), 'utf8')).toBeGreaterThan(512 * 1024);

    const batches = canonicalSessionRegistryBatches(sessions);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat().map((session) => session.id)).toEqual(sessions.map((session) => session.id));
    for (const batch of batches) {
      expect(Buffer.byteLength(JSON.stringify(batch), 'utf8')).toBeLessThanOrEqual(REGISTRY_RECONCILE_BATCH_BYTES);
      expect(Buffer.byteLength(JSON.stringify({
        operation: 'registry.state',
        input: { registryDirectory: 'C:/example/registry', action: 'reconcileAppServerSessions',
          args: ['security-research', 'workspace-example', batch] }
      }), 'utf8')).toBeLessThan(512 * 1024);
      for (const session of batch) {
        expect(session.metadata).toEqual({
          shellSafetyMode: 'auto_review',
          bealeRun: { mode: 'open_discovery', budget: { machineId: 'local' } }
        });
        expect(session.prompt).toBe(sessions.find((candidate) => candidate.id === session.id)?.prompt);
      }
    }
  });
});
