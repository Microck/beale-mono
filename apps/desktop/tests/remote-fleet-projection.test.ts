import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { FleetRemoteCatalog } from '@beale/app-server-runtime/protocol';
import { RemoteFleetSidebar } from '../src/renderer/features/fleet/RemoteFleetWorkspace';
import { CommentaryView } from '../src/renderer/features/commentary/CommentaryView';
import { mergeRemoteSessionHistory, remoteRunDetail, remoteSessionHistoryPage, remoteWorkspaceRegistry } from '../src/renderer/features/fleet/remoteFleetProjection';
import { buildTraceDisplayEventsForAgentPath } from '../src/renderer/view-models/traceDisplay';
import { commentaryMessagesForSession } from '../src/renderer/view-models/commentary';

const catalog: FleetRemoteCatalog = {
  serverId: 'server-example',
  workspaces: [{ id: 'registry-example', workspaceId: 'workspace-example', name: 'ExampleCo Research', runCount: 1 }],
  sessions: [{ id: 'session-example', workspaceId: 'workspace-example', title: 'Inspect example service', status: 'running', prompt: 'Inspect example.test', updatedAt: '2026-01-01T00:00:00.000Z', automation: false }],
  machines: [],
  requiredWorkspaceIds: [],
  optionalWorkspaceIds: [],
  hasBaseVm: false
};

test('remote workspaces and sessions use the standard sidebar hierarchy', () => {
  const registry = remoteWorkspaceRegistry(catalog, catalog.serverId);
  expect(registry?.workspaces.map((workspace) => workspace.workspaceName)).toEqual(['ExampleCo Research']);
  expect(registry?.researchSessions.map((session) => session.status)).toEqual(['active']);
  const html = renderToStaticMarkup(createElement(RemoteFleetSidebar, {
    catalog,
    serverName: 'Example server',
    selectedWorkspaceId: 'workspace-example',
    selectedSessionId: 'session-example',
    automations: false,
    collapsed: false,
    serverSelector: null,
    onSelect: () => undefined,
    onResizePointerDown: () => undefined
  }));
  expect(html).toContain('workspace-list');
  expect(html).toContain('workspace-session-list');
  expect(html).toContain('ExampleCo Research');
  expect(html).toContain('Inspect example service');
});

test('remote canonical events feed the local commentary projection', () => {
  const detail = remoteRunDetail({ result: {
    session: { id: 'session-example', status: 'running', title: 'Inspect example service', prompt: 'Inspect example.test', model: 'example-model', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z', metadata: {} },
    events: [
      { id: 'event-user', kind: 'beale.transcript', timestamp: '2026-01-01T00:00:00.000Z', payload: { record: { id: 'user-example', role: 'user', contentMarkdown: 'Inspect example.test', source: 'run_prompt', metadata: {}, createdAt: '2026-01-01T00:00:00.000Z' } } },
      { id: 'event-commentary', kind: 'model.output', timestamp: '2026-01-01T00:00:30.000Z', payload: { phase: 'completed', messagePhase: 'commentary', text: '**Checking** the service.', agentPath: '/root' } },
      { id: 'event-tool', kind: 'research.event', timestamp: '2026-01-01T00:00:40.000Z', payload: { event: { kind: 'tool.requested', agentPath: '/root', payload: { toolName: 'file.read', toolActionId: 'tool-example' } } } },
      { id: 'event-final', kind: 'model.output', timestamp: '2026-01-01T00:01:00.000Z', payload: { phase: 'completed', messagePhase: 'final_answer', text: 'Review complete.', agentPath: '/root' } }
    ]
  } });
  expect(detail).not.toBeNull();
  const events = buildTraceDisplayEventsForAgentPath(detail!, null);
  const messages = commentaryMessagesForSession(detail, events);
  expect(messages.map((message) => message.kind)).toEqual(['user', 'commentary', 'tool', 'final_answer']);
  expect(messages.map((message) => message.contentMarkdown)).toContain('**Checking** the service.');
  const html = renderToStaticMarkup(createElement(CommentaryView, {
    busy: false,
    detail,
    events,
    providerModelCatalog: [],
    selectedRunId: 'session-example',
    showBackToMain: false,
    searchHighlightQuery: '',
    onBackToMain: () => undefined,
    onSessionAction: () => undefined,
    onSteerInstruction: () => undefined
  }));
  expect(html).toContain('main-commentary-view');
  expect(html).toContain('<strong>Checking</strong>');
});

test('older remote pages merge with the live tail without repeating events', () => {
  const update = { result: { session: { id: 'session-example' }, events: [{ id: 'event-2', kind: 'research.event' }, { id: 'event-3', kind: 'research.event' }], hasEarlier: true } };
  const page = remoteSessionHistoryPage({ result: { events: [{ id: 'event-1', kind: 'research.event' }, { id: 'event-2', kind: 'research.event' }], hasEarlier: false } });
  expect(page).not.toBeNull();
  const merged = mergeRemoteSessionHistory(update, [page!]);
  expect((merged as typeof update).result.events.map((event) => event.id)).toEqual(['event-1', 'event-2', 'event-3']);
  expect(remoteRunDetail(merged)?.historyCursor).toEqual({ beforeEventId: 'event-1', hasEarlier: false });
});
