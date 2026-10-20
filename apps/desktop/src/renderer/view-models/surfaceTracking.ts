import type { RunStatus, TraceEventRecord } from '@shared/types';

export interface SurfaceTrailNode { id: string; name: string }

export interface SurfaceTrackingAgent {
  path: string;
  label: string;
  surfaceId: string;
  surfaceDepth: number;
  shadePercent: number;
  x: number;
  y: number;
  radius: number;
  countOnSurface: number;
}

export interface SurfaceTrackingSegment {
  id: string;
  name: string;
  label: string;
  ancestorNames: string[];
  depth: number;
  startAngle: number;
  endAngle: number;
  radius: number;
  path: string;
}

export interface SurfaceTrackingChart {
  rootId: string;
  rootName: string;
  size: number;
  segments: SurfaceTrackingSegment[];
  agents: SurfaceTrackingAgent[];
}

export interface UnassignedSurfaceAgent { path: string; label: string; shadePercent: number }
export interface SurfaceTrackingView { charts: SurfaceTrackingChart[]; unassignedAgents: UnassignedSurfaceAgent[] }

interface FocusState { path: string; trail: SurfaceTrailNode[]; active: boolean }
interface TreeNode extends SurfaceTrailNode { children: Map<string, TreeNode> }

const RING_STEP = 18;
const RING_START = 25;

/** Read-only location from compact trace scaffolds; no tool output body is required. */
export function surfaceTrackingCharts(events: readonly TraceEventRecord[], runStatus: RunStatus | null): SurfaceTrackingChart[] {
  return surfaceTrackingView(events, runStatus).charts;
}

