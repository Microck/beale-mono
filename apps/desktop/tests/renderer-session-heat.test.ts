import { describe, expect, it } from 'vitest';
import type { AppServerFindingSummary, AppServerMemorySummary, RunDetail } from '@shared/types';
import { sessionHeatForDetail } from '../src/renderer/view-models/sessionHeat';

describe('renderer session heat', () => {
  it('uses session findings when a canonical track has no local research profile snapshot', () => {
    const finding = (originSessionId: string, rating: AppServerFindingSummary['rating'],
      status: AppServerFindingSummary['status'] = 'observed'): AppServerFindingSummary => ({
      id: `finding_${rating}_${status}`,
      workspaceId: 'workspace_example',
      subjectId: 'subject_example',
      memoryNodeId: null,
      originSessionId,
      projection: 'finding',
      maturity: 'observed',
      rating,
      classification: 'security.vulnerability',
      title: 'Example parser finding',
      summary: 'An example parser finding.',
      impact: '',
      stepsToReproduce: '',
      securityTracking: null,
      status,
      operatorOverride: false,
      staleFromStatus: null,
      confidence: 0.8,
      sourceRevision: null,
      environmentFingerprint: null,
      reproductionRunbookId: null,
      reportId: null,
      disclosureReference: null,
      staleReason: null,
      duplicateOfClaimId: null,
      duplicateMarkedAt: null,
      duplicateClaims: [],
      evidence: [],
      transitions: [],
      authors: [],
      createdAt: '2026-08-20T12:00:00.000Z',
      updatedAt: '2026-08-20T12:00:00.000Z',
      revision: 1
    });
    const detail = {
      run: { id: 'session_track_example' },
      researchProfile: null,
      appServerMemory: {
        status: 'ready',
        findings: [
          finding('session_other', 'critical'),
          finding('session_track_example', 'high'),
          finding('session_track_example', 'critical', 'rejected')
        ]
      } as AppServerMemorySummary
    } as RunDetail;

    expect(sessionHeatForDetail(detail)).toBe('high');
    expect(sessionHeatForDetail({ ...detail, appServerMemory: undefined })).toBe('none');
  });
});
