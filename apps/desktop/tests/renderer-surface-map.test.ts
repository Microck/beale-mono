import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { BealeWorkspaceSurfaceMap } from '@beale/app-server-runtime/protocol';
import { WorkspaceSurfaceMap } from '../src/renderer/features/workspaces/WorkspaceSurfaceMap';
import { WorkspaceSurfaceDetails } from '../src/renderer/features/workspaces/WorkspaceSurfaceDetails';
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
  expect(html).toContain('title="untouched-sibling"');
  expect(html).toContain('title="other-root"');
  expect(html).not.toContain('workspace-surface-map-detail');
  expect(surfaceCoveragePercent(surfaces[0]!)).toBe(0);
});

test('resource type filter keeps each root with its descendants', () => {
  const map: BealeWorkspaceSurfaceMap = { schemaVersion: 1, workspaceId: 'workspace-example', agents: [], surfaces: [
    { ...surface('repo-root', null, null), resourceKind: 'repository' },
    { ...surface('repo-child', 'repo-root', null), resourceKind: 'repository' },
    { ...surface('service-root', null, null), resourceKind: 'service' }
  ] };
  const html = renderToStaticMarkup(createElement(WorkspaceSurfaceMap, {
    map, workspaceName: 'Example Workspace', resourceKind: 'repo'
  }));
  expect(html).toContain('title="repo-root"');
  expect(html).toContain('title="repo-child"');
  expect(html).not.toContain('title="service-root"');
  expect(html).toContain('0 of 2 touched');
});

