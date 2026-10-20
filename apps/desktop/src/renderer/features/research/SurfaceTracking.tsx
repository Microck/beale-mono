import type { JSX } from 'react';
import type { SurfaceTrackingChart, UnassignedSurfaceAgent } from '../../view-models/surfaceTracking';

export function SurfaceTracking({ charts, unassignedAgents }: {
  charts: readonly SurfaceTrackingChart[];
  unassignedAgents: readonly UnassignedSurfaceAgent[];
}): JSX.Element {
  return (
    <section className="session-surface-tracking" aria-label="Active surface focus">
      <h3>Surface focus</h3>
      {charts.length === 0 && unassignedAgents.length === 0
        ? <p className="session-surface-tracking-empty">No active surface focus.</p> : null}
      {charts.map((chart) => {
        const half = chart.size / 2;
        const surfaceNames = new Map(chart.segments.map((segment) => [segment.id, segment.label]));
        return (
          <figure key={chart.rootId} className="session-surface-chart">
            <svg viewBox={`${-half} ${-half} ${chart.size} ${chart.size}`}
              role="img" aria-label={`${chart.rootName}: ${chart.agents.length} active ${chart.agents.length === 1 ? 'agent' : 'agents'}`}>
              <title>{chart.rootName} surface focus</title>
              <desc>{chart.agents.map((agent) => `${agent.label} on ${surfaceNames.get(agent.surfaceId) ?? chart.rootName}`).join('; ')}</desc>
              <circle className="session-surface-root" r="18"><title>{chart.rootName}</title></circle>
              {chart.segments.map((segment) => (
                <path key={segment.id} className="session-surface-ring" d={segment.path}
                  strokeWidth="16" fill="none">
                  <title>{segment.label}</title>
                </path>
              ))}
              {chart.agents.map((agent) => (
                <circle key={agent.path} className="session-surface-agent"
                  cx={agent.x} cy={agent.y} r={agent.radius}
                  style={{ fill: `color-mix(in srgb, var(--text) ${agent.shadePercent}%, transparent)` }}>
                  <title>{agent.label} · {surfaceNames.get(agent.surfaceId) ?? chart.rootName}</title>
                </circle>
              ))}
            </svg>
            <figcaption>{chart.rootName} <span>· {chart.agents.length} active</span></figcaption>
          </figure>
        );
      })}
      {unassignedAgents.length > 0 ? (
        <div className="session-surface-unassigned" aria-label="Agents without a surface focus">
          <span>Unassigned</span>
          {unassignedAgents.map((agent) => (
            <span key={agent.path} className="session-surface-unassigned-dot"
              role="img" aria-label={`${agent.label}: no surface focus recorded`}
              title={`${agent.label}: no surface focus recorded`}
              style={{ borderColor: `color-mix(in srgb, var(--text) ${agent.shadePercent}%, transparent)` }} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
