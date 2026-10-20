import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TraceEventRecord } from '@shared/types';
import { SurfaceTracking } from '../src/renderer/features/research/SurfaceTracking';
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
    expect(chart?.size).toBeLessThan(180);
    expect(chart?.agents.every((agent) => agent.radius <= 5.5)).toBe(true);
    const html = renderToStaticMarkup(createElement(SurfaceTracking, { charts: [chart!], unassignedAgents: [] }));
    expect(html.indexOf('class="session-surface-current"')).toBeLessThan(html.indexOf('<svg'));
    expect(html).toMatch(/class="session-surface-current-path"[^>]*>Example service \\<\/div>/su);
    expect(html).toContain('var(--text) 72%, var(--panel-column)');
    expect(html).toContain('class="session-surface-current-name" title="Example service">');
    expect(html).toContain('>Example service</div>');
    expect(html).not.toContain('class="session-surface-current-name" title="Example service / Request parser"');
    expect(html.match(/class="session-surface-current-name"/g)).toHaveLength(1);
    expect(html).toContain(`width="${chart!.size}" height="${chart!.size}"`);
    expect(html).toContain('class="session-surface-root" r="7"');
    expect(html).toContain('stroke-width="5"');
    expect(html).not.toContain('<h3');
    expect(html).not.toContain('<figcaption');
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(styles).toMatch(/\.session-surface-current\s*\{[^}]*align-self: flex-start/su);
    expect(styles).toMatch(/\.session-surface-current-path\s*\{[^}]*color: var\(--muted\);[^}]*padding-top: 3px;[^}]*-webkit-line-clamp: 2/su);
    expect(styles).toMatch(/\.session-surface-current-name\s*\{[^}]*color: var\(--text\);[^}]*font-size: 1rem;[^}]*-webkit-line-clamp: 3/su);
    expect(styles).toMatch(/\.sidebar-surface-slot\s*\{[^}]*margin-right: -6px/su);
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

  it('opens the selected subagent from its dot while leaving the main agent dot passive', () => {
    const [chart] = surfaceTrackingCharts([
      focus(1, '/root', [root]),
      activity(2, '/root/analyst', 'spawned', [root, parser])
    ], 'active');
    const selected: string[] = [];
    const tree = SurfaceTracking({
      charts: [chart!],
      unassignedAgents: [{ path: '/root/scout', label: 'scout', shadePercent: 67 }],
      onSelectSubagent: (path) => selected.push(path)
    });
    const elements = childElements(tree);
    const agentDots = elements.filter((element) => element.props.className === 'session-surface-agent');
    expect(agentDots).toHaveLength(2);
    expect(agentDots.filter((element) => element.props.role === 'button')).toHaveLength(1);
    const subagentDot = agentDots.find((element) => element.props.role === 'button');
    expect(subagentDot?.props.tabIndex).toBe(0);
    subagentDot?.props.onClick?.();
    let prevented = false;
    subagentDot?.props.onKeyDown?.({ key: 'Enter', preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true);
    const unassignedDot = elements.find((element) => element.type === 'button'
      && element.props.className === 'session-surface-unassigned-dot');
    unassignedDot?.props.onClick?.();
    expect(selected).toEqual(['/root/analyst', '/root/analyst', '/root/scout']);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('class="session-surface-agent-hit"');
    expect(html).toContain('aria-label="Open analyst subagent"');
    expect(html).toContain('aria-label="Open scout subagent"');
  });

  it('shows the selected surface with its asset and parent breadcrumb', () => {
    const [chart] = surfaceTrackingCharts([focus(1, '/root', [root, parser, sink])], 'active');
    const html = renderToStaticMarkup(createElement(SurfaceTracking, { charts: [chart!], unassignedAgents: [] }));
    expect(chart?.segments.find((segment) => segment.id === sink.id)?.ancestorNames)
      .toEqual(['Example service', 'Request parser']);
    expect(html).toMatch(/class="session-surface-current-path" title="Request parser"[^>]*>Example service \\ Request parser \\<\/div>/su);
    expect(html).toContain('class="session-surface-current-name" title="Example service / Request parser / State sink"');
    expect(html).toContain('>State sink</div>');
    expect(html).toContain('<title>Example service / Request parser</title>');
  });

  it('uses the first focused subagent when the main agent has no surface', () => {
    const charts = surfaceTrackingCharts([
      activity(1, '/root/zeta', 'spawned', [root, dispatcher]),
      activity(2, '/root/alpha', 'spawned', [root, parser, sink])
    ], 'active');
    const html = renderToStaticMarkup(createElement(SurfaceTracking, { charts, unassignedAgents: [] }));
    expect(html).toMatch(/class="session-surface-current-path" title="Request parser"[^>]*>Example service \\ Request parser \\<\/div>/su);
    expect(html).toContain('class="session-surface-current-name" title="Example service / Request parser / State sink"');
    expect(html.match(/class="session-surface-current-name"/g)).toHaveLength(1);
  });

  it('selects the main agent across separate root charts', () => {
    const secondRoot = { id: 'asset-second', name: 'Second example service' };
    const charts = surfaceTrackingCharts([
      activity(1, '/root/alpha', 'spawned', [root, parser]),
      focus(2, '/root', [secondRoot, dispatcher])
    ], 'active');
    const html = renderToStaticMarkup(createElement(SurfaceTracking, { charts, unassignedAgents: [] }));
    expect(html).toContain('class="session-surface-current-name" title="Second example service / Dispatcher"');
    expect(html.match(/class="session-surface-current-name"/g)).toHaveLength(1);
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

  it('keeps crowded surface markers inside the tighter diagram bounds', () => {
    const events = [focus(1, '/root', [root]), ...Array.from({ length: 10 }, (_, index) =>
      activity(index + 2, `/root/scout_${index}`, 'spawned', [root]))];
    const [chart] = surfaceTrackingCharts(events, 'active');
    expect(chart?.agents).toHaveLength(11);
    expect(chart?.agents.every((agent) => Math.hypot(agent.x, agent.y) + agent.radius + 4 <= chart.size / 2)).toBe(true);
  });

  it('shows active agents with no recorded focus as unassigned', () => {
    const events = [activity(1, '/root/discoverer', 'spawned', [])];
    expect(surfaceTrackingCharts(events, 'active')).toEqual([]);
    expect(unassignedSurfaceAgents(events, 'active')).toEqual([
      { path: '/root/discoverer', label: 'discoverer', shadePercent: 67 }
    ]);
    expect(unassignedSurfaceAgents([...events, focus(2, '/root/discoverer', [root])], 'active'))
      .toEqual([]);
    const html = renderToStaticMarkup(createElement(SurfaceTracking, {
      charts: [], unassignedAgents: unassignedSurfaceAgents(events, 'active')
    }));
    expect(html).toContain('aria-label="Agents without a surface focus"');
    expect(html).not.toContain('>Unassigned<');
  });

  it('does not add a detached main-agent dot when only a subagent has mapped a surface', () => {
    const events = [activity(1, '/root/discoverer', 'spawned', [root, parser])];
    const charts = surfaceTrackingCharts(events, 'active');
    expect(charts).toHaveLength(1);
    expect(unassignedSurfaceAgents(events, 'active')).toEqual([]);
    const html = renderToStaticMarkup(createElement(SurfaceTracking, { charts, unassignedAgents: [] }));
    expect(html).not.toContain('session-surface-unassigned-dot');
  });

  it('does not restore the detached root marker from an empty root lifecycle event', () => {
    const events = [
      activity(1, '/root', 'message', []),
      activity(2, '/root/discoverer', 'spawned', [root, parser])
    ];
    expect(unassignedSurfaceAgents(events, 'active')).toEqual([]);
    expect(surfaceTrackingCharts(events, 'active')[0]?.agents.map((agent) => agent.path))
      .toEqual(['/root/discoverer']);
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

interface InteractiveElementProps {
  children?: ReactNode;
  className?: string;
  role?: string;
  tabIndex?: number;
  onClick?: () => void;
  onKeyDown?: (event: { key: string; preventDefault: () => void }) => void;
}

function childElements(node: ReactNode): ReactElement<InteractiveElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(childElements);
  if (!isValidElement<InteractiveElementProps>(node)) return [];
  return [node, ...childElements(node.props.children)];
}
