import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppServerMemorySummary } from '@shared/types';
import { WorkspaceService } from '../src/main/workspaceService';
import { resolvedTestResearchProfile } from './researchProfileFixture';

interface MemoryLoadBoundary {
  workspacePath: string | null;
  workspaceMemorySummaryLoads: Map<string, object>;
  workspaceMemorySummaryErrors: Map<string, string>;
  snapshotCache: Map<string, unknown>;
  scheduleWorkspaceMemorySummaryLoad(runtime: unknown): void;
  memorySummaryForRuntimeAsync(runtime: unknown): Promise<AppServerMemorySummary>;
  cachedMemorySummaryForRuntime(runtime: unknown): AppServerMemorySummary | null;
  emitRuntimeChange(workspacePath: string, change: { forceSnapshot: true }): void;
}

const createdDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('workspace memory summary loading', () => {
  it('broadcasts a ready snapshot after a first workspace open', async () => {
    const root = mkdtempSync(join(tmpdir(), 'beale-summary-open-'));
    createdDirectories.push(root);
    const snapshots: boolean[] = [];
    let service!: WorkspaceService;
    service = new WorkspaceService((change) => {
      if (change.snapshotChanged) snapshots.push(service.getSnapshot()?.appServerMemory.loading === true);
    }, {
      workspaceRegistryDirectory: join(root, 'registry'),
      appServerDatabasePath: join(root, 'memory.sqlite'),
      appServerArtifactDirectory: join(root, 'artifacts'),
      researchProfileResolver: () => resolvedTestResearchProfile()
    });
    const boundary = service as unknown as MemoryLoadBoundary;
    const readyMemory = { loading: false } as AppServerMemorySummary;
    vi.spyOn(boundary, 'memorySummaryForRuntimeAsync').mockResolvedValue(readyMemory);
    vi.spyOn(boundary, 'cachedMemorySummaryForRuntime').mockReturnValue(readyMemory);

    try {
      const opened = service.createWorkspace(join(root, 'workspace'));
      expect(opened.appServerMemory.loading).toBe(true);
      await vi.waitFor(() => expect(snapshots).toContain(false), { timeout: 5_000 });
    } finally {
      service.close();
    }
  });

  it('clears the loading marker before publishing a completed summary', async () => {
    vi.useFakeTimers();
    const service = new WorkspaceService();
    const boundary = service as unknown as MemoryLoadBoundary;
    const workspacePath = '/workspace/example';
    const runtime = { workspacePath, db: {} };
    boundary.workspacePath = workspacePath;
    let finish!: (value: AppServerMemorySummary) => void;
    const pending = new Promise<AppServerMemorySummary>((resolve) => { finish = resolve; });
    vi.spyOn(boundary, 'memorySummaryForRuntimeAsync').mockReturnValue(pending);
    const published = vi.spyOn(boundary, 'emitRuntimeChange').mockImplementation(() => {
      expect(boundary.workspaceMemorySummaryLoads.has(workspacePath)).toBe(false);
      expect(boundary.snapshotCache.has(workspacePath)).toBe(false);
    });
    boundary.snapshotCache.set(workspacePath, {});

    boundary.scheduleWorkspaceMemorySummaryLoad(runtime);
    expect(boundary.workspaceMemorySummaryLoads.has(workspacePath)).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(published).not.toHaveBeenCalled();

    finish({ loading: false } as AppServerMemorySummary);
    await vi.waitFor(() => expect(published).toHaveBeenCalledWith(workspacePath, { forceSnapshot: true }));
    expect(boundary.workspaceMemorySummaryErrors.has(workspacePath)).toBe(false);
  });

  it('publishes an error state when the summary read fails', async () => {
    vi.useFakeTimers();
    const service = new WorkspaceService();
    const boundary = service as unknown as MemoryLoadBoundary;
    const workspacePath = '/workspace/example';
    const runtime = { workspacePath, db: {} };
    boundary.workspacePath = workspacePath;
    vi.spyOn(boundary, 'memorySummaryForRuntimeAsync').mockRejectedValue(new Error('Synthetic summary failure.'));
    const published = vi.spyOn(boundary, 'emitRuntimeChange').mockImplementation(() => {
      expect(boundary.workspaceMemorySummaryLoads.has(workspacePath)).toBe(false);
    });

    boundary.scheduleWorkspaceMemorySummaryLoad(runtime);
    await vi.advanceTimersByTimeAsync(250);

    expect(published).toHaveBeenCalledWith(workspacePath, { forceSnapshot: true });
    expect(boundary.workspaceMemorySummaryErrors.get(workspacePath)).toBe('Synthetic summary failure.');
  });
});
