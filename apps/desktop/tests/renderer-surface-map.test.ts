import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { BealeWorkspaceSurfaceMap } from '@beale/app-server-runtime/protocol';
import { WorkspaceSurfaceMap } from '../src/renderer/features/workspaces/WorkspaceSurfaceMap';
import { filterSurfaceHierarchy, layoutSurfaceHierarchy, surfaceCoveragePercent } from '../src/renderer/view-models/surfaceMap';

type Surface = BealeWorkspaceSurfaceMap['surfaces'][number];
const surface = (id: string, parentId: string | null, firstTouchedAt: string | null, hasCoverage = false, complete = false): Surface => ({
  id, parentId, resourceId: 'asset-example', name: id, description: `${id} boundary`, firstTouchedAt,
  foundation: hasCoverage ? { coverage: { mappingComplete: false, sinksInvestigated: false, openQuestions: [], unexploredConnections: [] } } : null,
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
  expect(html).toContain('Security surfaces and their threat-model coverage.');
  expect(html).toContain('aria-label="Search surfaces"');
  expect(html).not.toContain('workspace-surface-map-search');
  expect(html).toContain('Show untouched surfaces');
  expect(html).toContain('2 of 5 touched · 1 complete');
  expect(html).not.toContain('Replay');
  expect(html).toContain('asset-example · 0% coverage');
  expect(html).not.toContain('untouched-sibling boundary');
  expect(html).not.toContain('other-root boundary');
  expect(surfaceCoveragePercent(surfaces[0]!)).toBe(0);
});

test('surface map keeps the workspace heading while loading', () => {
  const html = renderToStaticMarkup(createElement(WorkspaceSurfaceMap, { map: null, workspaceName: 'Example Workspace', loading: true }));
  expect(html).toContain('<h2>Example Workspace Surfaces</h2>');
  expect(html).toContain('aria-label="Search surfaces"');
  expect(html).toContain('Loading surfaces…');
});
