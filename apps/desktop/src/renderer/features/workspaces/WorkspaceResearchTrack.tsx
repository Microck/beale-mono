import { useEffect, useState, type JSX } from 'react';
import type { BealeWorkspaceResearchTrack } from '@beale/app-server-runtime/protocol';

export function WorkspaceResearchTrack({ workspaceId, serverId, enabled }: {
  workspaceId: string;
  serverId?: string;
  enabled: boolean;
}): JSX.Element {
  const [track, setTrack] = useState<BealeWorkspaceResearchTrack | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!workspaceId) { setLoading(false); return undefined; }
    let active = true;
    const refresh = (): void => {
      void window.beale.getResearchTrack(workspaceId, serverId)
        .then((value) => { if (active) { setTrack(value); setLoading(false); setError(null); } })
        .catch((caught: unknown) => { if (active) { setLoading(false); setError(message(caught)); } });
    };
    setTrack(null);
    setLoading(true);
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [workspaceId, serverId, enabled]);
  const control = async (action: 'start' | 'pause' | 'resume' | 'stop'): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { setTrack(await window.beale.controlResearchTrack(workspaceId, action, serverId)); }
    catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  };
  const status = track?.status;
  const total = track?.surfaces.filter((surface) => surface.status !== 'excluded').length ?? 0;
  const complete = track?.surfaces.filter((surface) => surface.status === 'complete').length ?? 0;
  const active = track?.surfaces.find((surface) => surface.surfaceId === track.activeSurfaceId);
  const scheduledRevisit = track?.surfaces.some((surface) => surface.revisitAfter && Date.parse(surface.revisitAfter) > Date.now());
  const action = !enabled ? null : !track || status === 'complete' || status === 'stopped' ? 'start'
    : status === 'paused' || status === 'waiting' ? 'resume' : null;
  const label = !track ? 'Start continuous research' : status === 'complete' ? 'Start another pass'
    : status === 'stopped' ? 'Start continuous research' : 'Resume research';
  const progress = status === 'running' ? active ? `Researching ${active.name}`
    : scheduledRevisit ? 'Second look scheduled' : 'Selecting next surface' : null;
  const statusTitle = track ? `${progress ?? status ?? 'Research track'} · ${complete} of ${total} surfaces complete` : undefined;
  const visibleError = error ?? (status === 'stopped' ? null : track?.lastError);
  return <div className="workspace-research-track" role="group" aria-label="Continuous research track">
    {visibleError ? <span className="workspace-research-track-error" role="alert" title={visibleError}>{visibleError}</span> : null}
    {track ? <details className="workspace-research-track-detail">
      <summary>Progress</summary>
      <div className="workspace-research-track-surface-list">
        <strong>Pass {track.pass} · {complete} of {total} surfaces complete</strong>
        {track.surfaces.filter((surface) => surface.status !== 'excluded').map((surface) => <div key={surface.surfaceId} className="workspace-research-track-surface">
          <strong>{surface.name}</strong><span>{surface.status.replaceAll('_', ' ')} · {surface.impact} impact · {surface.epochs} epochs</span>
          {surface.nextAction ? <small>{surface.nextAction}</small> : null}
        </div>)}
      </div>
    </details> : null}
    {action ? <button className="primary-button" type="button" disabled={loading || busy}
      onClick={() => void control(action)} title={statusTitle}>{busy ? 'Working…' : label}</button> : null}
    {status === 'running' ? <span className="workspace-research-track-status" role="status" title={statusTitle}>
      <span className="workspace-research-track-spinner" aria-hidden="true" />
      {active ? `Researching · ${complete}/${total}` : scheduledRevisit ? 'Second look scheduled' : 'Selecting surface'}
    </span> : null}
    {status === 'running' ? <button className="secondary-button" type="button" disabled={busy}
      onClick={() => void control('pause')}>Pause</button> : null}
    {track && status !== 'complete' && status !== 'stopped' ? <button className="secondary-button" type="button"
      disabled={busy} onClick={() => void control('stop')}>Stop</button> : null}
  </div>;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
