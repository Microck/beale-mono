import type { BealeWorkspaceResearchTrack } from '@beale/app-server-runtime/protocol';
import type { RunDetail } from '@shared/types';

export function pausesResearchTrackFromSessionAction(action: string, trackRunning: boolean): boolean {
  return trackRunning && action === 'pause';
}

export function runningResearchTrackDetail(detail: RunDetail | null, running: boolean): RunDetail | null {
  if (!detail || !running || detail.run.status === 'active' || detail.run.status === 'failed') return detail;
  return { ...detail, run: { ...detail.run, status: 'active', endedAt: null } };
}

export async function waitForResearchTrackSession<T>(input: {
  trackId: string;
  initialSessionId: string | null;
  signal: AbortSignal;
  getTrack: () => Promise<BealeWorkspaceResearchTrack | null>;
  findSession: (sessionId: string) => Promise<T | null>;
  wait?: (signal: AbortSignal) => Promise<void>;
}): Promise<T | null> {
  let sessionId = input.initialSessionId;
  let consecutiveFailures = 0;
  let inactiveChecks = 0;
  while (!input.signal.aborted) {
    try {
      const track = await input.getTrack();
      if (input.signal.aborted || !track || track.id !== input.trackId) return null;
      sessionId = track.activeSessionId ?? sessionId;
      if (sessionId) {
        const session = await input.findSession(sessionId);
        if (input.signal.aborted) return null;
        if (session) return session;
      }
      if (track.status !== 'running') {
        if (!sessionId || ++inactiveChecks >= 5) return null;
      } else {
        inactiveChecks = 0;
      }
      consecutiveFailures = 0;
    } catch (error) {
      if (++consecutiveFailures >= 3) throw error;
    }
    await (input.wait ?? waitForNextCheck)(input.signal);
  }
  return null;
}

function waitForNextCheck(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, 1_500);
    signal.addEventListener('abort', finish, { once: true });
  });
}
