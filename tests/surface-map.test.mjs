import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { AppServerSessionStore, ResearchResourceCatalog, SurfaceStore } from '../packages/research-agent/dist/index.js';
import { readWorkspaceSurfaceMap } from '../app-server/dist/surfaceMap.js';
import { decodeBealeWorkspaceSurfaceMap } from '../packages/app-server-runtime/dist/protocol.js';

test('surface map projects eligible hierarchy, touch state, coverage, and active agent focus', () => {
  const directory = mkdtempSync(join(tmpdir(), 'beale-surface-map-example-'));
  const databasePath = join(directory, 'memory.sqlite');
  const workspaceId = 'workspace-example';
  const sessions = new AppServerSessionStore({ databasePath });
  const resources = new ResearchResourceCatalog({ databasePath, workspaceId, explicitResources: [
    { id: 'asset-example', direction: 'in_scope', kind: 'service', locator: 'service.example.test', name: 'Example service', source: 'explicit_scope' },
    { id: 'asset-excluded', direction: 'out_of_scope', kind: 'service', locator: 'excluded.example.test', name: 'Excluded service', source: 'explicit_scope' }
  ] });
  const surfaces = new SurfaceStore({ databasePath, workspaceId, sessionId: 'session-example-one', resources });
  try {
    const first = sessions.create({ id: 'session-example-one', workspaceId, attemptId: 'attempt-example-one',
      title: 'Map service', prompt: 'Map authorized service boundaries.', provider: 'openai-codex', model: 'gpt-example',
      reasoningEffort: 'high' });
    const root = resources.list().find((resource) => resource.direction === 'in_scope');
    const child = surfaces.create(root.id, 'Request parser', 'Untrusted request boundary.');
    assert.equal(readWorkspaceSurfaceMap(databasePath, workspaceId).surfaces.find((surface) => surface.id === child.id).firstTouchedAt, null);
    surfaces.focus('root', child.id);
    surfaces.focus('/root/scout', root.id);
    const foundation = {
      bugHistory: { summary: 'No known issue in searched sources.', limits: 'Search limited to public sources.' },
      coverage: { summary: 'Mapped input to sink.', gaps: 'No remaining gaps.', opportunities: 'Review future parser modes.', mappingComplete: true,
        sinksInvestigated: true, openQuestions: [], unexploredConnections: [] },
      threatModel: { attackerControl: 'Request bytes.', trustBoundaries: 'Network to parser.',
        assetsAtRisk: 'Example state.', plausibleImpacts: 'Unauthorized change.', assumptions: 'Service enabled.' }
    };
    surfaces.update(child.id, child.revision, foundation);
    surfaces.update(root.id, 1, foundation);
    const map = readWorkspaceSurfaceMap(databasePath, workspaceId);
    assert.equal(map.surfaces.length, 2);
    assert.equal(map.surfaces.find((surface) => surface.id === child.id).parentId, root.id);
    assert.ok(map.surfaces.every((surface) => surface.firstTouchedAt));
    assert.equal(map.surfaces.every((surface) => surface.coverageState.covered), true);
    assert.equal(map.surfaces.every((surface) => surface.progressBlocker === null), true);
    const reason = 'Public routes were tested without a session; an authorized account is required for authenticated requests. Provide a test account to resume.';
    surfaces.update(child.id, surfaces.get(child.id).revision, { ...foundation,
      coverage: { ...foundation.coverage, gaps: 'Authenticated request paths remain untested.' } },
    undefined, undefined, { reason }, '/root/scout');
    const blocked = decodeBealeWorkspaceSurfaceMap(readWorkspaceSurfaceMap(databasePath, workspaceId));
    assert.equal(blocked.surfaces.find((surface) => surface.id === child.id).progressBlocker.reason, reason);
    assert.deepEqual(blocked.surfaces.find((surface) => surface.id === child.id).coverageState.unmetRequirements, ['blocked']);
    assert.deepEqual(blocked.surfaces.find((surface) => surface.id === root.id).coverageState.unmetRequirements, ['child_surfaces']);
    assert.throws(() => decodeBealeWorkspaceSurfaceMap({ ...blocked, surfaces: blocked.surfaces.map((surface) =>
      surface.id === child.id ? { ...surface, progressBlocker: { reason } } : surface) }), /invalid workspace surface map/);
    assert.deepEqual(new Set(map.agents.map((agent) => agent.agentId)), new Set(['root', '/root/scout']));
    assert.equal(map.agents[0].sessionTitle, 'Map service');
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name LIKE 'app_server_session_activity_%'").get().count, 0);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM app_server_session_activity_events').get().count, 0);
    } finally { database.close(); }
    sessions.transition(first.id, { status: 'completed', summary: 'Complete.', expectedRevision: first.revision });
    assert.deepEqual(readWorkspaceSurfaceMap(databasePath, workspaceId).agents, []);
    assert.deepEqual(readWorkspaceSurfaceMap(databasePath, 'workspace-other').surfaces, []);
  } finally {
    surfaces.close(); resources.close(); sessions.close(); rmSync(directory, { recursive: true, force: true });
  }
});
