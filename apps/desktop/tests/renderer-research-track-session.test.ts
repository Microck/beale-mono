import { describe, expect, it } from 'vitest';
import type { BealeWorkspaceResearchTrack } from '@beale/app-server-runtime/protocol';
import type { RunDetail } from '../src/shared/types';
import { pausesResearchTrackFromSessionAction, runningResearchTrackDetail, waitForResearchTrackSession } from '../src/renderer/view-models/researchTrackSession';

function track(activeSessionId: string | null): BealeWorkspaceResearchTrack {
  return {
    id: 'track_example', workspaceId: 'workspace_example', status: 'running',
    activeSessionId
  } as BealeWorkspaceResearchTrack;
}

describe('research track session handoff', () => {
  it('pauses the track only for a session Pause action', () => {
    expect(pausesResearchTrackFromSessionAction('pause', true)).toBe(true);
    expect(pausesResearchTrackFromSessionAction('stop', true)).toBe(false);
    expect(pausesResearchTrackFromSessionAction('pause', false)).toBe(false);
  });

  it('presents a terminal epoch as ongoing while the track is running', () => {
    const detail = { run: { id: 'track_example', status: 'blocked', endedAt: '2026-08-20T12:00:00.000Z' } } as RunDetail;
    const presented = runningResearchTrackDetail(detail, true);

    expect(presented?.run.status).toBe('active');
    expect(presented?.run.endedAt).toBeNull();
    expect(detail.run.status).toBe('blocked');
    expect(runningResearchTrackDetail(detail, false)).toBe(detail);
    expect(runningResearchTrackDetail({ ...detail, run: { ...detail.run, status: 'failed' } }, true)?.run.status)
      .toBe('failed');
  });

  it('waits for a started track to create and expose its session', async () => {
    let checks = 0;
    let resolutions = 0;
    const session = await waitForResearchTrackSession({
      trackId: 'track_example', initialSessionId: null,
      signal: new AbortController().signal,
      getTrack: async () => track(++checks < 2 ? null : 'session_example'),
      findSession: async (sessionId) => ++resolutions < 2 ? null : sessionId,
      wait: async () => undefined
    });

    expect(session).toBe('session_example');
    expect(checks).toBe(3);
  });

  it('opens the existing session on resume and stops if the track is replaced', async () => {
    const resumed = await waitForResearchTrackSession({
      trackId: 'track_example', initialSessionId: 'session_example',
      signal: new AbortController().signal,
      getTrack: async () => track(null),
      findSession: async (sessionId) => sessionId,
      wait: async () => undefined
    });
    const replaced = await waitForResearchTrackSession({
      trackId: 'track_example', initialSessionId: null,
      signal: new AbortController().signal,
      getTrack: async () => ({ ...track(null), id: 'track_replacement' }),
      findSession: async () => 'wrong session',
      wait: async () => undefined
    });

    expect(resumed).toBe('session_example');
    expect(replaced).toBeNull();
  });
});
