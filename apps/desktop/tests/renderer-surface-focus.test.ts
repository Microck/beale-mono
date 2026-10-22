import { describe, expect, it } from 'vitest';
import type { TraceEventRecord } from '@shared/types';
import { surfaceFocusSummary } from '../src/renderer/view-models/surfaceFocus';

const asset = { id: 'asset-example', name: 'Example service' };
const parser = { id: 'surface-parser', name: 'Request parser' };
const sink = { id: 'surface-sink', name: 'State sink' };

describe('session surface focus', () => {
  it('uses the main agent surface and counts other distinct occupied surfaces', () => {
    const events = [
      focus(1, '/root', [asset, parser]),
      activity(2, '/root/analyst', 'spawned', [asset, parser]),
      activity(3, '/root/scout', 'spawned', [asset, parser, sink]),
      activity(4, '/root/helper', 'spawned', [asset, parser, sink])
    ];
    expect(surfaceFocusSummary(events, 'active')).toEqual({ name: 'Request parser', additionalCount: 1 });
    expect(surfaceFocusSummary([...events, activity(5, '/root/scout', 'completed', [])], 'active'))
      .toEqual({ name: 'Request parser', additionalCount: 1 });
    expect(surfaceFocusSummary([...events, activity(5, '/root/scout', 'completed', []),
      activity(6, '/root/helper', 'completed', [])], 'active'))
      .toEqual({ name: 'Request parser', additionalCount: 0 });
    expect(surfaceFocusSummary(events, 'completed')).toBeNull();
  });

  it('uses the first focused subagent when the main agent has no surface', () => {
    expect(surfaceFocusSummary([
      activity(1, '/root', 'message', []),
      activity(2, '/root/zeta', 'spawned', [asset, sink]),
      activity(3, '/root/alpha', 'spawned', [asset, parser])
    ], 'active')).toEqual({ name: 'Request parser', additionalCount: 1 });
  });

  it('follows focus changes and ignores agents without valid surface trails', () => {
    const events = [
      focus(1, '/root', [asset]),
      activity(2, '/root/scout', 'spawned', []),
      focus(3, '/root/scout', [asset, parser]),
      focus(4, '/root', [asset, parser, sink])
    ];
    expect(surfaceFocusSummary(events, 'active')).toEqual({ name: 'State sink', additionalCount: 1 });
    expect(surfaceFocusSummary([activity(1, '/root/scout', 'spawned', [{ id: 'missing-name' }])], 'active')).toBeNull();
    expect(surfaceFocusSummary([], 'active')).toBeNull();
  });
});

function focus(sequence: number, agentPath: string, surfaceTrail: unknown[]): TraceEventRecord {
  return event(sequence, {
    appServerKind: 'tool.observed', agentPath,
    payload: { toolName: 'surface.focus', status: 'complete', result: { surfaceTrail } }
  });
}

function activity(sequence: number, agentPath: string, action: string, surfaceTrail: unknown[]): TraceEventRecord {
  return event(sequence, { type: 'subagent.activity', action, agentPath, surfaceTrail });
}

function event(sequence: number, payload: Record<string, unknown>): TraceEventRecord {
  return { id: `event-${sequence}`, runId: 'run-example', attemptId: 'attempt-example', sequence,
    type: 'research_event', source: 'executor', summary: 'Synthetic surface event.', payload,
    sensitivity: 'internal', modelVisible: true, createdAt: `2026-01-01T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    artifactId: null, toolCallId: null, approvalId: null };
}
