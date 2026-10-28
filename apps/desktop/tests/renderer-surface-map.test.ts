import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { BealeWorkspaceSurfaceMap } from '@beale/app-server-runtime/protocol';
import { WorkspaceSurfaceMap } from '../src/renderer/features/workspaces/WorkspaceSurfaceMap';
import { SurfaceHistory, WorkspaceSurfaceDetails } from '../src/renderer/features/workspaces/WorkspaceSurfaceDetails';
import { filterSurfaceHierarchy, layoutSurfaceHierarchy, surfaceCoveragePercent } from '../src/renderer/view-models/surfaceMap';

type Surface = BealeWorkspaceSurfaceMap['surfaces'][number];
const surface = (id: string, parentId: string | null, firstTouchedAt: string | null, hasCoverage = false, complete = false): Surface => ({
  id, parentId, resourceId: 'asset-example', name: id, description: `${id} boundary`, firstTouchedAt,
  foundation: hasCoverage ? { coverage: { mappingComplete: false, sinksInvestigated: false, openQuestions: [], unexploredConnections: [] } } : null,
  progressBlocker: null,
  coverageState: { covered: complete, unmetRequirements: complete ? [] : hasCoverage ? ['mapping'] : ['foundation'], unblockedFindingIds: [] }
});
const surfaces: Surface[] = [
  surface('asset-example', null, null),
  surface('parser', 'asset-example', '2026-01-01T00:00:00.000Z', true),
  surface('sink', 'parser', '2026-01-01T00:01:00.000Z', true, true),
  surface('untouched-sibling', 'asset-example', null),
  surface('other-root', null, '2026-01-01T00:02:00.000Z')
];

test('zero-coverage ancestors stay visible, while unrelated zero-coverage surfaces stay hidden', () => {
  expect(filterSurfaceHierarchy(surfaces, '', false).map((item) => item.id))
    .toEqual(['asset-example', 'parser', 'sink']);
  expect(filterSurfaceHierarchy(surfaces, '', true)).toEqual(surfaces);
  expect(layoutSurfaceHierarchy(filterSurfaceHierarchy(surfaces, '', false)).nodes
    .find((node) => node.surface.id === 'sink')?.depth).toBe(2);
});

test('filter preserves the full ancestor path and descendant branch', () => {
  expect(filterSurfaceHierarchy(surfaces, 'parser', false).map((item) => item.id))
    .toEqual(['asset-example', 'parser', 'sink']);
  expect(filterSurfaceHierarchy(surfaces, 'sink', true).map((item) => item.id))
    .toEqual(['asset-example', 'parser', 'sink']);
  expect(filterSurfaceHierarchy(surfaces, 'asset-example', true).map((item) => item.id))
    .toEqual(['asset-example', 'parser', 'sink', 'untouched-sibling']);
  expect(filterSurfaceHierarchy(surfaces, 'missing', true)).toEqual([]);
  expect(layoutSurfaceHierarchy(filterSurfaceHierarchy(surfaces, 'parser', false)).nodes.find((node) => node.surface.id === 'sink')?.depth).toBe(2);
});

test('live map shows search and untouched controls without replay', () => {
  const map: BealeWorkspaceSurfaceMap = { schemaVersion: 1, workspaceId: 'workspace-example', surfaces, agents: [] };
  const html = renderToStaticMarkup(createElement(WorkspaceSurfaceMap, { map, workspaceName: 'Example Workspace' }));
  expect(html).toContain('<h2>Example Workspace Surfaces</h2>');
  expect(html).toContain('System components and their current research context.');
  expect(html).toContain('aria-label="Search surfaces"');
  expect(html).not.toContain('workspace-surface-map-search');
  expect(html).toContain('Show untouched surfaces');
  expect(html).toContain('2 of 5 touched · 1 complete · 0 blocked');
  expect(html).not.toContain('Replay');
  expect(html).toContain('title="asset-example"');
  expect(html).toContain('aria-label="sink, 100% coverage"');
  expect(html).toContain('var(--surface-coverage-fill) 100%, transparent 100%');
  expect(html).not.toContain('workspace-surface-node-progress');
  expect(html).not.toContain('untouched-sibling boundary');
  expect(html).not.toContain('other-root boundary');
  expect(html).not.toContain('workspace-surface-map-detail');
  expect(surfaceCoveragePercent(surfaces[0]!)).toBe(0);
});

