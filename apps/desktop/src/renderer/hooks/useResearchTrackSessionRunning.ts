import { useEffect, useState } from 'react';

const TRACK_STATUS_REFRESH_MS = 5_000;
const INACTIVE_TRACK_STATUS_REFRESH_MS = 30_000;

export function useResearchTrackSessionRunning(
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
  serverId?: string
): boolean {
  // A track keeps its durable track_ ID as the session ID across epochs.
  const key = workspaceId && sessionId?.startsWith('track_')
    ? `${serverId ?? 'local'}:${workspaceId}:${sessionId}`
    : null;
  const [state, setState] = useState<{ key: string; running: boolean } | null>(null);

  useEffect(() => {
    if (!key || !workspaceId || !sessionId) return undefined;
    let active = true;
    let timer: number | null = null;
    const refresh = async (): Promise<void> => {
      let nextRefreshMs = TRACK_STATUS_REFRESH_MS;
      try {
        const track = await window.beale.getResearchTrack(workspaceId, serverId);
        if (!active) return;
        const running = track?.id === sessionId && track.status === 'running';
        if (!running) nextRefreshMs = INACTIVE_TRACK_STATUS_REFRESH_MS;
        setState((current) => current?.key === key && current.running === running
          ? current : { key, running });
      } catch {
        // Keep the last confirmed track state through a transient status failure.
        // The next check still runs promptly, and session-detail polling retries independently.
      } finally {
        if (active) timer = window.setTimeout(() => void refresh(), nextRefreshMs);
      }
    };
    void refresh();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [key, workspaceId, sessionId, serverId]);

  return state?.key === key && state.running;
}
