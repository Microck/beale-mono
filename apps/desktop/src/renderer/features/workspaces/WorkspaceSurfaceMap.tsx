import { useMemo, useState, type JSX } from 'react';
import type { BealeWorkspaceSurfaceMap } from '@beale/app-server-runtime/protocol';
import { filterSurfaceHierarchy, layoutSurfaceHierarchy, surfaceCoveragePercent } from '../../view-models/surfaceMap';
import { WorkspaceTitleSearch } from './WorkspaceTitleSearch';

export function WorkspaceSurfaceMap({ map, workspaceName, loading = false, error = null }: {
  map: BealeWorkspaceSurfaceMap | null;
  workspaceName: string;
  loading?: boolean;
  error?: string | null;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [showUntouched, setShowUntouched] = useState(false);
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(null);
  const visibleSurfaces = useMemo(() => map ? filterSurfaceHierarchy(map.surfaces, query, showUntouched) : [],
    [map, query, showUntouched]);
  const layout = useMemo(() => layoutSurfaceHierarchy(visibleSurfaces), [visibleSurfaces]);
  const nodes = new Map(layout.nodes.map((node) => [node.surface.id, node]));
  const agents = map?.agents.filter((agent) => nodes.has(agent.surfaceId)) ?? [];
  const selected = visibleSurfaces.find((surface) => surface.id === selectedSurfaceId) ?? null;

  return <section className="workspace-surface-map" aria-label="Workspace surfaces">
    <header className="workspace-surface-map-heading">
      <div className="settings-form-heading">
        <div className="workspace-catalog-title-row"><h2>{workspaceName.trim() || 'Workspace'} Surfaces</h2><WorkspaceTitleSearch label="surfaces" query={query} onChange={setQuery} /></div>
        <p>Security surfaces and their threat-model coverage.</p>
      </div>
      {map ? <div className="workspace-surface-map-count">{map.surfaces.filter((surface) => surfaceCoveragePercent(surface) > 0).length} of {map.surfaces.length} touched · {map.surfaces.filter((surface) => surface.coverageState.covered).length} complete · {map.surfaces.filter((surface) => surface.progressBlocker).length} blocked</div> : null}
    </header>
    {error ? <p className="workspace-surface-map-status" role="alert">{error}</p> : !map
      ? <p className="workspace-surface-map-status" role="status">{loading ? 'Loading surfaces…' : 'Surface map unavailable.'}</p>
      : <>
    <div className="workspace-surface-map-filters">
      <label className="workspace-surface-map-untouched">
        <input type="checkbox" checked={showUntouched} onChange={(event) => setShowUntouched(event.target.checked)} />
        Show untouched surfaces
      </label>
    </div>
    {layout.nodes.length === 0 ? <p className="workspace-surface-map-empty">{query.trim()
      ? 'No surfaces match this filter.'
      : map.surfaces.length && !showUntouched
        ? 'No surfaces have coverage yet. Show untouched surfaces to see the full map.'
        : 'No surfaces have been mapped in this workspace yet.'}</p> : <div className="workspace-surface-map-scroll">
      <div className="workspace-surface-map-canvas" style={{ width: layout.width, height: layout.height }}>
        <svg aria-hidden="true" className="workspace-surface-map-edges" width={layout.width} height={layout.height}>
          {layout.nodes.flatMap((node) => {
            const parent = node.surface.parentId ? nodes.get(node.surface.parentId) : null;
            if (!parent) return [];
            const x1 = parent.x + 220; const x2 = node.x;
            const y1 = parent.y + 42; const y2 = node.y + 42;
            return [<path key={node.surface.id} d={`M ${x1} ${y1} C ${x1 + 22} ${y1}, ${x2 - 22} ${y2}, ${x2} ${y2}`} />];
          })}
        </svg>
        {layout.nodes.map((node) => {
          const coverage = surfaceCoveragePercent(node.surface);
          return <button key={node.surface.id} className={`workspace-surface-node${selectedSurfaceId === node.surface.id ? ' selected' : ''}${node.surface.coverageState.covered ? ' covered' : ''}${node.surface.progressBlocker ? ' blocked' : ''}`}
            style={{ left: node.x, top: node.y, backgroundImage: `linear-gradient(90deg, var(--surface-coverage-fill) ${coverage}%, var(--surface-node-bg) ${coverage}%)` }}
            type="button" onClick={() => setSelectedSurfaceId(node.surface.id)} title={`${node.surface.name} · ${coverage}% coverage${node.surface.progressBlocker ? ` · Blocked: ${node.surface.progressBlocker.reason}` : ''}`}>
            <span className="workspace-surface-node-kind">{node.surface.parentId ? 'Surface' : 'Resource root'}{node.surface.progressBlocker ? ' · Blocked' : ''}</span>
            <span className="workspace-surface-node-name">{node.surface.name}</span>
            <span className="workspace-surface-node-progress">{coverage}%</span>
          </button>;
        })}
        {agents.map((agent, index) => {
          const node = nodes.get(agent.surfaceId)!;
          const clustered = agents.slice(0, index).filter((candidate) => candidate.surfaceId === agent.surfaceId).length;
          return <span key={`${agent.sessionId}:${agent.agentId}`} className={`workspace-surface-agent-dot${agent.agentId === 'root' ? ' root' : ''}`}
            style={{ left: node.x + 16 + clustered * 16, top: node.y + 75 }}
            title={`${agent.agentId === 'root' ? 'Main agent' : agent.agentId} · ${agent.sessionTitle}`} />;
        })}
      </div>
    </div>}
    {selected ? <div className="workspace-surface-map-detail"><strong>{selected.name}</strong><span>{selected.description}</span>
      {selected.progressBlocker ? <p className="workspace-surface-map-blocker"><strong>Blocked</strong> {selected.progressBlocker.reason}</p> : null}
      <span className="workspace-surface-map-coverage">{selected.coverageState.covered ? 'Covered' : `Coverage ${surfaceCoveragePercent(selected)}%`}
        {selected.coverageState.unmetRequirements.length ? ` · Open: ${selected.coverageState.unmetRequirements.join(', ').replaceAll('_', ' ')}` : ''}</span>
    </div> : null}
    </>}
  </section>;
}
