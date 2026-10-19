import { describe, expect, it } from 'vitest';
import type { TraceEventRecord } from '@shared/types';
import { harnessFeedbackFromTrace } from '../src/renderer/features/commentary/harnessFeedback';

function feedbackEvent(id: string, status: string, result: unknown): TraceEventRecord {
  return {
    id, runId: 'session-example', attemptId: 'attempt-example', sequence: 1,
    type: 'tool_result', source: 'tool', summary: 'app-server tool observed',
    payload: { toolName: 'harness.feedback', payload: { status, result } },
    sensitivity: 'internal', modelVisible: true, createdAt: '2026-01-01T00:00:00.000Z',
    artifactId: null, toolCallId: id, approvalId: null
  };
}

describe('harness feedback trace projection', () => {
  it('includes only successful, valid feedback entries', () => {
    const events = [
      feedbackEvent('one', 'complete', { kind: 'quirk', observation: 'An example list reordered unexpectedly.', workaround: 'Refreshed the list.' }),
      feedbackEvent('two', 'error', { kind: 'flaw', observation: 'Rejected.' }),
      feedbackEvent('three', 'complete', { kind: 'limitation', observation: ' ' })
    ];
    expect(harnessFeedbackFromTrace(events)).toEqual([{
      id: 'one', kind: 'quirk', observation: 'An example list reordered unexpectedly.',
      workaround: 'Refreshed the list.', createdAt: '2026-01-01T00:00:00.000Z'
    }]);
  });
});