test('selected surface details show coverage, blockers, and foundation state', () => {
  const selected: Surface = {
    ...surfaces[1]!,
    firstTouchedBy: 'root',
    firstTouchedModel: 'gpt-example',
    firstTouchedProvider: 'openai-codex',
    updatedAt: '2026-01-01T00:04:00.000Z',
    foundation: {
      discovery: 'The example service exposes a request parser behind the public API.',
      techStack: [{ technology: 'Example Parser', role: 'Parses requests', version: '2.x', environment: 'Example service',
        evidence: 'Synthetic package manifest', confidence: 'observed' }],
      bugHistory: { summary: 'Older search note.', limits: 'Public sources only.', entries: [{ identifier: 'EXAMPLE-ADVISORY-001',
        impact: 'Malformed requests may bypass validation.', affectedVersions: '1.x', reference: 'https://example.test/advisory', notes: 'Applicability to 2.x is unknown.' }] },
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
  const providerModelCatalog = [{ providerId: 'openai-codex' as const, providerName: 'OpenAI', models: [
    { id: 'gpt-example', name: 'GPT Example', reasoning: true, effortLevels: [], contextWindow: 0, maxTokens: 0 }
  ] }];
  const html = renderToStaticMarkup(createElement(WorkspaceSurfaceDetails, {
    surface: selected, map, providerModelCatalog, onClose: () => undefined
  }));
  expect(html).toContain('aria-label="Surface details"');
  expect(html).toContain('Back to Surfaces');
  expect(html).toContain('research-side-nested-header is-campaign-item');
  expect(html).toContain('research-side-nested-name" title="parser">parser</span>');
  expect(html).toContain('Surface status: Blocked');
  expect(html).toMatch(/title="parser">parser<\/span><span class="workspace-surface-details-status blocked"/);
  expect(html).toMatch(/<span>First touched by<\/span><span class="memory-catalog-item-author"><span class="memory-catalog-item-author-provider"><svg[^>]+aria-hidden="true"[^>]*>/);
  expect(html).toContain('memory-catalog-item-author-model">GPT Example</span>');
  expect(html).not.toContain('gpt-example</span>');
  expect(html).toContain('Updated <time dateTime="2026-01-01T00:04:00.000Z"');
  expect(html).toContain('role="tablist" aria-label="Surface detail views"');
  expect(html).toContain('role="tab" aria-selected="true"');
  expect(html).toContain('>Breakdown</button>');
  expect(html).toContain('>Recon</button>');
  expect(html).toContain('>Threat Model</button>');
  expect(html).not.toContain('>Bug History</button>');
  expect(html).not.toContain('>History</button>');
  expect(html).not.toContain('>Hierarchy</button>');
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
  expect(html).not.toContain('Attacker control');
  expect(html).not.toContain('Request bytes.');
  expect(html).not.toContain('EXAMPLE-ADVISORY-001');
  expect(html).toContain('Example session');
  const threatModel = renderToStaticMarkup(createElement(WorkspaceSurfaceDetails, {
    surface: selected, map, initialView: 'Threat Model', onClose: () => undefined
  }));
  expect(threatModel).toContain('<h3>Threat Model</h3>');
  expect(threatModel).toContain('Attacker control');
  expect(threatModel).toContain('Request bytes.');
  expect(threatModel).not.toContain('EXAMPLE-ADVISORY-001');
  const recon = renderToStaticMarkup(createElement(WorkspaceSurfaceDetails, {
    surface: selected, map, initialView: 'Recon', onClose: () => undefined
  }));
  expect(recon).toContain('<h3>Discovery</h3>');
  expect(recon).toContain('The example service exposes a request parser');
  expect(recon).toContain('<h3>Tech Stack</h3>');
  expect(recon).toContain('Example Parser');
  expect(recon).toContain('Synthetic package manifest');
  expect(recon).toContain('<h3>Bug History</h3>');
  expect(recon).toContain('EXAMPLE-ADVISORY-001');
  expect(recon).toContain('Malformed requests may bypass validation.');
  expect(recon).toContain('Older search note.');
  expect(recon).not.toContain('Request bytes.');
});

test('surface details keep a recorded first touch when an older server omits its author', () => {
  const map: BealeWorkspaceSurfaceMap = { schemaVersion: 1, workspaceId: 'workspace-example', surfaces, agents: [] };
  const touched = renderToStaticMarkup(createElement(WorkspaceSurfaceDetails, {
    surface: surfaces[1]!, map, onClose: () => undefined
  }));
  expect(touched).toContain('<span>First touched by</span><span class="memory-catalog-item-author">');
  expect(touched).toContain('memory-catalog-item-author-model">Unknown</span>');
  expect(touched).not.toContain('No first touch recorded');
  expect(touched).toContain('Last update unknown');

  const untouched = renderToStaticMarkup(createElement(WorkspaceSurfaceDetails, {
    surface: surfaces[0]!, map, onClose: () => undefined
  }));
  expect(untouched).toContain('No first touch recorded');
  expect(untouched).toContain('No open questions recorded.');
  expect(untouched).toContain('No related components recorded.');
  expect(renderToStaticMarkup(createElement(WorkspaceSurfaceDetails, {
    surface: surfaces[0]!, map, initialView: 'Threat Model', onClose: () => undefined
  }))).toContain('No threat model recorded.');
  expect(renderToStaticMarkup(createElement(WorkspaceSurfaceDetails, {
    surface: surfaces[0]!, map, initialView: 'Recon', onClose: () => undefined
  }))).toContain('No individual advisories recorded.');
});

test('root surface Resources view exposes the linked resource form and checkout state', () => {
  const root: Surface = { ...surface('resource-example', null, null), resourceKind: 'repository',
    resourceSource: 'explicit_scope', resourceDirection: 'in_scope', resourceLocator: 'https://github.com/example-org/example-repository',
    scopeAssetId: 'asset-example' };
  const map: BealeWorkspaceSurfaceMap = { schemaVersion: 1, workspaceId: 'workspace-example', surfaces: [root], agents: [] };
  const html = renderToStaticMarkup(createElement(WorkspaceSurfaceDetails, {
    surface: root, map, workspaceId: 'workspace-example', initialView: 'Resources',
    activeScope: { id: 'scope-example', version: 1, status: 'active', workspaceName: 'Example Workspace',
      scopeOwner: 'ExampleCo', descriptionMarkdown: '', rulesMarkdown: '', activeFrom: '2026-01-01T00:00:00.000Z',
      expiresAt: null, createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'user', assets: [{
        id: 'asset-example', scopeVersionId: 'scope-example', direction: 'in_scope', kind: 'repo',
        value: 'https://github.com/example-org/example-repository', sensitivity: 'public', attributes: {},
        createdAt: '2026-01-01T00:00:00.000Z'
      }] },
    onChangeResource: async () => undefined, onCloneRepository: async () => undefined, onClose: () => undefined
  }));
  expect(html).toContain('>Resources</button>');
  expect(html).toContain('aria-labelledby=');
  expect(html).toContain('>Reference</span>');
  expect(html).toContain('value="https://github.com/example-org/example-repository"');
  expect(html).toContain('>Cloned directory</span>');
  expect(html).toContain('Not cloned');
  expect(html).toContain('Clone repository');
  expect(html).toContain('Prior art');
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