export function surfaceTrackingView(events: readonly TraceEventRecord[], runStatus: RunStatus | null): SurfaceTrackingView {
  const states = focusStates(events, runStatus);
  const byRoot = new Map<string, FocusState[]>();
  for (const state of states.values()) {
    if (!state.active || state.trail.length === 0) continue;
    const rootId = state.trail[0]!.id;
    byRoot.set(rootId, [...(byRoot.get(rootId) ?? []), state]);
  }
  const charts = [...byRoot.entries()].map(([rootId, focused]) => layoutChart(rootId, focused))
    .sort((left, right) => left.rootName.localeCompare(right.rootName) || left.rootId.localeCompare(right.rootId));
  const unassignedAgents = [...states.values()]
    .filter((state) => state.active && state.trail.length === 0 && state.path !== '/root')
    .map((state) => ({ path: state.path, label: agentLabel(state.path), shadePercent: agentShade(state.path) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return { charts, unassignedAgents };
}

export function unassignedSurfaceAgents(events: readonly TraceEventRecord[], runStatus: RunStatus | null): UnassignedSurfaceAgent[] {
  return surfaceTrackingView(events, runStatus).unassignedAgents;
}

function focusStates(events: readonly TraceEventRecord[], runStatus: RunStatus | null): Map<string, FocusState> {
  const states = new Map<string, FocusState>();
  if (runStatus !== 'active') return states;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    const payload = event.payload;
    const nested = record(payload.payload);
    const agentPath = text(payload.agentPath) ?? text(nested?.agentPath);
    if (!agentPath?.startsWith('/root')) continue;
    const lifecycle = payload.type === 'subagent.activity' ? payload : nested?.type === 'subagent.activity' ? nested : null;
    if (lifecycle) {
      const action = text(lifecycle.action);
      if (action === 'completed' || action === 'interrupted' || action === 'errored') {
        const current = states.get(agentPath);
        if (current) states.set(agentPath, { ...current, active: false });
        continue;
      }
      const trail = readTrail(lifecycle.surfaceTrail);
      states.set(agentPath, { path: agentPath, trail: trail.length > 0 ? trail : states.get(agentPath)?.trail ?? [], active: true });
      continue;
    }
    const tool = nested;
    if (payload.appServerKind !== 'tool.observed' || tool?.toolName !== 'surface.focus' || tool.status !== 'complete') continue;
    const trail = readTrail(record(tool.result)?.surfaceTrail);
    if (trail.length > 0) states.set(agentPath, { path: agentPath, trail, active: true });
  }

  return states;
}

function layoutChart(rootId: string, focused: FocusState[]): SurfaceTrackingChart {
  const root: TreeNode = { ...focused[0]!.trail[0]!, children: new Map() };
  for (const agent of focused) {
    let parent = root;
    for (const part of agent.trail.slice(1)) {
      let child = parent.children.get(part.id);
      if (!child) {
        child = { ...part, children: new Map() };
        parent.children.set(part.id, child);
      }
      parent = child;
    }
  }
  const segments: SurfaceTrackingSegment[] = [];
  const angles = new Map<string, { depth: number; middle: number }>([[rootId, { depth: 0, middle: -90 }]]);
  const visit = (parent: TreeNode, depth: number, start: number, end: number, ancestorNames: string[]): void => {
    const children = [...parent.children.values()].sort((left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    const slice = (end - start) / Math.max(1, children.length);
    children.forEach((child, index) => {
      const gap = Math.min(3, slice * 0.08);
      const childStart = start + index * slice + gap / 2;
      const childEnd = start + (index + 1) * slice - gap / 2;
      const radius = RING_START + (depth - 1) * RING_STEP;
      angles.set(child.id, { depth, middle: (childStart + childEnd) / 2 });
      const label = [...ancestorNames, child.name].join(' / ');
      segments.push({ id: child.id, name: child.name, label, ancestorNames, depth, startAngle: childStart,
        endAngle: childEnd, radius, path: arcPath(radius, childStart, childEnd) });
      visit(child, depth + 1, childStart, childEnd, [...ancestorNames, child.name]);
    });
  };
  visit(root, 1, -90, 270, [root.name]);

  const occupants = new Map<string, FocusState[]>();
  for (const agent of focused) {
    const id = agent.trail.at(-1)!.id;
    occupants.set(id, [...(occupants.get(id) ?? []), agent]);
  }
  const agents = [...occupants.entries()].flatMap(([surfaceId, group]) => {
    const location = angles.get(surfaceId)!;
    const radius = location.depth === 0 ? 0 : RING_START + (location.depth - 1) * RING_STEP;
    const angle = degreesToRadians(location.middle);
    const tangent = { x: -Math.sin(angle), y: Math.cos(angle) };
    return group.sort((left, right) => left.path.localeCompare(right.path)).map((agent, index) => {
      const offset = (index - (group.length - 1) / 2) * Math.min(8, 5 + group.length);
      return { path: agent.path, label: agentLabel(agent.path),
        surfaceId, surfaceDepth: location.depth, shadePercent: agentShade(agent.path),
        x: Math.cos(angle) * radius + tangent.x * offset,
        y: Math.sin(angle) * radius + tangent.y * offset,
        radius: Math.min(5.5, 3.5 + (group.length - 1) * 0.6), countOnSurface: group.length };
    });
  });
  agents.sort((left, right) => left.path.localeCompare(right.path));
  const maxDepth = Math.max(0, ...segments.map((segment) => segment.depth));
  const ringRadius = maxDepth === 0 ? 0 : RING_START + (maxDepth - 1) * RING_STEP;
  const occupiedRadius = Math.max(0, ...agents.map((agent) => Math.hypot(agent.x, agent.y) + agent.radius));
  const outerRadius = Math.ceil(Math.max(21, ringRadius + 10, occupiedRadius + 4));
  return { rootId, rootName: root.name, size: outerRadius * 2, segments, agents };
}

function arcPath(radius: number, start: number, end: number): string {
  const point = (angle: number): string => {
    const radians = degreesToRadians(angle);
    return `${(Math.cos(radians) * radius).toFixed(3)} ${(Math.sin(radians) * radius).toFixed(3)}`;
  };
  const span = end - start;
  if (span >= 359.99) return `M ${point(start)} A ${radius} ${radius} 0 1 1 ${point(start + 180)} A ${radius} ${radius} 0 1 1 ${point(end)}`;
  return `M ${point(start)} A ${radius} ${radius} 0 ${span > 180 ? 1 : 0} 1 ${point(end)}`;
}

function readTrail(value: unknown): SurfaceTrailNode[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return [];
  const trail = value.map((item) => {
    const part = record(item);
    const id = text(part?.id);
    const name = text(part?.name);
    return id && name ? { id, name } : null;
  });
  return trail.every((item): item is SurfaceTrailNode => item !== null) ? trail : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null; }
function degreesToRadians(value: number): number { return value * Math.PI / 180; }
function agentDepth(path: string): number { return Math.max(0, path.split('/').filter(Boolean).length - 1); }
function agentLabel(path: string): string { return agentDepth(path) === 0 ? 'Main agent' : path.split('/').at(-1)!.replaceAll('_', ' '); }
function agentShade(path: string): number { return [100, 67, 33][agentDepth(path)] ?? 16; }
