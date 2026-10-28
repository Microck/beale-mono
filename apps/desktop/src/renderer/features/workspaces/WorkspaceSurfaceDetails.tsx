import { useId, useState, type JSX } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { BealeWorkspaceSurfaceMap } from '@beale/app-server-runtime/protocol';
import type { MapSurface } from '../../view-models/surfaceMap';

const DETAIL_VIEWS = ['Breakdown', 'History', 'Hierarchy'] as const;
type DetailView = typeof DETAIL_VIEWS[number];

function surfaceTrail(surface: MapSurface, surfaces: readonly MapSurface[]): MapSurface[] {
  const byId = new Map(surfaces.map((item) => [item.id, item]));
  const trail: MapSurface[] = [];
  const seen = new Set<string>();
  let current: MapSurface | undefined = surface;
  while (current && !seen.has(current.id)) {
    trail.unshift(current);
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return trail;
}

function DetailText({ label, value }: { label: string; value: string | undefined }): JSX.Element | null {
  return value?.trim() ? <div className="workspace-surface-detail-text"><h4>{label}</h4><p>{value}</p></div> : null;
}

function SurfaceListSection({ title, values, emptyMessage }: {
  title: string;
  values: readonly string[];
  emptyMessage: string;
}): JSX.Element {
  return <section className="workspace-surface-details-section workspace-surface-details-list">
    <h3>{title}</h3>
    {values.length ? <ul>{values.map((value, index) => <li key={`${value}:${index}`}>{value}</li>)}</ul>
      : <p className="workspace-surface-details-muted">{emptyMessage}</p>}
  </section>;
}

export function SurfaceHistory({ surface }: { surface: MapSurface }): JSX.Element {
  const events = [...(surface.history ?? [
    ...(surface.updatedAt ? [{ kind: 'snapshot_update' as const, at: surface.updatedAt, actorId: null }] : []),
    ...(surface.firstTouchedAt ? [{ kind: 'first_touch' as const, at: surface.firstTouchedAt, actorId: surface.firstTouchedBy ?? null }] : [])
  ])].sort((left, right) => right.at.localeCompare(left.at));
  const labels = {
    created: 'Surface created', first_touch: `First touched by ${surface.firstTouchedModel?.trim() || 'Unknown'}`,
    focused: 'Focus moved here', updated: 'Surface updated', blocked: 'Progress blocked',
    unblocked: 'Blocker cleared', snapshot_update: 'Last saved update'
  } as const;
  return <section className="workspace-surface-history" aria-label="Surface history">
    {events.length ? <ol>{events.map((event, index) => <li key={`${event.kind}:${event.at}:${index}`}>
      <div className="workspace-surface-history-entry">
        <strong>{labels[event.kind]}</strong>
        {event.kind !== 'first_touch' && event.actorId ? <span> · {event.actorId === 'root' ? 'Lead' : event.actorId === 'host' ? 'Beale' : event.actorId}</span> : null}
        {event.detail ? <p>{event.detail}</p> : null}
      </div>
      <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>
    </li>)}</ol> : <p className="workspace-surface-details-muted">No surface history recorded.</p>}
  </section>;
}

export function WorkspaceSurfaceDetails({ surface, map, onClose }: {
  surface: MapSurface;
  map: BealeWorkspaceSurfaceMap;
  onClose: () => void;
}): JSX.Element {
  const coverage = surface.foundation?.coverage;
  const trail = surfaceTrail(surface, map.surfaces);
  const children = map.surfaces.filter((item) => item.parentId === surface.id);
  const agents = map.agents.filter((agent) => agent.surfaceId === surface.id);
  const status = surface.progressBlocker ? 'Blocked' : surface.coverageState.covered ? 'Covered'
    : surface.firstTouchedAt ? 'In progress' : 'Untouched';
  const firstTouchedModel = surface.firstTouchedModel?.trim() || 'Unknown';
  const tabId = useId();
  const [selection, setSelection] = useState<{ surfaceId: string; view: DetailView }>({ surfaceId: surface.id, view: 'Breakdown' });
  const activeView = selection.surfaceId === surface.id ? selection.view : 'Breakdown';

  return <aside className="workspace-surface-details main-session-side" aria-label="Surface details">
    <header className="workspace-surface-details-header research-side-nested-header is-campaign-item">
      <button className="is-icon-only" type="button" onClick={onClose} aria-label="Back to Surfaces" title="Back to Surfaces">
        <ArrowLeft aria-hidden="true" size={17} />
      </button>
      <span className="research-side-nested-identity">
        <span className="research-side-nested-primary">
          <span className="research-side-nested-name" title={surface.name}>{surface.name}</span>
          <span className={`workspace-surface-details-status${surface.progressBlocker ? ' blocked' : surface.coverageState.covered ? ' covered' : ''}`}
            aria-label={`Surface status: ${status}`}>{status}</span>
        </span>
      </span>
    </header>
    <div className="workspace-surface-details-meta">
      <span title={surface.firstTouchedAt ? `First touched ${new Date(surface.firstTouchedAt).toLocaleString()}` : undefined}>
        {surface.firstTouchedAt ? <>First touched by <span>{firstTouchedModel}</span></> : 'No first touch recorded'}
      </span>
      <span>{surface.updatedAt
        ? <>Updated <time dateTime={surface.updatedAt}>{new Date(surface.updatedAt).toLocaleString()}</time></>
        : 'Last update unknown'}</span>
    </div>
    <div className="workspace-surface-details-tabs" role="tablist" aria-label="Surface detail views">
      {DETAIL_VIEWS.map((view, index) => <button key={view} id={`${tabId}-${view}`} type="button" role="tab"
        aria-selected={activeView === view} aria-controls={`${tabId}-panel`} tabIndex={activeView === view ? 0 : -1}
        onClick={() => setSelection({ surfaceId: surface.id, view })}
        onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? (index + 1) % DETAIL_VIEWS.length
            : event.key === 'ArrowLeft' ? (index - 1 + DETAIL_VIEWS.length) % DETAIL_VIEWS.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? DETAIL_VIEWS.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          setSelection({ surfaceId: surface.id, view: DETAIL_VIEWS[next]! });
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{view}</button>)}
    </div>
    <div className="workspace-surface-details-scroll" id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${activeView}`}>
      {activeView === 'Breakdown' ? <>
      <section className="workspace-surface-details-section">
        <h3>About</h3>
        <p className="workspace-surface-details-description">{surface.description.trim() || 'No description recorded.'}</p>
        {coverage ? <>
          <DetailText label="What we know" value={coverage.summary} />
          <DetailText label="Gaps" value={coverage.gaps} />
          <DetailText label="Possible leads" value={coverage.opportunities} />
        </> : null}
      </section>

      <SurfaceListSection title="Open Questions" values={coverage?.openQuestions ?? []}
        emptyMessage="No open questions recorded." />
      <SurfaceListSection title="Related Components" values={coverage?.unexploredConnections ?? []}
        emptyMessage="No related components recorded." />

      {surface.progressBlocker ? <section className="workspace-surface-details-section workspace-surface-details-blocker">
        <h3>Progress blocker</h3><p>{surface.progressBlocker.reason}</p>
        <small>Recorded by {surface.progressBlocker.actorId} on {new Date(surface.progressBlocker.setAt).toLocaleString()}</small>
      </section> : null}

      {surface.foundation?.threatModel ? <section className="workspace-surface-details-section">
        <h3>Threat model</h3>
        <DetailText label="Attacker control" value={surface.foundation.threatModel.attackerControl} />
        <DetailText label="Trust boundaries" value={surface.foundation.threatModel.trustBoundaries} />
        <DetailText label="Assets at risk" value={surface.foundation.threatModel.assetsAtRisk} />
        <DetailText label="Plausible impacts" value={surface.foundation.threatModel.plausibleImpacts} />
        <DetailText label="Assumptions" value={surface.foundation.threatModel.assumptions} />
      </section> : null}

      {surface.foundation?.bugHistory ? <section className="workspace-surface-details-section">
        <h3>Bug history</h3>
        <DetailText label="Summary" value={surface.foundation.bugHistory.summary} />
        <DetailText label="Limits" value={surface.foundation.bugHistory.limits} />
      </section> : null}

      {surface.coverageState.unblockedFindingIds.length ? <section className="workspace-surface-details-section">
        <h3>Findings needing resolution</h3><p>{surface.coverageState.unblockedFindingIds.length} recorded</p>
      </section> : null}
      {agents.length ? <section className="workspace-surface-details-section">
        <h3>Active agents</h3>
        <ul className="workspace-surface-details-agents">{agents.map((agent) => <li key={`${agent.sessionId}:${agent.agentId}`}>
          <strong>{agent.agentId === 'root' ? 'Lead' : agent.agentId}</strong><span>{agent.sessionTitle}</span>
        </li>)}</ul>
      </section> : null}
      </> : activeView === 'History' ? <SurfaceHistory surface={surface} /> : <>
        <section className="workspace-surface-details-section">
          <h3>Path</h3>
          <ol className="workspace-surface-details-trail">{trail.map((item) => <li key={item.id}>{item.name}</li>)}</ol>
          {surface.resourceKind ? <p><strong>Resource type</strong><span>{surface.resourceKind}</span></p> : null}
          {surface.resourceSource ? <p><strong>Resource source</strong><span>{surface.resourceSource.replaceAll('_', ' ')}</span></p> : null}
        </section>
        {children.length ? <section className="workspace-surface-details-section">
          <h3>Child surfaces</h3>
          <ul className="workspace-surface-details-children">{children.map((child) => <li key={child.id}>{child.name}</li>)}</ul>
        </section> : null}
      </>}
    </div>
  </aside>;
}
