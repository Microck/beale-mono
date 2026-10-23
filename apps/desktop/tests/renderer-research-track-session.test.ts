import { describe, expect, it } from 'vitest';
import type { BealeWorkspaceResearchTrack } from '@beale/app-server-runtime/protocol';
import { waitForResearchTrackSession } from '../src/renderer/view-models/researchTrackSession';

function track(activeSessionId: string | null): BealeWorkspaceResearchTrack {
  return {
    id: 'track_example', workspaceId: 'workspace_example', status: 'running',
    activeSessionId
  } as BealeWorkspaceResearchTrack;
}

describe('research track session handoff', () => {
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
