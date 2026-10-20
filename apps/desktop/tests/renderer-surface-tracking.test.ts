import { describe, expect, it } from 'vitest';
import type { TraceEventRecord } from '@shared/types';
import { surfaceTrackingCharts, unassignedSurfaceAgents } from '../src/renderer/view-models/surfaceTracking';

const root = { id: 'asset-example', name: 'Example service' };
const parser = { id: 'surface-parser', name: 'Request parser' };
const dispatcher = { id: 'surface-dispatch', name: 'Dispatcher' };
const sink = { id: 'surface-sink', name: 'State sink' };

describe('session surface tracking', () => {
  it('splits occupied siblings into sectors and shades dots by agent depth', () => {
    const events = [
      focus(1, '/root', [root]),
      activity(2, '/root/analyst', 'spawned', [root, parser]),
      activity(3, '/root/discoverer', 'spawned', [root, dispatcher]),
      activity(4, '/root/analyst/helper', 'spawned', [root, parser, sink]),
      activity(5, '/root/second', 'spawned', [root, dispatcher])
    ];
    const [chart] = surfaceTrackingCharts(events, 'active');
    expect(chart?.rootName).toBe('Example service');
    expect(chart?.segments.filter((segment) => segment.depth === 1)).toHaveLength(2);
    expect(chart?.segments.find((segment) => segment.id === sink.id)?.depth).toBe(2);
    expect(chart?.agents.map((agent) => [agent.path, agent.shadePercent])).toEqual([
      ['/root', 100],
      ['/root/analyst', 67],
      ['/root/analyst/helper', 33],
      ['/root/discoverer', 67],
      ['/root/second', 67]
    ]);
    const siblings = chart!.agents.filter((agent) => agent.surfaceId === dispatcher.id);
    expect(siblings).toHaveLength(2);
    expect(siblings[0]?.radius).toBeGreaterThan(chart!.agents[0]!.radius);
    expect([siblings[0]?.x, siblings[0]?.y]).not.toEqual([siblings[1]?.x, siblings[1]?.y]);
    expect(chart?.segments.every((segment) => segment.path.startsWith('M '))).toBe(true);
  });

  it('keeps a moving agent identity, then removes completed agents from the live map', () => {
    const initial = [
      focus(1, '/root', [root, parser]),
      activity(2, '/root/discoverer', 'spawned', [root, parser])
    ];
    const before = surfaceTrackingCharts(initial, 'active')[0]!.agents.find((agent) => agent.path === '/root/discoverer')!;
    const moved = [...initial, focus(3, '/root/discoverer', [root, parser, sink])];
    const after = surfaceTrackingCharts(moved, 'active')[0]!.agents.find((agent) => agent.path === '/root/discoverer')!;
    expect(after.surfaceDepth).toBe(2);
    expect(after.path).toBe(before.path);
    expect(after.y).not.toBe(before.y);
    expect(surfaceTrackingCharts([...moved, activity(4, '/root/discoverer', 'completed', [root, parser, sink])], 'active')[0]?.agents)
      .toHaveLength(1);
    expect(surfaceTrackingCharts(moved, 'completed')).toEqual([]);
  });

  it('keeps separate occupied roots and floors deeper agent shades at sixteen percent', () => {
    const secondRoot = { id: 'asset-second', name: 'Second example service' };
    const charts = surfaceTrackingCharts([
      activity(1, '/root/analyst/helper/scout', 'spawned', [root]),
      activity(2, '/root/discoverer', 'spawned', [secondRoot])
    ], 'active');
    expect(charts).toHaveLength(2);
    expect(charts.find((chart) => chart.rootId === root.id)?.agents[0]?.shadePercent).toBe(16);
    expect(charts.find((chart) => chart.rootId === secondRoot.id)?.agents[0]?.surfaceDepth).toBe(0);
  });

  it('shows active agents with no recorded focus as unassigned', () => {
    const events = [activity(1, '/root/discoverer', 'spawned', [])];
    expect(surfaceTrackingCharts(events, 'active')).toEqual([]);
    expect(unassignedSurfaceAgents(events, 'active')).toEqual([
      { path: '/root', label: 'Main agent', shadePercent: 100 },
      { path: '/root/discoverer', label: 'discoverer', shadePercent: 67 }
    ]);
    expect(unassignedSurfaceAgents([...events, focus(2, '/root/discoverer', [root])], 'active'))
      .toEqual([{ path: '/root', label: 'Main agent', shadePercent: 100 }]);
  });
});

function focus(sequence: number, agentPath: string, surfaceTrail: unknown[]): TraceEventRecord {
  return event(sequence, {
    appServerKind: 'tool.observed', toolName: 'surface.focus', agentPath,
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
