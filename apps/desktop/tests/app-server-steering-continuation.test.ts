import { describe, expect, it } from 'vitest';
import { AppServerRunEngine, steeringContinuationConsumed } from '../src/main/appServerRunEngine';
import { WorkspaceService } from '../src/main/workspaceService';

interface PendingSteeringHarness {
  requestId: string;
  type: 'steer';
  rootTurnAtDispatch: number;
  timeout: null;
  requiresReportRevision?: boolean;
  reportRevisionCompleted?: boolean;
}

interface ActiveRunHarness {
  stopped: boolean;
  context: {
    run: {
      id: string;
      budget: { resourceContext: { kind: 'report'; resourceId: string } };
    };
    attempt: { id: string };
  };
  pendingControls: Map<string, PendingSteeringHarness>;
  queuedContinuations: Map<string, PendingSteeringHarness>;
}

interface EngineHarness {
  activeRuns: Map<string, ActiveRunHarness>;
  db: { appendTraceEvent: (event: unknown) => void };
  onChange: (options?: unknown) => void;
  recordControlAcknowledgement: (
    context: ActiveRunHarness['context'],
    event: { kind: 'agent.event'; payload: Record<string, unknown> }
  ) => void;
  clearConsumedSteeringContinuations: (active: ActiveRunHarness, completedRootTurn: number) => void;
  markReportRevisionCompleted: (
    active: ActiveRunHarness,
    event: { kind: string; payload: Record<string, unknown> }
  ) => void;
}

