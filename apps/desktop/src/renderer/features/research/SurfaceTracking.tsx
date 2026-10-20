import type { JSX } from 'react';
import type { SurfaceTrackingChart, UnassignedSurfaceAgent } from '../../view-models/surfaceTracking';

export function SurfaceTracking({ charts, unassignedAgents, onSelectSubagent }: {
  charts: readonly SurfaceTrackingChart[];
  unassignedAgents: readonly UnassignedSurfaceAgent[];
  onSelectSubagent?: (path: string) => void;
}): JSX.Element {
  const focusedAgents = charts.flatMap((chart) => chart.agents.map((agent) => ({ chart, agent })));
  const selected = focusedAgents.find(({ agent }) => agent.path === '/root')
    ?? focusedAgents.sort((left, right) => left.agent.path.localeCompare(right.agent.path))[0];
  return (
    <section className="session-surface-tracking" aria-label="Active surface focus">
      {charts.map((chart) => {
        const half = chart.size / 2;
        const surfaceNames = new Map(chart.segments.map((segment) => [segment.id, segment.label]));
        const selectedAgent = selected?.chart.rootId === chart.rootId ? selected.agent : null;
        const selectedSegment = chart.segments.find((segment) => segment.id === selectedAgent?.surfaceId);
        const surfaceName = selectedSegment?.name ?? chart.rootName;
        const ancestorNames = selectedSegment?.ancestorNames ?? [chart.rootName];
        const surfacePath = [...ancestorNames, ...(selectedSegment ? [surfaceName] : [])].join(' / ');
        return (
          <figure key={chart.rootId} className="session-surface-chart">
            <div className="session-surface-current">
              {selectedAgent ? (
                <>
                  <div className="session-surface-current-path" title={selectedSegment ? ancestorNames.at(-1) : undefined}
                    style={{ color: surfaceLevelColor(selectedAgent.surfaceDepth + 1) }}>
                    {ancestorNames.map((name) => `${name} \\`).join(' ')}
                  </div>
                  <div className="session-surface-current-name" title={surfacePath}>
                    {surfaceName}
                  </div>
                </>
              ) : null}
            </div>
            <svg viewBox={`${-half} ${-half} ${chart.size} ${chart.size}`}
              width={Math.min(chart.size, 176)} height={Math.min(chart.size, 176)}
              role={onSelectSubagent ? 'group' : 'img'}
              aria-label={`${chart.rootName}: ${chart.agents.length} active ${chart.agents.length === 1 ? 'agent' : 'agents'}`}>
              <title>{`${chart.rootName} surface focus`}</title>
              <desc>{chart.agents.map((agent) => `${agent.label} on ${surfaceNames.get(agent.surfaceId) ?? chart.rootName}`).join('; ')}</desc>
              <circle className="session-surface-root" r="7"><title>{chart.rootName}</title></circle>
              {chart.segments.map((segment) => (
                <path key={segment.id} className="session-surface-ring" d={segment.path}
                  strokeWidth="5" fill="none">
                  <title>{segment.label}</title>
                </path>
              ))}
              {onSelectSubagent ? chart.agents.filter((agent) => agent.path !== '/root').map((agent) => (
                <circle key={`${agent.path}:hit`} className="session-surface-agent-hit"
                  cx={agent.x} cy={agent.y} r={Math.max(10, agent.radius + 5)}
                  aria-hidden="true" onClick={() => onSelectSubagent(agent.path)}>
                  <title>{`Open ${agent.label} subagent`}</title>
                </circle>
              )) : null}
              {chart.agents.map((agent) => (
                <circle key={agent.path} className="session-surface-agent"
                  cx={agent.x} cy={agent.y} r={agent.radius}
                  role={agent.path !== '/root' && onSelectSubagent ? 'button' : undefined}
                  tabIndex={agent.path !== '/root' && onSelectSubagent ? 0 : undefined}
                  aria-label={agent.path !== '/root' && onSelectSubagent ? `Open ${agent.label} subagent` : undefined}
                  onClick={agent.path !== '/root' && onSelectSubagent ? () => onSelectSubagent(agent.path) : undefined}
                  onKeyDown={agent.path !== '/root' && onSelectSubagent ? (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    onSelectSubagent(agent.path);
                  } : undefined}
                  style={{ fill: `color-mix(in srgb, var(--text) ${agent.shadePercent}%, transparent)` }}>
                  <title>{`${agent.label} · ${surfaceNames.get(agent.surfaceId) ?? chart.rootName}`}</title>
                </circle>
              ))}
            </svg>
          </figure>
        );
      })}
      {unassignedAgents.length > 0 ? (
        <div className="session-surface-unassigned" aria-label="Agents without a surface focus">
          {unassignedAgents.map((agent) => onSelectSubagent ? (
            <button key={agent.path} type="button" className="session-surface-unassigned-dot"
              aria-label={`Open ${agent.label} subagent`}
              title={`${agent.label}: no surface focus recorded`}
              style={{ color: `color-mix(in srgb, var(--text) ${agent.shadePercent}%, transparent)` }}
              onClick={() => onSelectSubagent(agent.path)} />
          ) : (
            <span key={agent.path} className="session-surface-unassigned-dot"
              role="img" aria-label={`${agent.label}: no surface focus recorded`}
              title={`${agent.label}: no surface focus recorded`}
              style={{ color: `color-mix(in srgb, var(--text) ${agent.shadePercent}%, transparent)` }} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function surfaceLevelColor(depth: number): string {
  const percent = [100, 72, 52][depth] ?? 40;
  return `color-mix(in srgb, var(--text) ${percent}%, var(--panel-column))`;
}
