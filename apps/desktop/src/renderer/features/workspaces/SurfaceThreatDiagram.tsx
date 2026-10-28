import { useEffect, useId, useState, type JSX } from 'react';

type DiagramTheme = 'dark' | 'neutral';
let nextRenderId = 0;

function currentTheme(): DiagramTheme {
  if (typeof document === 'undefined') return 'neutral';
  return document.documentElement.dataset.theme === 'light' || document.documentElement.dataset.theme === 'cream'
    ? 'neutral' : 'dark';
}

export function SurfaceThreatDiagram({ source, surfaceName }: { source: string; surfaceName: string }): JSX.Element {
  const id = `surface-threat-${useId().replace(/[^a-zA-Z0-9_-]/gu, '')}`;
  const [theme, setTheme] = useState(currentTheme);
  const [rendered, setRendered] = useState<{ key: string; url?: string; error?: boolean } | null>(null);
  const key = `${theme}\0${source}`;

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!source.trim()) return;
    let disposed = false;
    let objectUrl: string | null = null;
    void import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
        theme, maxTextSize: 50_000, maxEdges: 200, flowchart: { htmlLabels: false } });
      const { svg } = await mermaid.render(`${id}-${++nextRenderId}`, source);
      if (disposed) return;
      objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      setRendered({ key, url: objectUrl });
    }).catch(() => {
      if (!disposed) setRendered({ key, error: true });
    });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, key, source, theme]);

  if (!source.trim()) return <p className="workspace-surface-details-muted">No threat model diagram recorded.</p>;
  if (rendered?.key === key && rendered.url) return <div className="workspace-surface-threat-diagram">
    <img src={rendered.url} alt={`Threat model diagram for ${surfaceName}`} />
  </div>;
  if (rendered?.key === key && rendered.error) return <div className="workspace-surface-threat-diagram-error" role="status">
    <p>Could not render this Mermaid diagram.</p>
    <pre>{source}</pre>
  </div>;
  return <p className="workspace-surface-details-muted" role="status">Rendering diagram…</p>;
}