test('selected surface details show hierarchy, coverage, blockers, and foundation state', () => {
  const selected: Surface = {
    ...surfaces[1]!,
    firstTouchedBy: 'root',
    firstTouchedModel: 'gpt-example',
    updatedAt: '2026-01-01T00:04:00.000Z',
    history: [
      { kind: 'blocked', at: '2026-01-01T00:03:00.000Z', actorId: 'agent-example' },
      { kind: 'first_touch', at: '2026-01-01T00:00:00.000Z', actorId: 'root' },
      { kind: 'created', at: '2025-12-31T23:59:00.000Z', actorId: null }
    ],
    foundation: {
      bugHistory: { summary: 'No known issue in searched sources.', limits: 'Public sources only.' },
      threatModel: { attackerControl: 'Request bytes.', trustBoundaries: 'Network to parser.',
        assetsAtRisk: 'Example state.', plausibleImpacts: 'Unauthorized change.', assumptions: 'Service enabled.' },
      coverage: { summary: 'Mapped input to sink.', gaps: 'Authenticated path remains.', opportunities: 'Review parser modes.',
        mappingComplete: true, sinksInvestigated: false, openQuestions: ['Which modes are enabled?'],
        unexploredConnections: ['Parser to storage'] }
    },
    progressBlocker: { reason: 'Test account required.', actorId: 'agent-example', setAt: '2026-01-01T00:03:00.000Z' },
    coverageState: { covered: false, unmetRequirements: ['sinks', 'open_questions', 'blocked'], unblockedFindingIds: [] }
  };
  const map: BealeWorkspaceSurfaceMap = { schemaVersion: 1, workspaceId: 'workspace-example',
    surfaces: surfaces.map((item) => item.id === selected.id ? selected : item),
    agents: [{ sessionId: 'session-example', sessionTitle: 'Example session', agentId: 'root', surfaceId: selected.id }] };
  const html = renderToStaticMarkup(createElement(WorkspaceSurfaceDetails, { surface: selected, map, onClose: () => undefined }));
  expect(html).toContain('aria-label="Surface details"');
  expect(html).toContain('Back to Surfaces');
  expect(html).toContain('research-side-nested-header is-campaign-item');
  expect(html).toContain('research-side-nested-name" title="parser">parser</span>');
  expect(html).toContain('Surface status: Blocked');
  expect(html).toMatch(/title="parser">parser<\/span><span class="workspace-surface-details-status blocked"/);
  expect(html).toContain('First touched by <span>gpt-example</span>');
  expect(html).toContain('Updated <time dateTime="2026-01-01T00:04:00.000Z"');
  expect(html).toContain('role="tablist" aria-label="Surface detail views"');
  expect(html).toContain('role="tab" aria-selected="true"');
  expect(html).toContain('>Breakdown</button>');
  expect(html).toContain('>History</button>');
  expect(html).toContain('>Hierarchy</button>');
  expect(html).toContain('About');
  expect(html).not.toContain('>Path</h3>');
  expect(html).toContain('<h3>Open Questions</h3>');
  expect(html).toContain('<h3>Related Components</h3>');
  expect(html).not.toContain('Research context');
  expect(html).not.toContain('Remaining requirements');
  expect(html).toContain('Mapped input to sink.');
  expect(html).toContain('Authenticated path remains.');
  expect(html).toContain('Review parser modes.');
  expect(html).toContain('Which modes are enabled?');
  expect(html).toContain('Parser to storage');
  expect(html).toContain('Test account required.');
  expect(html).toContain('Attacker control');
  expect(html).toContain('Request bytes.');
  expect(html).toContain('No known issue in searched sources.');
  expect(html).toContain('Example session');
  const history = renderToStaticMarkup(createElement(SurfaceHistory, { surface: selected }));
  expect(history).toContain('Progress blocked');
  expect(history).toContain('First touched by gpt-example');
  expect(history).toContain('Surface created');
});

test('surface details keep a recorded first touch when an older server omits its author', () => {
  const map: BealeWorkspaceSurfaceMap = { schemaVersion: 1, workspaceId: 'workspace-example', surfaces, agents: [] };
  const touched = renderToStaticMarkup(createElement(WorkspaceSurfaceDetails, {
    surface: surfaces[1]!, map, onClose: () => undefined
  }));
  expect(touched).toContain('First touched by <span>Unknown</span>');
  expect(touched).not.toContain('No first touch recorded');
  expect(touched).toContain('Last update unknown');
  const priorHistory = renderToStaticMarkup(createElement(SurfaceHistory, { surface: surfaces[1]! }));
  expect(priorHistory).toContain('First touched by Unknown');

  const untouched = renderToStaticMarkup(createElement(WorkspaceSurfaceDetails, {
    surface: surfaces[0]!, map, onClose: () => undefined
  }));
  expect(untouched).toContain('No first touch recorded');
  expect(untouched).toContain('No open questions recorded.');
  expect(untouched).toContain('No related components recorded.');
  expect(renderToStaticMarkup(createElement(SurfaceHistory, { surface: surfaces[0]! }))).toContain('No surface history recorded.');
});

test('blocked surfaces show their dependency in the map', () => {
  const reason = 'Pre-auth requests were tested; an authorized account is required for the remaining session path.';
  const blocked: Surface = { ...surfaces[1]!, progressBlocker: { reason, actorId: 'agent-example', setAt: '2026-01-01T00:03:00.000Z' },
    coverageState: { covered: false, unmetRequirements: ['blocked'], unblockedFindingIds: [] } };
  const map: BealeWorkspaceSurfaceMap = { schemaVersion: 1, workspaceId: 'workspace-example',
    surfaces: surfaces.map((item) => item.id === blocked.id ? blocked : item), agents: [] };
  const html = renderToStaticMarkup(createElement(WorkspaceSurfaceMap, { map, workspaceName: 'Example Workspace' }));
  expect(html).toContain('1 blocked');
  expect(html).toContain('workspace-surface-node blocked');
  expect(html).toContain('lucide-triangle-alert');
  expect(html).not.toContain('>Blocked</span>');
  expect(html).toContain(`Blocked: ${reason}`);
});

test('surface map keeps the workspace heading while loading', () => {
  const html = renderToStaticMarkup(createElement(WorkspaceSurfaceMap, { map: null, workspaceName: 'Example Workspace', loading: true }));
  expect(html).toContain('<h2>Example Workspace Surfaces</h2>');
  expect(html).toContain('aria-label="Search surfaces"');
  expect(html).toContain('Loading surfaces…');
});
