import type { RunStatus, TraceEventRecord } from '@shared/types';

export interface SurfaceFocusSummary {
  name: string;
  additionalCount: number;
}

interface SurfaceTrailNode { id: string; name: string }
interface FocusState { trail: SurfaceTrailNode[]; active: boolean }

/** Summarize the surfaces occupied by active agents from compact trace events. */
export function surfaceFocusSummary(events: readonly TraceEventRecord[], runStatus: RunStatus | null): SurfaceFocusSummary | null {
  if (runStatus !== 'active') return null;
  const states = new Map<string, FocusState>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    const payload = event.payload;
    const nested = record(payload.payload);
    const agentPath = stringValue(payload.agentPath) ?? stringValue(nested?.agentPath);
    if (agentPath !== '/root' && !agentPath?.startsWith('/root/')) continue;
    const lifecycle = payload.type === 'subagent.activity' ? payload : nested?.type === 'subagent.activity' ? nested : null;
    if (lifecycle) {
      const action = stringValue(lifecycle.action);
      if (action === 'completed' || action === 'interrupted' || action === 'errored') {
        const current = states.get(agentPath);
        if (current) states.set(agentPath, { ...current, active: false });
        continue;
      }
      const trail = readTrail(lifecycle.surfaceTrail);
      states.set(agentPath, { trail: trail.length > 0 ? trail : states.get(agentPath)?.trail ?? [], active: true });
      continue;
    }
    if (payload.appServerKind !== 'tool.observed' || nested?.toolName !== 'surface.focus' || nested.status !== 'complete') continue;
    const trail = readTrail(record(nested.result)?.surfaceTrail);
    if (trail.length > 0) states.set(agentPath, { trail, active: true });
  }

  const occupied = [...states.entries()]
    .filter(([, state]) => state.active && state.trail.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  const primary = occupied.find(([path]) => path === '/root') ?? occupied[0];
  if (!primary) return null;
  const distinctIds = new Set(occupied.map(([, state]) => state.trail.at(-1)!.id));
  return { name: primary[1].trail.at(-1)!.name, additionalCount: distinctIds.size - 1 };
}

function readTrail(value: unknown): SurfaceTrailNode[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return [];
  const trail = value.map((item) => {
    const part = record(item);
    const id = stringValue(part?.id);
    const name = stringValue(part?.name);
    return id && name ? { id, name } : null;
  });
  return trail.every((item): item is SurfaceTrailNode => item !== null) ? trail : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
