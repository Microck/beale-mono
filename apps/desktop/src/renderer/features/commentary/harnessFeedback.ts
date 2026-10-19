import type { TraceEventRecord } from '@shared/types';

export interface HarnessFeedbackEntry {
  id: string;
  kind: 'flaw' | 'quirk' | 'limitation';
  observation: string;
  workaround: string | null;
  createdAt: string;
}

export function harnessFeedbackFromTrace(events: readonly TraceEventRecord[]): HarnessFeedbackEntry[] {
  return events.flatMap((event) => {
    if (event.type !== 'tool_result') return [];
    const payload = record(event.payload.payload);
    if (event.payload.toolName !== 'harness.feedback' || payload?.status !== 'complete') return [];
    const result = record(payload.result);
    if (!result || (result.kind !== 'flaw' && result.kind !== 'quirk' && result.kind !== 'limitation')
      || typeof result.observation !== 'string' || !result.observation.trim()) return [];
    return [{
      id: event.id,
      kind: result.kind,
      observation: result.observation,
      workaround: typeof result.workaround === 'string' && result.workaround.trim() ? result.workaround : null,
      createdAt: event.createdAt
    }];
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
