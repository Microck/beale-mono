import { useEffect, useState, type JSX } from 'react';
import type { BealeWorkspaceResearchTrack } from '@beale/app-server-runtime/protocol';

export function WorkspaceResearchTrack({ workspaceId, serverId, enabled, showDetails = false }: {
  workspaceId: string;
  serverId?: string;
  enabled: boolean;
  showDetails?: boolean;
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
  const blocked = track?.surfaces.filter((surface) => surface.status === 'blocked').length ?? 0;
  const active = track?.surfaces.find((surface) => surface.surfaceId === track.activeSurfaceId);
  const scheduledRevisit = track?.surfaces.some((surface) => surface.revisitAfter && Date.parse(surface.revisitAfter) > Date.now());
  const action = !enabled ? null : !track || status === 'complete' || status === 'stopped' ? 'start'
    : status === 'paused' || status === 'waiting' ? 'resume' : null;
  const label = !track ? 'Start continuous research' : status === 'complete' ? 'Start another pass'
    : status === 'stopped' ? 'Start continuous research' : 'Resume research';
  return <section className="workspace-research-track" aria-label="Continuous research track">
    <div className="workspace-research-track-copy">
      <strong>Continuous research</strong>
      {loading ? <span role="status">Loading track…</span> : track ? <span role="status">
        {status === 'running' ? active ? `Researching ${active.name}` : scheduledRevisit ? 'Second look scheduled' : 'Selecting next surface' : status === 'waiting' ? 'Waiting on a blocker'
          : status === 'paused' ? 'Paused' : status === 'complete' ? 'Audit pass complete' : 'Stopped'}
        {' · '}{complete} of {total} surfaces complete{blocked ? ` · ${blocked} blocked` : ''}
      </span> : <span>{enabled ? 'Reasoning-based security research across the authorized scope.'
        : 'Enable workspace memory to start continuous research.'}</span>}
      {track?.lastError ? <span className="workspace-research-track-error">{track.lastError}</span> : null}
      {error ? <span className="workspace-research-track-error" role="alert">{error}</span> : null}
    </div>
    <div className="workspace-research-track-actions">
      {action ? <button className="primary-button" type="button" disabled={loading || busy}
        onClick={() => void control(action)}>{busy ? 'Working…' : label}</button> : null}
      {status === 'running' ? <span className="workspace-research-track-spinner" aria-label="Research running" /> : null}
      {status === 'running' ?
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void control('pause')}>Pause</button>
        : null}
      {track && status !== 'complete' && status !== 'stopped' ? <button className="secondary-button" type="button"
        disabled={busy} onClick={() => void control('stop')}>Stop</button> : null}
    </div>
    {showDetails && track ? <details className="workspace-research-track-detail">
      <summary>Surface progress · pass {track.pass} · {track.epochCount} epochs</summary>
      <div className="workspace-research-track-surface-list">
        {track.surfaces.filter((surface) => surface.status !== 'excluded').map((surface) => <div key={surface.surfaceId} className="workspace-research-track-surface">
          <strong>{surface.name}</strong><span>{surface.status.replaceAll('_', ' ')} · {surface.impact} impact · {surface.epochs} epochs</span>
          {surface.nextAction ? <small>{surface.nextAction}</small> : null}
        </div>)}
      </div>
    </details> : null}
  </section>;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