describe('app-server steering continuation fallback', () => {
  it('acknowledges an ended-session follow-up before its new transport is ready', async () => {
    let continuationRequested = false;
    const service = Object.create(WorkspaceService.prototype) as WorkspaceService;
    Object.assign(service, {
      workspacePath: 'example-workspace',
      snapshotCache: new Map([['example-workspace', { snapshot: { accepted: true } }]]),
      requireRuntimeForRunId: () => ({
        workspacePath: 'example-workspace',
        db: {
          getRun: () => ({ status: 'completed', budget: { runEngine: 'app-server' } }),
          getRunDetail: () => ({ attempts: [{ id: 'attempt-example' }] })
        },
        appServerEngine: {
          extendRunWhenInactive: () => {
            continuationRequested = true;
            return new Promise<boolean>(() => undefined);
          }
        }
      }),
      emitChange: () => { throw new Error('Follow-up acknowledgement rebuilt the workspace snapshot.'); },
      snapshotForRuntime: () => { throw new Error('Follow-up acknowledgement rebuilt the workspace snapshot.'); }
    });

    const accepted = await Promise.race([
      service.steerRunForClient({ type: 'steer', runId: 'session-example', instruction: 'Continue the analysis.' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Follow-up waited for transport.')), 100))
    ]);
    expect(continuationRequested).toBe(true);
    expect(accepted).toEqual({ accepted: true });
  });

  it('delivers a waiting follow-up to a queued continuation launched at process close', async () => {
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
    const activeRuns = new Map<string, object>([['run-example', { prior: true }]]);
    const steered: string[] = [];
    let directLaunches = 0;
    const engine = Object.create(AppServerRunEngine.prototype) as AppServerRunEngine;
    Object.assign(engine, {
      activeRuns,
      completions: new Map([['run-example', completion]]),
      disposed: false,
      db: {
        getRun: () => ({ status: 'blocked' }),
        getRunDetail: () => ({ attempts: [{ id: 'attempt-example' }] })
      },
      recordContinuationAccepted: () => undefined,
      stopAppServerSessionForRun: () => undefined,
      steer: (_runId: string, instruction: string) => {
        steered.push(instruction);
        return { requestId: 'control-example', deliveryStatus: 'pending' };
      },
      extendRun: () => { directLaunches += 1; throw new Error('Duplicate launch'); }
    });

    const pending = engine.extendRunWhenInactive('run-example', 'Check the next selector.');
    activeRuns.set('run-example', { queuedContinuation: true });
    resolveCompletion();

    await expect(pending).resolves.toBe(true);
    expect(steered).toEqual(['Check the next selector.']);
    expect(directLaunches).toBe(0);
  });

  it('steers an already-started continuation without waiting for it to finish', async () => {
    const steered: string[] = [];
    const engine = Object.create(AppServerRunEngine.prototype) as AppServerRunEngine;
    Object.assign(engine, {
      activeRuns: new Map([['run-example', {}]]),
      completions: new Map([['run-example', new Promise<void>(() => undefined)]]),
      disposed: false,
      db: {
        getRun: () => ({ status: 'active' }),
        getRunDetail: () => ({ attempts: [{ id: 'attempt-example' }] })
      },
      recordContinuationAccepted: () => undefined,
      steer: (_runId: string, instruction: string) => {
        steered.push(instruction);
        return { requestId: 'control-example', deliveryStatus: 'pending' };
      }
    });

    await expect(engine.extendRunWhenInactive('run-example', 'Continue the active attempt.')).resolves.toBe(true);
    expect(steered).toEqual(['Continue the active attempt.']);
  });

  it('releases a worker after a terminal disposition before waiting to continue', async () => {
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
    const priorActive = { continuationCleanupRequested: false };
    let releaseRequested = false;
    const engine = Object.create(AppServerRunEngine.prototype) as AppServerRunEngine;
    Object.assign(engine, {
      activeRuns: new Map([['run-example', priorActive]]),
      completions: new Map([['run-example', completion]]),
      disposed: false,
      db: {
        getRun: () => ({ status: 'blocked' }),
        getRunDetail: () => ({ attempts: [{ id: 'attempt-example' }] })
      },
      recordContinuationAccepted: () => undefined,
      stopAppServerSessionForRun: () => { releaseRequested = true; },
      extendRun: () => ({ transportReady: Promise.resolve(true) })
    });

    const pending = engine.extendRunWhenInactive('run-example', 'Continue from the disposition.');
    expect(priorActive.continuationCleanupRequested).toBe(true);
    expect(releaseRequested).toBe(true);
    (engine as unknown as { activeRuns: Map<string, object> }).activeRuns.delete('run-example');
    resolveCompletion();
    await expect(pending).resolves.toBe(true);
  });

  it('preserves a durable terminal disposition when follow-up cleanup stops its worker', () => {
    let lifecycleNotified = false;
    const engine = Object.create(AppServerRunEngine.prototype) as {
      finishClosedProcess: (context: object, code: number, signal: null, active: object) => void;
    };
    Object.assign(engine, {
      db: { getRun: () => ({ status: 'blocked' }) },
      notifySessionLifecycleChanged: () => { lifecycleNotified = true; },
      failRun: () => { throw new Error('Terminal disposition was overwritten.'); }
    });

    engine.finishClosedProcess(
      { run: { id: 'run-example' } }, 1, null,
      { continuationCleanupRequested: true, stopReason: null, lastProcessDiagnostic: null }
    );
    expect(lifecycleNotified).toBe(true);
  });

  it('requires a later completed root turn before treating accepted steering as consumed', () => {
    expect(steeringContinuationConsumed(3, 3)).toBe(false);
    expect(steeringContinuationConsumed(3, 4)).toBe(true);
  });

  it('accepts the first completed turn when steering arrived before any root turn was observed', () => {
    expect(steeringContinuationConsumed(undefined, 1)).toBe(true);
    expect(steeringContinuationConsumed(0, 1)).toBe(true);
  });

  it('does not consume report steering before the requested revision succeeds', () => {
    expect(steeringContinuationConsumed(3, 4, true, false)).toBe(false);
    expect(steeringContinuationConsumed(3, 4, true, true)).toBe(true);
  });

  it('retains acknowledged report steering until revision and response are both observed', () => {
    const requestId = 'control_report_change';
    const pending: PendingSteeringHarness = {
      requestId,
      type: 'steer',
      rootTurnAtDispatch: 1,
      timeout: null,
      requiresReportRevision: true
    };
    const active: ActiveRunHarness = {
      stopped: false,
      context: {
        run: {
          id: 'run_report',
          budget: { resourceContext: { kind: 'report', resourceId: 'report_1' } }
        },
        attempt: { id: 'attempt_initial' }
      },
      pendingControls: new Map([[requestId, pending]]),
      queuedContinuations: new Map()
    };
    const engine = Object.create(AppServerRunEngine.prototype) as EngineHarness;
    engine.activeRuns = new Map([[active.context.run.id, active]]);
    engine.db = { appendTraceEvent: () => undefined };
    engine.onChange = () => undefined;

    engine.recordControlAcknowledgement(active.context, {
      kind: 'agent.event',
      payload: {
        eventType: 'control.received',
        accepted: true,
        type: 'steer',
        requestId
      }
    });

    expect(active.pendingControls.has(requestId)).toBe(false);
    expect(active.queuedContinuations.has(requestId)).toBe(true);

    engine.clearConsumedSteeringContinuations(active, 2);

    expect(active.queuedContinuations.has(requestId)).toBe(true);

    engine.markReportRevisionCompleted(active, {
      kind: 'tool.observed',
      payload: {
        toolName: 'report.revise',
        status: 'complete',
        normalizedInputs: { id: 'report_1' }
      }
    });
    expect(pending.reportRevisionCompleted).toBe(true);

    engine.clearConsumedSteeringContinuations(active, 2);

    expect(active.queuedContinuations.has(requestId)).toBe(false);
  });
});
